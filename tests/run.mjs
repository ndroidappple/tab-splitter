// Run with: npm test
// Plays tabs through the real server code with an in-memory store.

import assert from 'node:assert/strict';
import { handle, keyFor, HOST } from '../netlify/lib/core.mjs';
import { handleReport } from '../netlify/lib/report.mjs';
import { readReceipt, addsUp, likelyCharge } from '../netlify/lib/read-receipt.mjs';
import { compute, apportion } from '../public/split.mjs';
import { fakeStore } from './fake-store.mjs';

let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };

const store = fakeStore();
let clock = Date.parse('2026-10-18T19:33:00Z');
const now = () => clock;
const later = (m) => { clock += m * 60000; };
const post = async (body, s = store) => {
  const res = await handle(new Request('https://x/api/tab', { method: 'POST', body: JSON.stringify(body) }), s, now);
  return { status: res.status, ...(await res.json()) };
};
const get = async (t) => (await handle(new Request('https://x/api/tab?t=' + t), store, now)).json();

// The Wild Tomato receipt: $140 of items, card charged $180.09 with the tip.
const WILD = [
  ['Fried Cheese Curds', 2, 2400], ['Large Margherita', 1, 2500], ['Large Sausage & Pesto', 1, 2700], ['Large Hot Honey', 1, 2700],
  ['Von Stiehl Cherry Cider DRFT', 2, 1600], ['New Glarus Tailwagger DRFT', 1, 700], ['Bloody Mary', 1, 1000], ['Diet Coke', 1, 400],
].map(([name, qty, cents]) => ({ name, qty, cents }));

const created = await post({ op: 'create', title: 'Wild Tomato', hostName: 'Nick', venmo: '@nick-szambelan', items: WILD, charge: 18009, people: ['Anna', 'Ben'], device: 'nickphone1' });
const t = created.id, key = created.hostKey;
const S0 = created.state;
const anna = Object.entries(S0.people).find(([, v]) => v.name === 'Anna')[0];
const ben = Object.entries(S0.people).find(([, v]) => v.name === 'Ben')[0];
const item = (name) => S0.items.find((i) => i.name === name).id;

await test('creating a tab returns a host key and phones never see the log or key hash', async () => {
  assert.equal(created.status, 200);
  assert.match(t, /^[a-z0-9]{10}$/);
  assert.ok(key.length >= 32);
  const s = await get(t);
  assert.equal('log' in s, false);
  assert.equal('hostKeyHash' in s, false);
  assert.equal(s.payer.venmo, 'nick-szambelan');
  assert.equal(Object.keys(s.people).length, 3);
});

await test('friends cannot do host-only things', async () => {
  for (const body of [
    { op: 'add', name: 'Cal' }, { op: 'remove', p: ben }, { op: 'setup', charge: 1 }, { op: 'confirm', p: anna },
    { op: 'paid', p: ben, amount: 100, actor: anna }, { op: 'close' }, { op: 'waive', p: ben },
  ]) {
    const r = await post({ t, actor: anna, ...body });
    assert.equal(r.status, 403, JSON.stringify(body));
  }
  const wrongKey = await post({ t, op: 'add', name: 'Cal', key: 'nope' });
  assert.equal(wrongKey.status, 403);
});

await test('unknown tabs are a clean 404', async () => {
  assert.equal((await post({ t: 'zzzzzzzzzz', op: 'join', name: 'X' })).status, 404);
  assert.equal((await post({ t: '../etc', op: 'join', name: 'X' })).status, 404);
});

// Anna: Margherita, a cider, half the curds. Ben: Hot Honey, Tailwagger. Nick: Sausage & Pesto, a cider, half the curds, Bloody Mary.
await post({ t, op: 'event', type: 'link_opened', device: 'annaphone1' });
await post({ t, op: 'pick', p: anna, device: 'annaphone1' });
later(1);
await post({ t, op: 'slots', actor: anna, changes: [
  { a: 'take', i: item('Large Margherita'), p: anna }, { a: 'take', i: item('Von Stiehl Cherry Cider DRFT'), p: anna },
  { a: 'join', i: item('Fried Cheese Curds'), k: 0, p: anna }, { a: 'join', i: item('Fried Cheese Curds'), k: 0, p: HOST },
] });
// Both orders of curds were shared by Anna and Nick
await post({ t, op: 'shareAll', i: item('Fried Cheese Curds'), ps: [anna, HOST], actor: anna });
await post({ t, op: 'slots', key, changes: [
  { a: 'take', i: item('Large Sausage & Pesto'), p: HOST }, { a: 'take', i: item('Von Stiehl Cherry Cider DRFT'), p: HOST }, { a: 'take', i: item('Bloody Mary'), p: HOST },
  // Ben left early; the host claims for him.
  { a: 'take', i: item('Large Hot Honey'), p: ben }, { a: 'take', i: item('New Glarus Tailwagger DRFT'), p: ben },
] });

