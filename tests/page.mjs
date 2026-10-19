// Run with: npm run test:page   (needs jsdom: npm i --no-save jsdom)
// Drives the real page code, one phone at a time, against the real server code.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { handle, keyFor, HOST } from '../netlify/lib/core.mjs';
import { compute } from '../public/split.mjs';
import { fakeStore } from './fake-store.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const html = readFileSync(here('../public/index.html'), 'utf8');
const appUrl = pathToFileURL(here('../public/app.mjs')).href;
const store = fakeStore();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let phoneCount = 0;

async function serve(url, init = {}) {
  const req = new Request('https://tab.test' + url, init);
  if (new URL(req.url).pathname === '/api/tab') return handle(req, store);
  return new Response(JSON.stringify({ error: 'not here' }), { status: 404 });
}

// Opens the page at `path` on a fresh "phone" and returns helpers for it.
async function phone(path) {
  const dom = new JSDOM(html, { url: 'https://tab.test' + path });
  const w = dom.window;
  const D = w.HTMLDialogElement.prototype;
  D.showModal = function () { this.setAttribute('open', ''); };
  D.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  w.scrollTo = () => {};
  w.open = () => null;
  w.confirm = () => true;
  w.navigator.sendBeacon = (url, blob) => { blob.text().then((body) => serve(url, { method: 'POST', body })); return true; };
  const shared = [];
  Object.defineProperty(w.navigator, 'share', { value: async ({ text }) => { shared.push(text); }, configurable: true });
  Object.assign(globalThis, { window: w, document: w.document, location: w.location, history: w.history, localStorage: w.localStorage, confirm: w.confirm });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  globalThis.fetch = (url, init) => serve(String(url), init);
  await import(appUrl + '?phone=' + (++phoneCount));
  await tick(30);
  const $ = (s) => w.document.querySelector(s);
  const click = async (sel) => { const el = typeof sel === 'string' ? $(sel) : sel; assert.ok(el, `nothing matches ${sel}`); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await tick(30); };
  const type = async (sel, value) => { const el = typeof sel === 'string' ? $(sel) : sel; assert.ok(el, `nothing matches ${sel}`); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(); };
  const submit = async (sel) => { $(sel).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(30); };
  const settle = () => tick(400); // let queued claims save
  const text = (sel = 'body') => $(sel).textContent.replace(/\s+/g, ' ');
  return { w, $, click, type, submit, settle, text, shared };
}

let failures = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 4).join('\n     ')); } };

const WILD = [['Fried Cheese Curds', 2, '24.00'], ['Large Margherita', 1, '25.00'], ['Large Sausage & Pesto', 1, '27.00'], ['Large Hot Honey', 1, '27.00'],
  ['Von Stiehl Cherry Cider DRFT', 2, '16.00'], ['New Glarus Tailwagger DRFT', 1, '7.00'], ['Bloody Mary', 1, '10.00'], ['Diet Coke', 1, '4.00']];
let tabId, hostKey;
const raw = () => store.raw(keyFor(tabId));
const pid = (name) => Object.entries(raw().people).find(([, v]) => v.name === name)[0];
const iid = (name) => raw().items.find((i) => i.name === name).id;

// ---------- Nick starts the tab by typing the receipt ----------
const nick = await phone('/');
await step('start screen offers a photo or typing', async () => {
  assert.match(nick.text('#app'), /Take a photo of the receipt/);
  await nick.click('[data-act="type"]');
  assert.equal(nick.w.document.querySelectorAll('.ie').length, 2);
});
await step('typing the Wild Tomato receipt shows tax, fees and tip as the difference', async () => {
  for (let k = 2; k < WILD.length; k++) await nick.click('[data-act="addline"]');
  const rows = nick.w.document.querySelectorAll('.ie');
  for (const [k, [name, qty, price]] of WILD.entries()) {
    await nick.type(rows[k].querySelector('[data-f="name"]'), name);
    await nick.type(rows[k].querySelector('[data-f="qty"]'), String(qty));
    await nick.type(rows[k].querySelector('[data-f="price"]'), price);
  }
  await nick.type('#tTitle', 'Wild Tomato');
  await nick.type('#charge', '180.09');
  assert.match(nick.text('#reviewStatus'), /Tax, fees and tip: \$40\.09/);
});
await step('adding people and creating the tab makes Nick the host', async () => {
  await nick.click('[data-act="toPeople"]');
  await nick.type('#hostName', 'Nick');
  await nick.type('#venmo', '@nick-szambelan');
  for (const n of ['Anna', 'Ben']) { nick.$('#addName').value = n; await nick.submit('#addForm'); }
  assert.match(nick.text('#chips'), /Anna.*Ben/);
  await nick.click('[data-act="create"]');
  const m = nick.w.location.pathname.match(/^\/t\/([a-z0-9]{10})$/);
  assert.ok(m, nick.w.location.pathname);
  tabId = m[1];
  hostKey = nick.w.localStorage.getItem('tab-host:' + tabId);
  assert.ok(hostKey);
  assert.ok(nick.$('#sheet').hasAttribute('open'), 'the "send the link" sheet opens');
  assert.equal(raw().charge, 18009);
  assert.equal(raw().payer.venmo, 'nick-szambelan');
  assert.match(nick.text('#app'), /People/);
});
await step('Nick claims his own items and adds Ben’s for him', async () => {
  await nick.click('[data-act="close-sheet"]');
  await nick.click('[data-act="view"][data-v="items"]');
  await nick.click(`[data-act="toggle"][data-i="${iid('Large Sausage & Pesto')}"]`);
  await nick.click(`[data-act="toggle"][data-i="${iid('Bloody Mary')}"]`);
  await nick.click(`[data-act="slot"][data-i="${iid('Von Stiehl Cherry Cider DRFT')}"][data-owner=""]`);
  await nick.click('[data-act="view"][data-v="people"]');
  await nick.click(`[data-act="editfor"][data-p="${pid('Ben')}"]`);
  assert.match(nick.text('#app'), /Editing Ben’s items/);
  await nick.click(`[data-act="toggle"][data-i="${iid('Large Hot Honey')}"]`);
  await nick.click(`[data-act="toggle"][data-i="${iid('New Glarus Tailwagger DRFT')}"]`);
  assert.match(nick.text('#dockIn'), /Ben’s total/);
  await nick.click('#dockIn [data-act="editdone"]');
  assert.match(nick.text('#app'), /Large Hot Honey/); // shown on Ben's card in People
  await nick.settle();
  const T = raw();
  assert.deepEqual(T.slots[iid('Large Hot Honey')], [[pid('Ben')]]);
  assert.equal(T.by[iid('Large Hot Honey')][pid('Ben')], HOST);
  assert.deepEqual(T.slots[iid('Bloody Mary')], [[HOST]]);
});

