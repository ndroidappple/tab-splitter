// Shared tab state for the Oct 17 bill.
// One JSON document per bill, written with conditional (ETag) writes so that
// simultaneous taps from different phones never overwrite each other.
//
// The document also keeps an event log (`log`): a timestamped line for every
// step a tab goes through. Phones never see it; only the report reads it.

import { PAYER, ITEM_QTY, compute } from '../../public/split.mjs';

export { PAYER, ITEM_QTY };
export const BILL_KEY = 'tab-2026-10-17';

const MAX_PEOPLE = 40;
const COLORS = 12;
const MAX_LOG = 2000;
// Events a phone can send on its own (everything else is logged by the server).
const PHONE_EVENTS = new Set(['link_opened', 'pay_tapped', 'nudge_sent', 'share_tapped']);
const SETTLED_SLACK = 100; // within $1 counts as paid in full

export function blank() {
  return {
    rev: 0,
    people: { [PAYER]: { name: 'Nick', color: 0, paid: null, ok: false, t: 0 } },
    claims: {},          // item -> { personId: units }
    modes: {},           // item -> 'count' | 'share' (only for items with qty > 1)
    tip: 'prop',         // 'prop' (by what they ordered) | 'even'
    leftover: 'hold',    // 'hold' | 'split' (split unclaimed items evenly)
    log: [],             // event log, newest last
  };
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

function cleanName(n) {
  if (typeof n !== 'string') bad('Enter a name');
  const s = n.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!s) bad('Enter a name');
  return s;
}
function needPerson(d, p) {
  if (typeof p !== 'string' || !d.people[p]) throw new HttpError(404, 'That person is no longer on the tab');
}
function newId(d) {
  let id;
  do { id = Math.random().toString(36).slice(2, 10); } while (d.people[id]);
  return id;
}
function pruneItem(d, i) {
  if (d.claims[i] && !Object.keys(d.claims[i]).length) delete d.claims[i];
}

// ---------- Event log ----------

// A device id is a random tag a phone keeps in its browser, so the report can
// connect "opened the link" to the name that phone joined as.
const cleanDevice = (v) => (typeof v === 'string' && /^[a-z0-9]{4,24}$/.test(v) ? v : undefined);
const actorOf = (d, body) => (typeof body.actor === 'string' && d.people[body.actor] ? body.actor : undefined);

export function log(d, now, type, data = {}) {
  if (!Array.isArray(d.log)) d.log = [];
  const e = { t: now, type };
  for (const [k, v] of Object.entries(data)) if (v !== undefined) e[k] = v;
  d.log.push(e);
  if (d.log.length > MAX_LOG) d.log.splice(0, d.log.length - MAX_LOG);
}

// The facts the derived events compare before and after each change.
function summary(d) {
  const C = compute(d);
  const totals = {};
  C.res.forEach((r) => { totals[r.p.id] = r.total; });
  const others = C.res.filter((r) => r.p.id !== PAYER && r.total > 0);
  const allClaimed = C.openItems.length === 0;
  const allPaid = allClaimed && others.length > 0 &&
    others.every((r) => r.p.paid != null && r.owed <= SETTLED_SLACK);
  return { totals, allClaimed, allPaid, assigned: C.assigned };
}

// Logs the milestones nobody taps directly: everything claimed, everyone paid,
// and a paid person's total moving afterwards.
function logDerived(d, before, now) {
  const after = summary(d);
  if (!before.allClaimed && after.allClaimed) log(d, now, 'all_claimed', { assigned: after.assigned });
  if (!before.allPaid && after.allPaid) log(d, now, 'all_paid');
  for (const [p, total] of Object.entries(after.totals)) {
    const was = before.totals[p];
    if (p !== PAYER && was !== undefined && d.people[p].paid != null && Math.abs(total - was) > SETTLED_SLACK) {
      log(d, now, 'total_moved', { person: p, from: was, to: total });
    }
  }
}