await test('host-added items are marked as added by the host', async () => {
  const s = await get(t);
  assert.equal(s.by[item('Large Hot Honey')][ben], HOST);
  assert.equal(s.by[item('Fried Cheese Curds')][HOST], anna); // Anna added Nick to the shared curds
});

await test('with a Diet Coke unclaimed, $4 plus its share of extras sits in the pool', async () => {
  const C = compute(await get(t));
  assert.equal(C.openItems.length, 1);
  assert.equal(C.res.reduce((s, r) => s + r.total, 0) + C.pool, 18009);
  assert.equal(C.pool, Math.round(400 * 18009 / 14000));
});

let annaTotal;
await test('tax, fees and tip are split in proportion to items', async () => {
  const C = compute(await get(t));
  annaTotal = C.byId[anna].total;
  // Anna had $25 + $8 + $12 = $45 of $140 in items
  assert.ok(Math.abs(annaTotal - 4500 * 18009 / 14000) < 1, `${annaTotal}`); // within a cent; totals must sum exactly
});

later(2);
await post({ t, op: 'event', type: 'pay_tapped', device: 'annaphone1', actor: anna, amount: annaTotal });
later(1);
await post({ t, op: 'paid', p: anna, amount: annaTotal, actor: anna });

await test('paying locks the total: a later change to a shared item does not move it', async () => {
  // Ben turns out to have shared the curds too (host adds him)
  await post({ t, op: 'shareAll', key, i: item('Fried Cheese Curds'), ps: [anna, HOST, ben] });
  const C = compute(await get(t));
  assert.equal(C.byId[anna].total, annaTotal);
  assert.equal(C.byId[anna].settled, true);
  assert.equal(C.res.reduce((s, r) => s + r.total, 0) + C.pool, 18009);
});

await test('the Diet Coke can be assigned, then nothing is left on the payer', async () => {
  await post({ t, op: 'slots', key, changes: [{ a: 'take', i: item('Diet Coke'), p: ben }] });
  const C = compute(await get(t));
  assert.equal(C.openItems.length, 0);
  // Anna's lock leaves the curds drift in the pool; spreading it settles the rest exactly.
  await post({ t, op: 'setup', key, pool: 'spread' });
  const D = compute(await get(t));
  assert.equal(D.pool, 0);
  assert.equal(D.res.reduce((s, r) => s + r.total, 0), 18009);
  assert.equal(store.raw(keyFor(t)).log.filter((e) => e.type === 'all_claimed').length, 1);
});

await test('"I sent $40": a short payment leaves the rest owed, until the host waives it', async () => {
  const C = compute(await get(t));
  const benTotal = C.byId[ben].total;
  assert.ok(benTotal > 4000);
  await post({ t, op: 'paid', p: ben, amount: 4000, how: 'other', actor: ben });
  let D = compute(await get(t));
  assert.equal(D.byId[ben].owed, benTotal - 4000);
  assert.equal(D.allPaid, false);
  await post({ t, op: 'waive', p: ben, key });
  D = compute(await get(t));
  assert.equal(D.byId[ben].settled, true);
  assert.equal(D.allPaid, true);
  assert.equal(store.raw(keyFor(t)).log.filter((e) => e.type === 'all_paid').length, 1);
});

await test('a closed tab refuses changes until the host reopens it', async () => {
  await post({ t, op: 'close', key });
  assert.equal((await post({ t, op: 'join', name: 'Late' })).status, 400);
  await post({ t, op: 'reopen', key });
  assert.equal((await post({ t, op: 'join', name: 'Late' })).status, 200);
});

await test('report needs the host key and reports the milestones', async () => {
  const no = await handleReport(new Request(`https://x/api/report?t=${t}&key=nope`), store);
  assert.equal(no.status, 403);
  const r = await (await handleReport(new Request(`https://x/api/report?t=${t}&key=${key}`), store)).json();
  assert.equal(r.milestones.link_opened.minutes_from_start, 0);
  assert.ok(r.milestones.all_paid.at);
  assert.equal(r.metrics.adds_up_to_cent, true);
  assert.equal(r.metrics.unconfirmed_venmo_taps, 0);
  assert.equal(r.people.find((p) => p.name === 'Ben').items_added_by_someone_else, true);
});

