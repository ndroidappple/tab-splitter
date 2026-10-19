// Run with: npm test
// Simulates a whole tab against the real server code with a fake store,
// then checks the event log and the report.

import assert from 'node:assert/strict';
import { handle, BILL_KEY } from '../netlify/lib/core.mjs';
import { handleReport, buildReport } from '../netlify/lib/report.mjs';
import { ITEMS, TOTAL, compute } from '../public/split.mjs';

// In-memory stand-in for Netlify Blobs, with the same conditional writes.
function fakeStore() {
  const m = new Map();
  let n = 0;
  return {
    async getWithMetadata(key) { const v = m.get(key); return v ? { data: JSON.parse(v.body), etag: v.etag } : null; },
    async setJSON(key, data, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      m.set(key, { body: JSON.stringify(data), etag: 'e' + (++n) });
      return { modified: true };
    },
    raw: () => JSON.parse(m.get(BILL_KEY).body),
  };
}

const store = fakeStore();
let clock = Date.parse('2026-10-17T19:30:00Z');
const now = () => clock;
const later = (minutes) => { clock += minutes * 60000; };
const call = async (body) => (await handle(new Request('https://x/api/tab', { method: 'POST', body: JSON.stringify(body) }), store, now)).json();
const get = async (q = '') => (await handle(new Request('https://x/api/tab' + q), store, now)).json();
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.message); } };

await test('a fresh tab has no log and phones never see one', async () => {
  const s = await get();
  assert.equal(s.rev, 0);
  assert.equal('log' in s, false);
});

// Nick opens the tab, shares it, two friends open it and join.
await call({ op: 'event', type: 'link_opened', device: 'nickphone1', actor: 'nick' });
await call({ op: 'event', type: 'share_tapped', device: 'nickphone1', actor: 'nick' });
later(2);
await call({ op: 'event', type: 'link_opened', device: 'annaphone1' });
await call({ op: 'event', type: 'link_opened', device: 'annaphone1' }); // same phone again: not counted twice
const anna = (await call({ op: 'join', name: 'Anna', device: 'annaphone1' })).person;
later(1);
await call({ op: 'event', type: 'link_opened', device: 'benphone12' });
const ben = (await call({ op: 'join', name: 'Ben', device: 'benphone12' })).person;

await test('phone events do not bump the revision', async () => {
  const s = await get();
  assert.equal(s.rev, 2); // only the two joins
  assert.equal(store.raw().log.filter((e) => e.type === 'link_opened').length, 3);
});

// Anna claims half the receipt, Ben the other half (Nick claims nothing).
later(1);
const half = ITEMS.map((it, k) => ({ it, who: k % 2 ? ben : anna }));
await call({ op: 'claims', actor: anna, changes: half.filter((h) => h.who === anna).map((h) => ({ i: h.it.id, p: anna, u: h.it.qty })) });
later(1);
await call({ op: 'claims', actor: ben, changes: half.filter((h) => h.who === ben).map((h) => ({ i: h.it.id, p: ben, u: h.it.qty })) });

await test('the last claim logs all_claimed and totals add up to the cent', async () => {
  const d = store.raw();
  const e = d.log.filter((x) => x.type === 'all_claimed');
  assert.equal(e.length, 1);
  assert.equal(e[0].assigned, TOTAL);
  assert.equal(compute(d).assigned, TOTAL);
});

const totals = Object.fromEntries(compute(store.raw()).res.map((r) => [r.p.id, r.total]));

// Anna pays on Venmo and confirms; Ben taps Venmo, forgets to confirm, then sends a round $40 later.
later(3);
await call({ op: 'event', type: 'pay_tapped', device: 'annaphone1', actor: anna, amount: totals[anna] });
later(1);
await call({ op: 'paid', p: anna, paid: totals[anna], ok: false, actor: anna });
await call({ op: 'event', type: 'pay_tapped', device: 'benphone12', actor: ben, amount: totals[ben] });
later(300);
await call({ op: 'event', type: 'nudge_sent', device: 'nickphone1', actor: 'nick' });
await test('not all paid while Ben has not paid', async () => {
  assert.equal(store.raw().log.some((e) => e.type === 'all_paid'), false);
});
later(60);
await call({ op: 'paid', p: ben, paid: 4000, ok: false, actor: ben });

