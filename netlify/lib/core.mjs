// Shared tab state for the Oct 17 bill.
// One JSON document per bill, written with conditional (ETag) writes so that
// simultaneous taps from different phones never overwrite each other.

export const BILL_KEY = 'tab-2026-10-17';
export const PAYER = 'nick';

// item id -> quantity on the receipt (used to validate requests)
export const ITEM_QTY = {
  bloody: 1, mojito: 3, vacay: 1, lemonade: 2, carbliss: 7, shandy: 1, mule: 2,
  cow: 9, miller: 1, rumple: 4, fireball: 3,
  curds: 3, csalad: 1, wrap: 1, wings: 1, hsalad: 1, pork: 1, fish: 2, philly: 1,
};

const MAX_PEOPLE = 40;
const COLORS = 12;

export function blank() {
  return {
    rev: 0,
    people: { [PAYER]: { name: 'Nick', color: 0, paid: null, ok: false, t: 0 } },
    claims: {},          // item -> { personId: units }
    modes: {},           // item -> 'count' | 'share' (only for items with qty > 1)
    tip: 'prop',         // 'prop' (by what they ordered) | 'even'
    leftover: 'hold',    // 'hold' | 'split' (split unclaimed items evenly)
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

// Applies one action to the document in place. Returns { changed, ... }.
export function apply(d, body) {
  switch (body && body.op) {
    case 'join': {
      const name = cleanName(body.name);
      const found = Object.entries(d.people).find(([, v]) => v.name.toLowerCase() === name.toLowerCase());
      if (found) return { person: found[0], changed: false };
      if (Object.keys(d.people).length >= MAX_PEOPLE) bad('This tab is full');
      const used = new Set(Object.values(d.people).map((v) => v.color));
      let color = 0;
      while (used.has(color) && color < COLORS) color++;
      if (color >= COLORS) color = Object.keys(d.people).length % COLORS;
      const id = newId(d);
      d.people[id] = { name, color, paid: null, ok: false, t: Date.now() };
      return { person: id, changed: true };
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
        if (u === 0) delete d.claims[c.i][c.p]; else d.claims[c.i][c.p] = u;
        pruneItem(d, c.i);
      }
      return { changed: true };
    }
    case 'mode': {
      if (!Object.prototype.hasOwnProperty.call(ITEM_QTY, body.i) || ITEM_QTY[body.i] < 2) bad('Unknown item');
      if (!['count', 'share'].includes(body.m)) bad('Unknown split type');
      d.modes[body.i] = body.m;
      return { changed: true };
    }
    case 'paid': {
      needPerson(d, body.p);
      if (body.p === PAYER) bad('Nick paid the bill');
      const paid = body.paid === null ? null : Number(body.paid);
      if (paid !== null && (!Number.isInteger(paid) || paid < 0 || paid > 100000)) bad('Enter a valid amount');
      d.people[body.p].paid = paid;
      d.people[body.p].ok = paid !== null && body.ok === true;
      return { changed: true };
    }
    case 'rename': {
      needPerson(d, body.p);
      const name = cleanName(body.name);
      const clash = Object.entries(d.people).find(([id, v]) => id !== body.p && v.name.toLowerCase() === name.toLowerCase());
      if (clash) bad(`${clash[1].name} is already on the tab`);
      d.people[body.p].name = name;
      return { changed: true };
    }
    case 'remove': {
      needPerson(d, body.p);
      if (body.p === PAYER) bad('Nick can’t be removed');
      delete d.people[body.p];
      for (const i of Object.keys(d.claims)) { delete d.claims[i][body.p]; pruneItem(d, i); }
      return { changed: true };
    }
    case 'settings': {
      if (body.tip !== undefined) {
        if (!['prop', 'even'].includes(body.tip)) bad('Unknown tip option');
        d.tip = body.tip;
      }
      if (body.leftover !== undefined) {
        if (!['hold', 'split'].includes(body.leftover)) bad('Unknown option');
        d.leftover = body.leftover;
      }
      return { changed: true };
    }
    default:
      bad('Unknown action');
  }
}

async function read(store) {
  const r = await store.getWithMetadata(BILL_KEY, { type: 'json' });
  if (!r || !r.data) return { data: blank(), etag: null };
  return { data: r.data, etag: r.etag };
}

// Read, change, and write back only if nobody else wrote in between; retry otherwise.
async function mutate(store, fn) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const { data, etag } = await read(store);
    const result = fn(data) || {};
    if (!result.changed) return { data, result };
    data.rev = (data.rev || 0) + 1;
    const w = await store.setJSON(BILL_KEY, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (w && w.modified) return { data, result };
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 30 * (attempt + 1)));
  }
  throw new HttpError(409, 'Lots of people tapping at once. Trying again.');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function handle(req, store) {
  try {
    if (req.method === 'GET') {
      const { data } = await read(store);
      const since = new URL(req.url).searchParams.get('rev');
      if (since !== null && Number(since) === data.rev) return json({ rev: data.rev, same: true });
      return json(data);
    }
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { bad('Bad request'); }
      const { data, result } = await mutate(store, (d) => apply(d, body));
      const out = { state: data };
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