// ---------- Actions ----------

// Applies one action to the document in place and logs it.
// Returns { changed, quiet?, person? }. `quiet` changes (phone events) don't
// bump the revision, so other phones don't refetch for them.
export function apply(d, body, now = Date.now()) {
  if (!body || typeof body !== 'object') bad('Unknown action');
  if (body.op === 'event') return phoneEvent(d, body, now);
  const before = summary(d);
  const result = change(d, body, now);
  if (result.changed) logDerived(d, before, now);
  return result;
}

function phoneEvent(d, body, now) {
  if (!PHONE_EVENTS.has(body.type)) bad('Unknown event');
  const device = cleanDevice(body.device);
  const person = actorOf(d, body);
  if (body.type === 'link_opened') {
    // Count each phone once.
    if (device && (d.log || []).some((e) => e.type === 'link_opened' && e.device === device)) return { changed: false };
    log(d, now, 'link_opened', { device, person });
  } else if (body.type === 'pay_tapped') {
    const amount = Number(body.amount);
    log(d, now, 'pay_tapped', { device, person, amount: Number.isInteger(amount) && amount > 0 && amount <= 1e7 ? amount : undefined });
  } else {
    log(d, now, body.type, { device, person });
  }
  return { changed: true, quiet: true };
}

function change(d, body, now) {
  const by = actorOf(d, body);
  const device = cleanDevice(body.device);
  switch (body.op) {
    case 'join': {
      const name = cleanName(body.name);
      const found = Object.entries(d.people).find(([, v]) => v.name.toLowerCase() === name.toLowerCase());
      if (found) {
        // Picking an existing name only gets logged the first time a phone does it.
        const seen = (d.log || []).some((e) => e.type === 'joined' && e.person === found[0] && e.device === device);
        if (device && !seen) { log(d, now, 'joined', { person: found[0], device, returning: true }); return { person: found[0], changed: true, quiet: true }; }
        return { person: found[0], changed: false };
      }
      if (Object.keys(d.people).length >= MAX_PEOPLE) bad('This tab is full');
      const used = new Set(Object.values(d.people).map((v) => v.color));
      let color = 0;
      while (used.has(color) && color < COLORS) color++;
      if (color >= COLORS) color = Object.keys(d.people).length % COLORS;
      const id = newId(d);
      d.people[id] = { name, color, paid: null, ok: false, t: now };
      log(d, now, 'joined', { person: id, device, by });
      return { person: id, changed: true };
    }
    case 'pick': {
      // A phone tapped an existing name on the join screen.
      needPerson(d, body.p);
      const seen = (d.log || []).some((e) => e.type === 'joined' && e.person === body.p && e.device === device);
      if (!device || seen) return { changed: false };
      log(d, now, 'joined', { person: body.p, device, returning: true });
      return { changed: true, quiet: true };
    }
    case 'claims': {
      const ch = body.changes;
      if (!Array.isArray(ch) || !ch.length || ch.length > 80) bad('No changes sent');
      for (const c of ch) {
        if (!c || !Object.prototype.hasOwnProperty.call(ITEM_QTY, c.i)) bad('Unknown item');
        needPerson(d, c.p);
        const u = Number(c.u);
        if (!Number.isInteger(u) || u < 0 || u > 50) bad('Counts must be between 0 and 50');
        d.claims[c.i] = d.claims[c.i] || {};
        const from = d.claims[c.i][c.p] || 0;
        if (u === 0) delete d.claims[c.i][c.p]; else d.claims[c.i][c.p] = u;
        pruneItem(d, c.i);
        if (from !== u) log(d, now, 'claim', { item: c.i, person: c.p, from, to: u, by });
      }
      return { changed: true };
    }
    case 'mode': {
      if (!Object.prototype.hasOwnProperty.call(ITEM_QTY, body.i) || ITEM_QTY[body.i] < 2) bad('Unknown item');
      if (!['count', 'share'].includes(body.m)) bad('Unknown split type');
      d.modes[body.i] = body.m;
      log(d, now, 'mode', { item: body.i, mode: body.m, by });
      return { changed: true };
    }
    case 'paid': {
      needPerson(d, body.p);
      if (body.p === PAYER) bad('Nick paid the bill');
      const paid = body.paid === null ? null : Number(body.paid);
      if (paid !== null && (!Number.isInteger(paid) || paid < 0 || paid > 100000)) bad('Enter a valid amount');
      const total = summary(d).totals[body.p];
      d.people[body.p].paid = paid;
      d.people[body.p].ok = paid !== null && body.ok === true;
      log(d, now, paid === null ? 'unpaid' : 'paid', { person: body.p, amount: paid ?? undefined, total, ok: paid !== null ? d.people[body.p].ok : undefined, by });
      return { changed: true };
    }
    case 'rename': {
      needPerson(d, body.p);
      const name = cleanName(body.name);
      const clash = Object.entries(d.people).find(([id, v]) => id !== body.p && v.name.toLowerCase() === name.toLowerCase());
      if (clash) bad(`${clash[1].name} is already on the tab`);
      d.people[body.p].name = name;
      log(d, now, 'renamed', { person: body.p, by });
      return { changed: true };
    }
    case 'remove': {
      needPerson(d, body.p);
      if (body.p === PAYER) bad('Nick can’t be removed');
      delete d.people[body.p];
      for (const i of Object.keys(d.claims)) { delete d.claims[i][body.p]; pruneItem(d, i); }
      log(d, now, 'removed', { person: body.p, by });
      return { changed: true };
    }
    case 'settings': {
      const paidCount = Object.entries(d.people).filter(([id, v]) => id !== PAYER && v.paid != null).length;
      if (body.tip !== undefined) {
        if (!['prop', 'even'].includes(body.tip)) bad('Unknown tip option');
        d.tip = body.tip;
        log(d, now, 'settings', { field: 'tip', value: body.tip, already_paid: paidCount, by });
      }
      if (body.leftover !== undefined) {
        if (!['hold', 'split'].includes(body.leftover)) bad('Unknown option');
        d.leftover = body.leftover;
        log(d, now, 'settings', { field: 'leftover', value: body.leftover, already_paid: paidCount, by });
      }
      return { changed: true };
    }
    default:
      bad('Unknown action');
  }
}

