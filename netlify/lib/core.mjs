// Tabs: one JSON document per tab in Netlify Blobs, written with conditional
// (ETag) writes so simultaneous taps from different phones never overwrite
// each other. Each document also keeps an event log (`log`) that phones never
// receive; only the host's report reads it.

import { createHash, randomBytes } from 'node:crypto';
import { HOST, compute, itemsTotal, tidyName, slotsOf } from '../../public/split.mjs';

export { HOST, itemsTotal };
const MAX_PEOPLE = 40;
const MAX_ITEMS = 150;
const COLORS = 12;
const MAX_LOG = 2000;
const PHONE_EVENTS = new Set(['link_opened', 'pay_tapped', 'nudge_sent', 'share_tapped']);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const forbid = (msg = 'Only the host can do that') => { throw new HttpError(403, msg); };

export const keyFor = (id) => `tab/${id}`;
export const validId = (id) => typeof id === 'string' && /^[a-z0-9]{10}$/.test(id);
export const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const token = (bytes) => randomBytes(bytes).toString('hex');
const newTabId = () => { let s = ''; while (s.length < 10) s += randomBytes(8).readBigUInt64BE().toString(36); return s.slice(0, 10); };

function cleanName(n, max = 24) {
  if (typeof n !== 'string') bad('Enter a name');
  const s = n.replace(/\s+/g, ' ').trim().slice(0, max);
  if (!s) bad('Enter a name');
  return s;
}
function cleanVenmo(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') bad('Check the Venmo username');
  const s = v.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) bad('Check the Venmo username');
  return s;
}
const cents = (v, what, max = 10000000) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) bad(`Check ${what}`);
  return n;
};
function cleanItems(list, old = []) {
  if (!Array.isArray(list) || !list.length) bad('Add at least one item');
  if (list.length > MAX_ITEMS) bad('That receipt has too many lines');
  const ids = new Set();
  const used = new Set(old.map((i) => i.id));
  return list.map((it, k) => {
    if (!it || typeof it !== 'object') bad('Check the items');
    let id = typeof it.id === 'string' && /^[a-z0-9]{1,12}$/.test(it.id) ? it.id : null;
    if (!id || ids.has(id)) { do { id = 'i' + token(3); } while (ids.has(id) || used.has(id)); }
    ids.add(id);
    const qty = it.qty == null ? 1 : Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) bad(`Check the quantity on line ${k + 1}`);
    return { id, name: tidyName(cleanName(it.name, 60), qty), qty, cents: cents(it.cents, `the price on line ${k + 1}`) };
  });
}
function needPerson(T, p) {
  if (typeof p !== 'string' || !T.people[p]) throw new HttpError(404, 'That person is no longer on the tab');
}
function newPersonId(T) {
  let id;
  do { id = token(4); } while (T.people[id]);
  return id;
}
function addPerson(T, name, now, addedBy) {
  const found = Object.entries(T.people).find(([, v]) => v.name.toLowerCase() === name.toLowerCase());
  if (found) return { id: found[0], created: false };
  if (Object.keys(T.people).length >= MAX_PEOPLE) bad('This tab is full');
  const used = new Set(Object.values(T.people).map((v) => v.color));
  let color = 0;
  while (used.has(color) && color < COLORS) color++;
  if (color >= COLORS) color = Object.keys(T.people).length % COLORS;
  const id = newPersonId(T);
  T.people[id] = { name, color, t: now, by: addedBy, paid: null, lock: null, ok: false, waived: 0 };
  return { id, created: true };
}
function pruneItem(T, i) {
  for (const map of [T.claims, T.by, T.out]) if (map[i] && !Object.keys(map[i]).length) delete map[i];
}
// Tabs saved before slots existed keep per-person counts; turn them into slots once.
export function migrate(T) {
  if (T.slots) return;
  T.slots = {};
  for (const it of T.items || []) T.slots[it.id] = slotsOf(T, it);
  T.claims = {};
  T.modes = {};
}