await test('even split with exclusions: a non-drinker pays only for food', async () => {
  const c = await post({ op: 'create', hostName: 'Nick', items: WILD, charge: 18009, mode: 'even', people: ['Anna', 'Ben'] });
  const s = c.state;
  const a = Object.entries(s.people).find(([, v]) => v.name === 'Anna')[0];
  const drinks = s.items.filter((i) => /DRFT|Mary|Coke/.test(i.name)).map((i) => i.id);
  await post({ t: c.id, op: 'claims', actor: a, changes: drinks.map((i) => ({ i, p: a, u: 0 })) });
  const C = compute((await (await handle(new Request('https://x/api/tab?t=' + c.id), store, now)).json()));
  const food = 2400 + 2500 + 2700 + 2700;
  assert.ok(Math.abs(C.byId[a].total - (food / 3) * 18009 / 14000) < 1);
  assert.equal(C.pool, 0);
  assert.equal(C.res.reduce((x, r) => x + r.total, 0), 18009);
});

await test('to the cent on 3,000 random tabs, with locks, leftovers and both modes', async () => {
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 3000; n++) {
    const items = Array.from({ length: 1 + Math.floor(rnd() * 15) }, (_, k) => ({ id: 'i' + k, name: 'x', qty: rnd() < .3 ? 2 + Math.floor(rnd() * 8) : 1, cents: 1 + Math.floor(rnd() * 6000) }));
    const sum = items.reduce((s, i) => s + i.cents, 0);
    const T = { mode: rnd() < .3 ? 'even' : 'items', items, charge: sum + Math.floor(rnd() * sum * 0.4), people: { host: { name: 'H', t: 0 } }, claims: {}, out: {}, modes: {}, pool: [null, 'spread', 'cover'][Math.floor(rnd() * 3)] };
    const k = 1 + Math.floor(rnd() * 10);
    for (let i = 0; i < k; i++) T.people['p' + i] = { name: 'P' + i, t: i + 1, paid: null, lock: null };
    const ids = Object.keys(T.people);
    const full = rnd() < .5;
    T.slots = {};
    for (const it of items) {
      // each slot: nobody, one person, or a few who shared it
      T.slots[it.id] = Array.from({ length: it.qty }, () => {
        if (!full && rnd() < .4) return [];
        const n = rnd() < .75 ? 1 : 2 + Math.floor(rnd() * 3);
        return [...new Set(Array.from({ length: n }, () => ids[Math.floor(rnd() * ids.length)]))];
      });
      if (T.mode === 'even') for (const p of ids) if (rnd() < .15) (T.out[it.id] ||= {})[p] = true;
    }
    for (const p of ids.slice(1)) if (rnd() < .25) { T.people[p].lock = Math.floor(rnd() * 5000); T.people[p].paid = T.people[p].lock; }
    const C = compute(T);
    assert.equal(C.res.reduce((s, r) => s + r.total, 0) + C.pool, T.charge, `tab ${n}`);
    C.res.forEach((r) => assert.ok(Number.isInteger(r.total), `integer cents, tab ${n}`));
    const anyLock = ids.some((p) => T.people[p].lock != null);
    if (T.pool === 'spread' || T.pool === 'cover') assert.equal(C.pool, 0, `nothing left over, tab ${n}`);
    else if (C.allClaimed && !anyLock) assert.equal(C.pool, 0, `fully claimed tab sums exactly, tab ${n}`);
  }
});

await test('a count repeated in the item name is dropped', async () => {
  const c = await post({ op: 'create', hostName: 'Nick', items: [{ name: '3 Door County Cherry Mojito', qty: 3, cents: 3000 }, { name: '7 Up', qty: 1, cents: 300 }], charge: 3600 });
  assert.equal(c.state.items[0].name, 'Door County Cherry Mojito');
  assert.equal(c.state.items[1].name, '7 Up');
});