// ---------- Storage ----------

export async function read(store) {
  const r = await store.getWithMetadata(BILL_KEY, { type: 'json' });
  if (!r || !r.data) return { data: blank(), etag: null };
  return { data: r.data, etag: r.etag };
}

// Read, change, and write back only if nobody else wrote in between; retry otherwise.
export async function mutate(store, fn) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const { data, etag } = await read(store);
    const result = fn(data) || {};
    if (!result.changed) return { data, result };
    if (!result.quiet) data.rev = (data.rev || 0) + 1;
    const w = await store.setJSON(BILL_KEY, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (w && w.modified) return { data, result };
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 30 * (attempt + 1)));
  }
  throw new HttpError(409, 'Lots of people tapping at once. Trying again.');
}

// What phones get: everything except the event log.
export function forPhones(d) {
  const { log: _log, ...rest } = d;
  return rest;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function handle(req, store, now = () => Date.now()) {
  try {
    if (req.method === 'GET') {
      const { data } = await read(store);
      const since = new URL(req.url).searchParams.get('rev');
      if (since !== null && Number(since) === data.rev) return json({ rev: data.rev, same: true });
      return json(forPhones(data));
    }
    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await req.text()); } catch { bad('Bad request'); }
      const { data, result } = await mutate(store, (d) => apply(d, body, now()));
      if (body.op === 'event') return json({ ok: true });
      const out = { state: forPhones(data) };
      if (result.person) out.person = result.person;
      return json(out);
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on the server' }, 500);
  }
}