// ---------- Event log ----------
const cleanDevice = (v) => (typeof v === 'string' && /^[a-z0-9]{4,24}$/.test(v) ? v : undefined);
export function log(T, now, type, data = {}) {
  if (!Array.isArray(T.log)) T.log = [];
  const e = { t: now, type };
  for (const [k, v] of Object.entries(data)) if (v !== undefined) e[k] = v;
  T.log.push(e);
  if (T.log.length > MAX_LOG) T.log.splice(0, T.log.length - MAX_LOG);
}

// Remembers who added someone to an item, so they see "Added by Nick".
function setBy(T, i, p, by, slots) {
  T.by[i] = T.by[i] || {};
  const has = slots.some((x) => x.includes(p));
  if (!has || !by || by === p) delete T.by[i][p];
  else T.by[i][p] = by;
  pruneItem(T, i);
}

// ---------- Creating a tab ----------
export function createTab(body, now) {
  const items = cleanItems(body.items);
  const charge = cents(body.charge, 'what your card was charged');
  if (charge < 1) bad('Enter what your card was charged');
  const hostKey = token(16);
  const T = {
    v: 2, id: newTabId(), rev: 1, created: now, closed: false,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 60) : 'Tab',
    hostKeyHash: hash(hostKey),
    payer: { name: cleanName(body.hostName || 'Host'), venmo: cleanVenmo(body.venmo) },
    mode: body.mode === 'even' ? 'even' : 'items',
    items, charge,
    people: {}, claims: {}, out: {}, by: {}, modes: {}, pool: null, log: [],
    slots: Object.fromEntries(items.map((it) => [it.id, Array.from({ length: it.qty }, () => [])])),
  };
  T.people[HOST] = { name: T.payer.name, color: 0, t: 0, by: 'self', paid: null, lock: null, ok: false, waived: 0 };
  const names = Array.isArray(body.people) ? body.people.slice(0, MAX_PEOPLE - 1) : [];
  for (const n of names) if (typeof n === 'string' && n.trim()) addPerson(T, cleanName(n), now, HOST);
  log(T, now, 'created', {
    items: items.length, charge, mode: T.mode, people: Object.keys(T.people).length, device: cleanDevice(body.device),
    scan: typeof body.scan === 'string' ? body.scan.slice(0, 20) : undefined,
  });
  return { T, hostKey };
}

// ---------- Changes ----------
function summary(T) {
  const C = compute(T);
  return { allClaimed: C.allClaimed, allPaid: C.allPaid, totals: Object.fromEntries(C.res.map((r) => [r.p.id, r.total])) };
}

// Applies one action to the tab in place and logs it.
// Returns { changed, quiet?, person? }. Quiet changes don't bump the revision.
export function apply(T, body, now = Date.now()) {
  if (!body || typeof body !== 'object') bad('Unknown action');
  const isHost = typeof body.key === 'string' && body.key.length > 0 && hash(body.key) === T.hostKeyHash;
  if (body.op === 'event') return phoneEvent(T, body, now);
  if (T.closed && !(isHost && body.op === 'reopen')) bad('This tab is closed');
  migrate(T);
  const before = summary(T);
  const r = change(T, body, now, isHost);
  if (r.changed) {
    const after = summary(T);
    if (!before.allClaimed && after.allClaimed) log(T, now, 'all_claimed');
    if (!before.allPaid && after.allPaid) log(T, now, 'all_paid');
  }
  return r;
}

function phoneEvent(T, body, now) {
  if (!PHONE_EVENTS.has(body.type)) bad('Unknown event');
  const device = cleanDevice(body.device);
  const person = typeof body.actor === 'string' && T.people[body.actor] ? body.actor : undefined;
  if (body.type === 'link_opened') {
    if (device && T.log.some((e) => e.type === 'link_opened' && e.device === device)) return { changed: false };
    log(T, now, 'link_opened', { device, person });
  } else if (body.type === 'pay_tapped') {
    const amount = Number(body.amount);
    log(T, now, 'pay_tapped', { device, person, amount: Number.isInteger(amount) && amount > 0 ? amount : undefined });
  } else {
    const to = typeof body.to === 'string' && T.people[body.to] ? body.to : undefined;
    log(T, now, body.type, { device, person, to });
  }
  return { changed: true, quiet: true };
}