await test('one plate split within a count: Ryan has one fish and chips, Haven and Christina share the other', async () => {
  const c = await post({ op: 'create', hostName: 'Nick', items: [{ name: 'Fish and Chips', qty: 2, cents: 3390 }], charge: 3390, people: ['Ryan', 'Haven', 'Christina'] });
  const id = c.id, k = c.hostKey, s = c.state;
  const p = (n) => Object.entries(s.people).find(([, v]) => v.name === n)[0];
  const fish = s.items[0].id;
  await post({ t: id, op: 'slots', actor: p('Ryan'), changes: [{ a: 'take', i: fish, p: p('Ryan') }] });
  await post({ t: id, op: 'slots', actor: p('Haven'), changes: [{ a: 'take', i: fish, p: p('Haven') }] });
  await post({ t: id, op: 'slots', actor: p('Christina'), changes: [{ a: 'join', i: fish, k: 1, p: p('Christina') }] });
  const T = await (await handle(new Request('https://x/api/tab?t=' + id), store, now)).json();
  const C = compute(T);
  assert.deepEqual(T.slots[fish], [[p('Ryan')], [p('Haven'), p('Christina')]]);
  assert.equal(C.byId[p('Ryan')].total, 1695);
  assert.equal(C.byId[p('Haven')].total + C.byId[p('Christina')].total, 1695);
  assert.ok(Math.abs(C.byId[p('Haven')].total - C.byId[p('Christina')].total) <= 1);
  assert.equal(C.allClaimed, true);
  assert.equal(C.byId[p('Haven')].lines[0].label, 'Fish and Chips, split with Christina');
  // Nobody can take a third one
  const r = await post({ t: id, op: 'slots', key: k, changes: [{ a: 'take', i: fish, p: HOST }] });
  assert.equal(r.status, 400);
});

await test('tabs saved with the old per-person counts turn into slots', async () => {
  const s2 = fakeStore();
  const old = { v: 2, id: 'abcdefghij', rev: 4, hostKeyHash: 'x', title: 'Old', payer: { name: 'Nick', venmo: '' }, mode: 'items', charge: 4200,
    items: [{ id: 'k', name: 'Carbliss', qty: 7, cents: 4200 }, { id: 'c', name: 'Curds', qty: 3, cents: 2685 }],
    people: { host: { name: 'Nick', t: 0 }, a: { name: 'Anna', t: 1 } }, claims: { k: { host: 4, a: 2 }, c: { host: 1, a: 1 } }, modes: { c: 'share' }, out: {}, by: {}, log: [] };
  await s2.setJSON(keyFor('abcdefghij'), old);
  const before = compute(old);
  await handle(new Request('https://x/api/tab', { method: 'POST', body: JSON.stringify({ t: 'abcdefghij', op: 'join', name: 'Cal' }) }), s2, now);
  const T = s2.raw(keyFor('abcdefghij'));
  assert.deepEqual(T.slots.k, [['host'], ['host'], ['host'], ['host'], ['a'], ['a'], []]);
  assert.deepEqual(T.slots.c, [['host', 'a'], ['host', 'a'], ['host', 'a']]);
  const after = compute(T);
  assert.equal(after.byId.host.total, before.byId.host.total);
  assert.equal(after.byId.a.total, before.byId.a.total);
});

await test('a preview tab can be brought to the live site once, only with its host key', async () => {
  const preview = fakeStore(), live = fakeStore();
  const c = await post({ op: 'create', hostName: 'Nick', items: WILD, charge: 18009, people: ['Anna'] }, preview);
  const imp = async (key) => {
    const res = await handle(new Request('https://x/api/tab', { method: 'POST', body: JSON.stringify({ op: 'import', t: c.id, key }) }), live, now, preview);
    return { status: res.status, ...(await res.json()) };
  };
  assert.equal((await imp('wrong')).status, 404);
  const ok = await imp(c.hostKey);
  assert.equal(ok.status, 200);
  assert.equal(Object.keys(ok.state.people).length, 2);
  assert.equal(live.raw(keyFor(c.id)).hostKeyHash, preview.raw(keyFor(c.id)).hostKeyHash);
  assert.equal((await imp(c.hostKey)).status, 409);
  // and previews themselves can't import
  const res = await handle(new Request('https://x/api/tab', { method: 'POST', body: JSON.stringify({ op: 'import', t: c.id, key: c.hostKey }) }), live, now, null);
  assert.equal(res.status, 404);
});