// ---------- Anna opens the group link ----------
const anna = await phone('/t/PLACEHOLDER'.replace('PLACEHOLDER', tabId));
let annaOwed;
await step('the items page separates what needs someone from what is claimed, with names', async () => {
  await nick.click('[data-act="view"][data-v="items"]');
  const groups = [...nick.w.document.querySelectorAll('h2.group')].map((h) => h.textContent.replace(/\s+/g, ' ').trim());
  assert.match(groups[0], /^Needs someone/);
  assert.match(groups[1], /^Claimed/);
  assert.match(nick.text('#app'), /Ben/);
  await nick.click('[data-act="view"][data-v="people"]');
});

await step('Anna sees the names Nick added and taps hers', async () => {
  assert.match(anna.text('#app'), /Who are you\?/);
  assert.match(anna.text('#app'), /Anna/);
  await anna.click(`[data-act="pick"][data-p="${pid('Anna')}"]`);
  assert.match(anna.text('#app'), /Tap what you had/);
});
await step('Anna claims her pizza and cider, and shares the curds with Nick', async () => {
  await anna.click(`[data-act="toggle"][data-i="${iid('Large Margherita')}"]`);
  const cider = iid('Von Stiehl Cherry Cider DRFT');
  // Nick's cider isn't hers: tapping it asks whether she shared it, and changes nothing yet
  await anna.click(`[data-act="slot"][data-i="${cider}"][data-owner="${HOST}"]`);
  assert.match(anna.text('#sheetBody'), /Did you share it\?/);
  await anna.click('#sheetBody [data-act="close-sheet"]');
  assert.deepEqual(raw().slots[cider], [[HOST], []]);
  await anna.click(`[data-act="slot"][data-i="${cider}"][data-owner=""]`);
  const owners = [...anna.w.document.querySelectorAll(`[data-act="slot"][data-i="${cider}"]`)].map((b) => b.dataset.owner);
  assert.deepEqual(owners, [HOST, pid('Anna')], 'one slot each, nothing open');
  // Both curds were shared with Nick: tick both of them on the first, then "same for all"
  await anna.click(`[data-act="item"][data-i="${iid('Fried Cheese Curds')}"]`);
  await anna.click(`#sheetBody [data-act="s-toggle"][data-p="${pid('Anna')}"]`);
  await anna.click(`#sheetBody [data-act="s-toggle"][data-p="${HOST}"]`);
  await anna.click('#sheetBody [data-act="s-all"]');
  await anna.settle();
  await anna.click('#sheetBody [data-act="close-sheet"]');
  await anna.settle();
  const C = compute(raw());
  annaOwed = C.byId[pid('Anna')].total;
  assert.ok(Math.abs(annaOwed - 4500 * 18009 / 14000) < 1);
  assert.match(anna.text('#dockIn'), new RegExp('\\$' + (annaOwed / 100).toFixed(2)));
});
await step('Review and pay opens Venmo with the exact amount, and coming back marks her paid', async () => {
  await anna.click('#dockIn [data-act="mine"]');
  const a = anna.$('#sheetBody a[data-act="venmo"]');
  assert.ok(a);
  assert.match(a.href, /^https:\/\/venmo\.com\/nick-szambelan\?txn=pay&amount=/);
  assert.ok(a.href.includes('amount=' + (annaOwed / 100).toFixed(2)));
  await anna.click(a);
  Object.defineProperty(anna.w.document, 'hidden', { value: false, configurable: true });
  anna.w.document.dispatchEvent(new anna.w.Event('visibilitychange'));
  Object.defineProperty(anna.w.document, 'hidden', { value: true, configurable: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.match(anna.text('#sheetBody'), /Did your Venmo go through\?/);
  await anna.click('#sheetBody [data-act="paidyes"]');
  const p = raw().people[pid('Anna')];
  assert.equal(p.paid, annaOwed);
  assert.equal(p.lock, annaOwed);
  assert.match(anna.text('#dockIn'), /all set/);
  assert.ok(raw().log.some((e) => e.type === 'pay_tapped' && e.person === pid('Anna')));
});

await step('friends can open People and see everyone’s breakdown, without host buttons', async () => {
  await anna.click('[data-act="view"][data-v="people"]');
  const t = anna.text('#app');
  assert.match(t, /Ben/);
  assert.match(t, /Large Hot Honey/);
  assert.match(t, /Paid the bill/);
  assert.equal(anna.$('[data-act="remind"]'), null);
  assert.equal(anna.$('[data-act="remove"]'), null);
  assert.equal(anna.$('[data-act="pool"]'), null);
  assert.equal(anna.$('#addPerson'), null);
  await anna.click('[data-act="view"][data-v="items"]');
});

// ---------- Ben opens his personal reminder link ----------
const ben = await phone(`/t/${tabId}?p=${pid('Ben')}`);
let benTotal;
await step('Ben’s personal link opens straight to his items, marked as added by Nick', async () => {
  assert.doesNotMatch(ben.text('#app'), /Who are you\?/);
  assert.match(ben.text('#app'), /Added by Nick/);
  benTotal = compute(raw()).byId[pid('Ben')].total;
});
await step('"I paid another way" records $40, not the full amount', async () => {
  await ben.click('#dockIn [data-act="mine"]');
  await ben.click('#sheetBody [data-act="other"]');
  ben.$('#amount').value = '40';
  await ben.submit('#amountForm');
  const p = raw().people[pid('Ben')];
  assert.equal(p.paid, 4000);
  assert.match(ben.text('#dockIn'), /Still to pay/);
  assert.match(ben.text('#dockIn'), new RegExp('\\$' + ((benTotal - 4000) / 100).toFixed(2)));
});

// ---------- Nick, back on his host link, settles the rest ----------
const nick2 = await phone(`/t/${tabId}#h=${hostKey}`);
await step('the host link restores the host view', async () => {
  assert.match(nick2.text('#app'), /1 item needs someone/);
  assert.match(nick2.text('#app'), /Diet Coke/);
});
await step('Nick gives the Diet Coke to Ben and lets Ben’s remainder go', async () => {
  await nick2.click(`[data-act="assign"][data-i="${iid('Diet Coke')}"]`);
  await nick2.click(`#sheetBody [data-act="give"][data-p="${pid('Ben')}"]`);
  await nick2.settle();
  assert.deepEqual(raw().slots[iid('Diet Coke')], [[pid('Ben')]]);
  await nick2.click(`[data-act="waive"][data-p="${pid('Ben')}"]`);
  const C = compute(raw());
  assert.equal(C.byId[pid('Ben')].settled, true);
});
await step('a private reminder names one person, their amount and their own link', async () => {
  // Re-open Ben's remainder as owed to test the wording, then undo
  await nick2.click(`[data-act="unpaid"][data-p="${pid('Ben')}"]`);
  await nick2.click(`[data-act="remind"][data-p="${pid('Ben')}"]`);
  const msg = nick2.shared.at(-1);
  assert.match(msg, /^Hi Ben!/);
  assert.ok(msg.includes(`/t/${tabId}?p=${pid('Ben')}`));
  assert.doesNotMatch(msg, /Anna/);
});
await step('once everyone has paid and nothing is uncovered, the totals add up to the cent and the tab closes', async () => {
  const owed = compute(raw()).byId[pid('Ben')].owed;
  await nick2.click(`[data-act="markpaid"][data-p="${pid('Ben')}"]`);
  nick2.$('#amount').value = (owed / 100).toFixed(2);
  await nick2.submit('#amountForm');
  let C = compute(raw());
  if (Math.abs(C.pool) > 1) { await nick2.click('[data-act="pool"][data-v="spread"]'); C = compute(raw()); }
  assert.equal(C.res.reduce((s, r) => s + r.total, 0) + C.pool, 18009);
  assert.equal(C.allPaid, true, JSON.stringify({ pool: C.pool, res: C.res.map((r) => [r.p.name, r.total, r.owed, r.settled]) }));
  await nick2.click('[data-act="close"]');
  assert.equal(raw().closed, true);
  assert.match(nick2.text('#app'), /This tab is closed/);
});

console.log(failures ? `\n${failures} failed` : '\nall page steps passed');
process.exit(failures ? 1 : 0);