function change(T, body, now, isHost) {
  const actor = typeof body.actor === 'string' && T.people[body.actor] ? body.actor : undefined;
  const by = isHost ? HOST : actor;
  const device = cleanDevice(body.device);
  const host = () => { if (!isHost) forbid(); };
  const selfOrHost = (p) => { if (!isHost && actor !== p) forbid('You can only change your own payment'); };

  switch (body.op) {
    case 'join': {
      const { id, created } = addPerson(T, cleanName(body.name), now, 'self');
      log(T, now, 'joined', { person: id, device, returning: created ? undefined : true });
      return { person: id, changed: true, quiet: !created };
    }
    case 'pick': {
      needPerson(T, body.p);
      if (!device || T.log.some((e) => e.type === 'joined' && e.person === body.p && e.device === device)) return { changed: false };
      log(T, now, 'joined', { person: body.p, device });
      return { changed: true, quiet: true };
    }
    case 'claims': {
      const ch = body.changes;
      if (!Array.isArray(ch) || !ch.length || ch.length > 200) bad('No changes sent');
      for (const c of ch) {
        const it = c && T.items.find((x) => x.id === c.i);
        if (!it) bad('That item is no longer on the tab');
        needPerson(T, c.p);
        if (T.mode !== 'even') bad('This page is out of date. Refresh it and try again.');
          // In an even split, a claim means staying in (1) or stepping out (0).
          const outNow = !!(T.out[c.i] && T.out[c.i][c.p]);
          const wantOut = Number(c.u) === 0;
          if (outNow !== wantOut) {
            T.out[c.i] = T.out[c.i] || {};
            T.by[c.i] = T.by[c.i] || {};
            if (wantOut) T.out[c.i][c.p] = true; else delete T.out[c.i][c.p];
            if (by && by !== c.p) T.by[c.i][c.p] = by; else delete T.by[c.i][c.p];
            log(T, now, 'claim', { item: c.i, person: c.p, from: outNow ? 0 : 1, to: wantOut ? 0 : 1, by });
          }
        pruneItem(T, c.i);
      }
      return { changed: true };
    }
    case 'slots': {
      // Itemized tabs: take an open slot, join someone's (shared it), or leave one.
      if (T.mode === 'even') bad('This page is out of date. Refresh it and try again.');
      const ch = body.changes;
      if (!Array.isArray(ch) || !ch.length || ch.length > 200) bad('No changes sent');
      for (const c of ch) {
        const it = c && T.items.find((x) => x.id === c.i);
        if (!it) bad('That item is no longer on the tab');
        needPerson(T, c.p);
        const sl = slotsOf(T, it);
        let k = Number(c.k);
        if (c.a === 'take') {
          k = sl.findIndex((x) => !x.length);
          if (k < 0) bad(`All ${it.qty} ${it.name} are taken. Tap one to share it.`);
          sl[k] = [c.p];
        } else if (c.a === 'join' || c.a === 'leave') {
          if (!Number.isInteger(k) || k < 0 || k >= it.qty) bad('That one is no longer on the tab');
          const had = sl[k].includes(c.p);
          if (c.a === 'join' && !had) sl[k].push(c.p);
          else if (c.a === 'leave' && had) sl[k] = sl[k].filter((x) => x !== c.p);
          else continue;
        } else bad('Unknown change');
        T.slots[it.id] = sl;
        setBy(T, it.id, c.p, by, sl);
        log(T, now, 'claim', { item: it.id, person: c.p, slot: k, from: c.a === 'leave' ? 1 : 0, to: c.a === 'leave' ? 0 : 1, by });
      }
      return { changed: true };
    }
    case 'shareAll': {
      // The same people shared every one (cheese curds for the table).
      const it = T.items.find((x) => x.id === body.i);
      if (!it) bad('That item is no longer on the tab');
      if (!Array.isArray(body.ps) || body.ps.length > 40) bad('Pick who shared it');
      const ps = [...new Set(body.ps)];
      ps.forEach((p) => needPerson(T, p));
      const before = slotsOf(T, it);
      T.slots[it.id] = Array.from({ length: it.qty }, () => ps.slice());
      for (const p of new Set([...ps, ...before.flat()])) setBy(T, it.id, p, by, T.slots[it.id]);
      log(T, now, 'claim', { item: it.id, shared_by: ps.length, by, from: before.filter((x) => x.length).length, to: ps.length ? it.qty : 0 });
      return { changed: true };
    }
    case 'paid': {
      needPerson(T, body.p);
      if (body.p === HOST) bad('The host paid the bill');
      selfOrHost(body.p);
      const amount = cents(body.amount, 'the amount');
      const person = T.people[body.p];
      if (person.lock == null) person.lock = summary(T).totals[body.p]; // their total stops moving once they pay
      person.paid = (person.paid || 0) + amount;
      if (isHost) person.ok = true;
      log(T, now, 'paid', { person: body.p, amount, total: person.lock, how: body.how === 'other' ? 'other' : 'venmo', by });
      return { changed: true };
    }
    case 'unpaid': {
      needPerson(T, body.p);
      selfOrHost(body.p);
      Object.assign(T.people[body.p], { paid: null, lock: null, ok: false, waived: 0 });
      log(T, now, 'unpaid', { person: body.p, by });
      return { changed: true };
    }
    case 'confirm': {
      host(); needPerson(T, body.p);
      T.people[body.p].ok = true;
      log(T, now, 'confirmed', { person: body.p });
      return { changed: true };
    }
    case 'waive': {
      host(); needPerson(T, body.p);
      if (body.p === HOST) bad('The host paid the bill');
      const r = compute(T).byId[body.p];
      const p = T.people[body.p];
      if (p.lock == null) p.lock = r.total;
      if (p.paid == null) p.paid = 0;
      const owed = p.lock - p.paid - (p.waived || 0);
      p.waived = (p.waived || 0) + Math.max(0, owed);
      log(T, now, 'waived', { person: body.p, amount: Math.max(0, owed) });
      return { changed: true };
    }
    case 'add': {
      host();
      const { id, created } = addPerson(T, cleanName(body.name), now, HOST);
      if (created) log(T, now, 'person_added', { person: id });
      return { person: id, changed: created };
    }
    case 'remove': {
      host(); needPerson(T, body.p);
      if (body.p === HOST) bad('The host can’t be removed');
      delete T.people[body.p];
      for (const map of [T.claims, T.out, T.by]) for (const i of Object.keys(map)) { delete map[i][body.p]; pruneItem(T, i); }
      for (const i of Object.keys(T.slots || {})) T.slots[i] = T.slots[i].map((x) => x.filter((q) => q !== body.p));
      log(T, now, 'removed', { person: body.p });
      return { changed: true };
    }
    case 'rename': {
      needPerson(T, body.p);
      if (!isHost && actor !== body.p) forbid('You can only rename yourself');
      const name = cleanName(body.name);
      const clash = Object.entries(T.people).find(([id, v]) => id !== body.p && v.name.toLowerCase() === name.toLowerCase());
      if (clash) bad(`${clash[1].name} is already on the tab`);
      T.people[body.p].name = name;
      if (body.p === HOST) T.payer.name = name;
      log(T, now, 'renamed', { person: body.p, by });
      return { changed: true };
    }
    case 'setup': {
      // Host edits to the receipt or the tab's settings.
      host();
      const fields = ['items', 'charge', 'title', 'venmo', 'mode', 'pool'].filter((k) => body[k] !== undefined);
      if (!fields.length) bad('Nothing to change');
      if (body.items !== undefined) {
        T.items = cleanItems(body.items, T.items);
        T.slots = Object.fromEntries(T.items.map((it) => [it.id, slotsOf(T, it)]));
        const ids = new Set(T.items.map((i) => i.id));
        for (const map of [T.claims, T.out, T.by, T.modes]) for (const i of Object.keys(map)) if (!ids.has(i)) delete map[i];
      }
      if (body.charge !== undefined) {
        const c = cents(body.charge, 'the card charge');
        if (c < 1) bad('Enter what your card was charged');
        T.charge = c;
      }
      if (body.title !== undefined) T.title = String(body.title).trim().slice(0, 60) || 'Tab';
      if (body.venmo !== undefined) T.payer.venmo = cleanVenmo(body.venmo);
      if (body.mode !== undefined) T.mode = body.mode === 'even' ? 'even' : 'items';
      if (body.pool !== undefined) T.pool = ['spread', 'cover'].includes(body.pool) ? body.pool : null;
      log(T, now, 'setup', { fields: fields.join(','), pool: body.pool === undefined ? undefined : T.pool });
      return { changed: true };
    }
    case 'close': {
      host();
      T.closed = true;
      log(T, now, 'closed', { pool: compute(T).pool });
      return { changed: true };
    }
    case 'reopen': {
      host();
      T.closed = false;
      log(T, now, 'reopened');
      return { changed: true };
    }
    default:
      bad('Unknown action');
  }
}