await test('Ben paying $40 of a larger total does not count as all paid', async () => {
  assert.ok(totals[ben] - 4000 > 100, 'test setup: Ben owes more than $41');
  assert.equal(store.raw().log.some((e) => e.type === 'all_paid'), false);
});
later(30);
await call({ op: 'paid', p: ben, paid: totals[ben], ok: true, actor: 'nick' });

await test('Nick marking Ben paid in full logs all_paid', async () => {
  const d = store.raw();
  assert.equal(d.log.filter((e) => e.type === 'all_paid').length, 1);
  const paid = d.log.filter((e) => e.type === 'paid' && e.person === ben);
  assert.equal(paid.length, 2);
  assert.equal(paid[1].by, 'nick');
});

// A late change after everyone paid moves Anna's total.
later(60 * 24);
// The Bloody Mary was Anna's (even rows); Ben says it was his.
await call({ op: 'claims', actor: ben, changes: [{ i: 'bloody', p: ben, u: 1 }, { i: 'bloody', p: anna, u: 0 }] });
await test('a change that moves a paid total logs total_moved', async () => {
  const d = store.raw();
  const moved = d.log.filter((e) => e.type === 'total_moved');
  assert.ok(moved.length >= 1);
});

await test('report: milestones and metrics', async () => {
  const r = buildReport(store.raw());
  assert.equal(r.milestones.link_opened.minutes_from_start, 0);
  assert.equal(r.milestones.joined.minutes_from_start, 2);
  assert.equal(r.milestones.first_claim.minutes_from_start, 4);
  assert.equal(r.milestones.all_claimed.minutes_from_start, 5);
  assert.equal(r.milestones.all_paid.minutes_from_start, 5 + 3 + 1 + 300 + 60 + 30);
  assert.equal(r.metrics.reminders, 1);
  assert.equal(r.metrics.unconfirmed_venmo_taps, 0.5); // Ben's tap had no "paid" within 10 minutes
  assert.ok(r.metrics.totals_moved_after_paying >= 1);
  const a = r.people.find((p) => p.name === 'Anna');
  assert.equal(a.minutes_open_to_paid, 2 + 1 + 1 + 1 + 3 + 1 - 2); // opened at minute 2, paid at minute 9
  assert.equal(r.people.find((p) => p.name === 'Ben').claimed_by_someone_else, false);
});

await test('report needs the key', async () => {
  const off = await handleReport(new Request('https://x/api/report'), store, undefined);
  assert.equal(off.status, 404);
  const wrong = await handleReport(new Request('https://x/api/report?key=nope'), store, 'secret');
  assert.equal(wrong.status, 403);
  const right = await handleReport(new Request('https://x/api/report?key=secret'), store, 'secret');
  assert.equal(right.status, 200);
});

await test('unknown phone events are refused', async () => {
  const r = await call({ op: 'event', type: 'all_paid' });
  assert.equal(r.error, 'Unknown event');
});

await test('sendBeacon bodies (text/plain) are accepted', async () => {
  const res = await handle(new Request('https://x/api/tab', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ op: 'event', type: 'nudge_sent', device: 'nickphone1' }) }), store, now);
  assert.equal(res.status, 200);
});

await test('a tab saved before the log existed still works', async () => {
  const old = fakeStore();
  await old.setJSON(BILL_KEY, { rev: 3, people: { nick: { name: 'Nick', color: 0, paid: null, ok: false, t: 0 } }, claims: {}, modes: {}, tip: 'prop', leftover: 'hold' });
  const r = await (await handle(new Request('https://x/api/tab', { method: 'POST', body: JSON.stringify({ op: 'join', name: 'Cal', device: 'calphone1' }) }), old, now)).json();
  assert.ok(r.person);
  assert.equal(old.raw().log.length, 1);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