await test('the host can offer Cash App, PayPal and Zelle as well as Venmo, and keep totals private', async () => {
  const s = fakeStore();
  const c = await post({ op: 'create', hostName: 'Nick', venmo: '@nick', cashapp: '$NickS', paypal: 'https://paypal.me/nicks/', zelle: '(555) 123-4567', items: WILD, charge: 18009, people: ['Anna'] }, s);
  assert.equal(c.status, 200);
  assert.deepEqual(c.state.payer, { name: 'Nick', venmo: 'nick', cashapp: 'NickS', paypal: 'nicks', zelle: '(555) 123-4567' });
  assert.equal(c.state.private, false);
  assert.equal((await post({ op: 'create', hostName: 'Nick', cashapp: '$123', items: WILD, charge: 18009 }, s)).status, 400, 'a cashtag needs a letter');
  assert.equal((await post({ op: 'create', hostName: 'Nick', zelle: 'not an address', items: WILD, charge: 18009 }, s)).status, 400);
  const a = Object.keys(c.state.people).find((p) => p !== HOST);
  assert.equal((await post({ t: c.id, op: 'setup', private: true, actor: a }, s)).status, 403, 'only the host changes settings');
  const r = await post({ t: c.id, op: 'setup', key: c.hostKey, private: true, zelle: 'nick@example.com', cashapp: '' }, s);
  assert.equal(r.state.private, true);
  assert.equal(r.state.payer.zelle, 'nick@example.com');
  assert.equal(r.state.payer.cashapp, '');
  await post({ t: c.id, op: 'paid', p: a, amount: 100, how: 'cashapp', actor: a }, s);
  assert.equal(s.raw(keyFor(c.id)).log.at(-1).how, 'cashapp');
});

await test('apportion always adds up', async () => {
  assert.deepEqual(apportion(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(apportion(5, [0, 0]), [3, 2]);
  assert.equal(apportion(18009, [4500, 3400, 6100]).reduce((a, b) => a + b, 0), 18009);
});

// ---------- Receipt reading ----------
const goodReceipt = { items: [{ name: 'A', quantity: 1, price: 10 }, { name: 'B', quantity: 2, price: 5.5 }], subtotal: 15.5, fees: [], total: 17, tip: 3, tip_included_in_total: false, card_charge: null };
const badReceipt = { ...goodReceipt, items: [{ name: 'A', quantity: 1, price: 10 }] };
const fakeGateway = (byModel) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b.model);
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: byModel[b.model] }], usage: { input_tokens: 3000, output_tokens: 800 } }));
  };
  return { fetchImpl, calls };
};
const env = { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_API_KEY: 'k' };
const img = 'A'.repeat(200);

await test('receipt check and the charge guess', async () => {
  assert.equal(addsUp(goodReceipt), true);
  assert.equal(addsUp(badReceipt), false);
  assert.equal(likelyCharge(goodReceipt), 2000); // total plus a tip printed outside it
  assert.equal(likelyCharge({ ...goodReceipt, card_charge: 21.5 }), 2150);
});

await test('Haiku reads it when the items add up; Sonnet is not called', async () => {
  const s = fakeStore();
  const g = fakeGateway({ 'claude-haiku-5-5': goodReceipt });
  const r = await readReceipt({ imageBase64: img, store: s, cap: 30, env, fetchImpl: g.fetchImpl });
  assert.deepEqual(g.calls, ['claude-haiku-5-5']);
  assert.equal(r.check, 'matched');
  assert.equal(r.charge, 2000);
});

await test('Sonnet rereads when Haiku does not add up', async () => {
  const s = fakeStore();
  const g = fakeGateway({ 'claude-haiku-5-5': badReceipt, 'claude-sonnet-5': goodReceipt });
  const r = await readReceipt({ imageBase64: img, store: s, cap: 30, env, fetchImpl: g.fetchImpl });
  assert.deepEqual(g.calls, ['claude-haiku-5-5', 'claude-sonnet-5']);
  assert.equal(r.model, 'sonnet');
  assert.equal(r.check, 'matched');
});

await test('when both miss, the result comes back flagged for the host to fix', async () => {
  const s = fakeStore();
  const g = fakeGateway({ 'claude-haiku-5-5': badReceipt, 'claude-sonnet-5': badReceipt });
  const r = await readReceipt({ imageBase64: img, store: s, cap: 30, env, fetchImpl: g.fetchImpl });
  assert.equal(r.check, 'flagged');
});

await test('the monthly cap counts simultaneous scans and then stops scanning', async () => {
  const s = fakeStore();
  const g = fakeGateway({ 'claude-haiku-5-5': goodReceipt });
  await Promise.all(Array.from({ length: 6 }, () => readReceipt({ imageBase64: img, store: s, cap: 0.5, env, fetchImpl: g.fetchImpl })));
  const month = new Date().toISOString().slice(0, 7);
  const spent = s.raw(`budget/${month}`).credits;
  assert.ok(Math.abs(spent - 6 * 0.126) < 0.01, `counted ${spent}`);
  await assert.rejects(readReceipt({ imageBase64: img, store: s, cap: 0.5, env, fetchImpl: g.fetchImpl }), /paused/);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