// ---------- Storage ----------
export async function read(store, id) {
  const r = await store.getWithMetadata(keyFor(id), { type: 'json' });
  if (!r || !r.data) return null;
  return { data: r.data, etag: r.etag };
}

// Read, change, and write back only if nobody else wrote in between; retry otherwise.
export async function mutate(store, id, fn) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const cur = await read(store, id);
    if (!cur) throw new HttpError(404, 'This tab doesn’t exist. Check the link.');
    const { data, etag } = cur;
    const result = fn(data) || {};
    if (!result.changed) return { data, result };
    if (!result.quiet) data.rev = (data.rev || 0) + 1;
    const w = await store.setJSON(keyFor(id), data, { onlyIfMatch: etag });
    if (w && w.modified) return { data, result };
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 30 * (attempt + 1)));
  }
  throw new HttpError(409, 'Lots of people tapping at once. Trying again.');
}

// What phones get: no event log, no host key.
export function forPhones(T) {
  const { log: _log, hostKeyHash: _h, ...rest } = T;
  return rest;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const NOT_FOUND = 'This tab doesn’t exist. Check the link.';

export async function handle(req, store, now = () => Date.now()) {
  try {
    if (req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      const id = q.get('t');
      if (!validId(id)) throw new HttpError(404, NOT_FOUND);
      const cur = await read(store, id);
      if (!cur) throw new HttpError(404, NOT_FOUND);
      const since = q.get('rev');
      if (since !== null && Number(since) === cur.data.rev) return json({ rev: cur.data.rev, same: true });
      return json(forPhones(cur.data));
    }
    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await req.text()); } catch { bad('Bad request'); }
      if (!body || typeof body !== 'object') bad('Bad request');
      if (body.op === 'create') {
        const { T, hostKey } = createTab(body, now());
        for (let i = 0; i < 3; i++) {
          const w = await store.setJSON(keyFor(T.id), T, { onlyIfNew: true });
          if (w && w.modified) return json({ id: T.id, hostKey, state: forPhones(T) });
          T.id = newTabId();
        }
        throw new HttpError(500, 'Couldn’t create the tab. Try again.');
      }
      if (body.op === 'checkhost') {
        if (!validId(body.t)) throw new HttpError(404, NOT_FOUND);
        const cur = await read(store, body.t);
        if (!cur) throw new HttpError(404, NOT_FOUND);
        return json({ isHost: typeof body.key === 'string' && hash(body.key) === cur.data.hostKeyHash });
      }
      if (!validId(body.t)) throw new HttpError(404, NOT_FOUND);
      const { data, result } = await mutate(store, body.t, (T) => apply(T, body, now()));
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
