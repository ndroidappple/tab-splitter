// The tab page: start a tab (host), claim and pay (friends), and the host's panel.
import { HOST, SLACK, compute, people as peopleOf, itemsTotal } from './split.mjs';

const API = '/api/tab';
const PALETTE = ['#2F5BD3', '#0E8A5C', '#C2410C', '#7C3AED', '#0E7490', '#BE185D', '#4D7C0F', '#A16207', '#4338CA', '#0F766E', '#9D174D', '#475569'];
const $ = (s) => document.querySelector(s);
const app = $('#app');

/* ---------- Small helpers ---------- */
const fmt = (c) => (c < 0 ? '−' : '') + '$' + (Math.abs(Math.round(c)) / 100).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const initial = (n) => (Array.from(String(n).trim())[0] || '?').toUpperCase();
const pc = (p) => PALETTE[((p && p.color) || 0) % PALETTE.length];
const av = (p, cls = '') => `<span class="av ${cls}" style="--pc:${pc(p)}" aria-hidden="true">${esc(initial(p.name))}</span>`;
const toCents = (v) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const dollars = (c) => (c == null || Number.isNaN(c) ? '' : (c / 100).toFixed(2));
function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000);
}
const CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- Where we are ---------- */
const m = location.pathname.match(/^\/t\/([a-z0-9]{10})\/?$/);
let tabId = m ? m[1] : new URLSearchParams(location.search).get('t');
if (tabId && !/^[a-z0-9]{10}$/.test(tabId)) tabId = null;
if (tabId && location.hash.startsWith('#h=')) {
  store.set('tab-host:' + tabId, location.hash.slice(3));
  history.replaceState(null, '', location.pathname + location.search);
}
let hostKey = tabId ? store.get('tab-host:' + tabId) : null;
let isHost = false;
let me = tabId ? store.get('tab-me:' + tabId) : null;
const linkPerson = new URLSearchParams(location.search).get('p');

let DEVICE = store.get('tab-device');
if (!DEVICE || !/^[a-z0-9]{4,24}$/.test(DEVICE)) { DEVICE = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); store.set('tab-device', DEVICE); }

/* ---------- Talking to the server ---------- */
function body(extra) { return Object.assign({ t: tabId, device: DEVICE, actor: me || undefined, key: hostKey || undefined }, extra); }
async function post(b) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true });
  let d = {};
  try { d = await r.json(); } catch (e) { /* empty */ }
  if (!r.ok) { const err = new Error(d.error || 'Couldn’t save that. Check your connection.'); err.status = r.status; throw err; }
  online(true);
  return d;
}
function beacon(extra) {
  const text = JSON.stringify(body(extra));
  try { if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([text], { type: 'text/plain' }))) return; } catch (e) { /* fall through */ }
  fetch(API, { method: 'POST', body: text, keepalive: true }).catch(() => {});
}
const track = (type, extra) => beacon(Object.assign({ op: 'event', type }, extra));
function online(ok) { $('#netbar').hidden = ok; }

/* ======================================================================
   Starting a tab
   ====================================================================== */
const profile = (() => { try { return JSON.parse(store.get('tab-profile') || '{}'); } catch (e) { return {}; } })();
const S = { step: 'photo', title: '', items: [], charge: '', receipt: null, check: null, scan: null, busy: false, hostName: profile.name || '', venmo: profile.venmo || '', people: [], mode: 'items' };

function renderStart() {
  $('#title').textContent = 'Split a tab';
  $('#subtitle').textContent = '';
  $('#meBtn').hidden = true;
  $('#dock').hidden = true;
  if (S.step === 'photo') {
    app.innerHTML = `
      <h1>Split a tab</h1>
      <p class="lede">Snap the receipt. Everyone taps what they had and pays you back on Venmo, with tax and tip worked out.</p>
      <div class="stack">
        <label class="btn wide" for="photo">Take a photo of the receipt</label>
        <input id="photo" type="file" accept="image/*" class="sr">
        <button type="button" class="btn ghost wide" data-act="type">Type the items instead</button>
      </div>
      <p id="scanStatus" class="note" role="status" aria-live="polite">${S.busy ? '<span class="spin"></span> Reading the receipt…' : ''}</p>`;
    $('#photo').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) scanPhoto(f); });
    return;
  }
  if (S.step === 'review') return renderReview();
  if (S.step === 'people') return renderPeople();
}

async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]; // re-encoding drops the photo's location data
  } finally { URL.revokeObjectURL(url); }
}

async function scanPhoto(file) {
  S.busy = true; renderStart();
  try {
    const image = await shrink(file);
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Couldn’t read that receipt.');
    const rc = d.receipt || {};
    S.receipt = rc; S.check = d.check; S.scan = d.model;
    S.title = rc.merchant || '';
    S.items = (rc.items || []).map((it) => ({ name: it.name || '', qty: it.quantity || 1, price: dollars(Math.round((it.price || 0) * 100)) }));
    S.charge = dollars(d.charge);
    S.step = 'review';
  } catch (e) {
    toast(e.message + ' You can type the items instead.');
  } finally { S.busy = false; renderStart(); }
}

function reviewNumbers() {
  const sum = S.items.reduce((s, it) => s + (toCents(it.price) || 0), 0);
  const rc = S.receipt;
  const inSub = rc && Array.isArray(rc.fees) ? rc.fees.filter((f) => f.listed_with_items).reduce((s, f) => s + Math.round(f.amount * 100), 0) : 0;
  const printed = rc ? Math.round(((rc.subtotal ?? rc.total) || 0) * 100) : null;
  return { sum, printed, inSub, charge: toCents(S.charge) };
}
function reviewStatus() {
  const n = reviewNumbers();
  const parts = [];
  if (n.printed) {
    const diff = n.printed - n.inSub - n.sum;
    if (Math.abs(diff) < 1) parts.push(`<p class="banner ok">The items add up to the receipt’s ${fmt(n.printed)} subtotal.</p>`);
    else parts.push(`<p class="banner warn">The items add up to ${fmt(n.sum + n.inSub)}, but the receipt says ${fmt(n.printed)}. Check the lines against the photo.</p>`);
  }
  if (Number.isFinite(n.charge) && n.charge > 0) {
    if (n.charge < n.sum) parts.push(`<p class="banner warn">The card charge is less than the items. Check it.</p>`);
    else parts.push(`<p class="note money">Tax, fees and tip: ${fmt(n.charge - n.sum)}, split by what each person had.</p>`);
  }
  return parts.join('');
}
function renderReview() {
  const rc = S.receipt || {};
  const notes = [];
  if (rc.gratuity) notes.push(`This receipt already includes a ${fmt(Math.round(rc.gratuity * 100))} gratuity, so no extra tip is needed.`);
  if (rc.tip && rc.tip_included_in_total === false) notes.push(`Includes the ${fmt(Math.round(rc.tip * 100))} tip written below the total.`);
  if (rc.card_charge == null && rc.total != null && !rc.tip) notes.push('If you added a tip when you paid, include it.');
  app.innerHTML = `
    <h1>Check the receipt</h1>
    <p class="lede">${S.receipt ? 'Fix anything that doesn’t match the paper.' : 'Add each line from the receipt.'}</p>
    <label class="f" for="tTitle">Name this tab</label>
    <input id="tTitle" class="in" value="${esc(S.title)}" placeholder="Friday dinner" maxlength="60" autocomplete="off">
    <h2>Items</h2>
    <div class="ie-head" aria-hidden="true"><span>Item</span><span>Qty</span><span>Line total</span><span></span></div>
    <div class="items-edit" id="itemsEdit">${S.items.map(itemRow).join('')}</div>
    <button type="button" class="link" data-act="addline">+ Add a line</button>
    <label class="f" for="charge">What your card was charged, with tip</label>
    <input id="charge" class="in money" inputmode="decimal" value="${esc(S.charge)}" placeholder="0.00" autocomplete="off">
    ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
    <div id="reviewStatus" role="status" aria-live="polite" style="margin-top:12px">${reviewStatus()}</div>
    <div class="sh-foot"><button type="button" class="btn wide" data-act="toPeople">Next: who was there</button>
    <button type="button" class="btn ghost wide" data-act="restart">Start over</button></div>`;
}
const itemRow = (it, k) => `<div class="ie" data-k="${k}">
  <input class="in" data-f="name" aria-label="Item ${k + 1} name" value="${esc(it.name)}" maxlength="60" autocomplete="off">
  <input class="in" data-f="qty" aria-label="Item ${k + 1} quantity" inputmode="numeric" value="${esc(it.qty)}">
  <input class="in money" data-f="price" aria-label="Item ${k + 1} line total in dollars" inputmode="decimal" value="${esc(it.price)}" placeholder="0.00">
  <button type="button" class="x" data-act="delline" data-k="${k}" aria-label="Remove item ${k + 1}">×</button></div>`;

function renderPeople() {
  app.innerHTML = `
    <h1>Who was there?</h1>
    <p class="lede">Add everyone now, including anyone who already left. You can add items for them later.</p>
    <div class="row2">
      <div><label class="f" for="hostName">Your name</label><input id="hostName" class="in" value="${esc(S.hostName)}" maxlength="24" autocomplete="given-name"></div>
      <div><label class="f" for="venmo">Your Venmo username</label><input id="venmo" class="in" value="${esc(S.venmo)}" placeholder="@username" autocapitalize="off" autocorrect="off" maxlength="41"></div>
    </div>
    <label class="f" for="addName">Everyone else</label>
    <form id="addForm" class="row2" autocomplete="off"><input id="addName" class="in" placeholder="Name" maxlength="24" enterkeyhint="done"><button class="btn" type="submit" style="flex:0 0 auto">Add</button></form>
    <div class="chips" id="chips">${S.people.map((n, k) => `<span class="chip">${esc(n)}<button type="button" data-act="delname" data-k="${k}" aria-label="Remove ${esc(n)}">×</button></span>`).join('')}</div>
    <h2>How to split</h2>
    <label class="choice"><input type="radio" name="mode" value="items" ${S.mode === 'items' ? 'checked' : ''}><span><b>Everyone taps what they had</b><span>Best when people ordered different things.</span></span></label>
    <label class="choice"><input type="radio" name="mode" value="even" ${S.mode === 'even' ? 'checked' : ''}><span><b>Split evenly, minus what people skipped</b><span>Best for big groups and shared plates. People untick what they didn’t have.</span></span></label>
    <div class="sh-foot"><button type="button" class="btn wide" data-act="create">Create the tab</button>
    <button type="button" class="btn ghost wide" data-act="back">Back to the receipt</button></div>`;
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('#addName').value.replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (!S.people.some((x) => x.toLowerCase() === n.toLowerCase())) S.people.push(n);
    S.hostName = $('#hostName').value; S.venmo = $('#venmo').value;
    renderPeople(); $('#addName').focus();
  });
}

app.addEventListener('input', (e) => {
  if (tabId) return;
  const row = e.target.closest('.ie');
  if (row) { S.items[Number(row.dataset.k)][e.target.dataset.f] = e.target.value; setHTML($('#reviewStatus'), reviewStatus()); return; }
  if (e.target.id === 'charge') { S.charge = e.target.value; setHTML($('#reviewStatus'), reviewStatus()); }
  if (e.target.id === 'tTitle') S.title = e.target.value;
  if (e.target.id === 'hostName') S.hostName = e.target.value;
  if (e.target.id === 'venmo') S.venmo = e.target.value;
  if (e.target.name === 'mode') S.mode = e.target.value;
});
app.addEventListener('change', (e) => { if (!tabId && e.target.name === 'mode') S.mode = e.target.value; });

function validItems() {
  const out = [];
  for (const [k, it] of S.items.entries()) {
    if (!it.name.trim() && !it.price) continue;
    const cents = toCents(it.price), qty = Number(it.qty || 1);
    if (!it.name.trim()) throw new Error(`Line ${k + 1} needs a name`);
    if (!Number.isInteger(cents) || cents < 0) throw new Error(`Check the price on line ${k + 1}`);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Check the quantity on line ${k + 1}`);
    out.push({ name: it.name.trim(), qty, cents });
  }
  if (!out.length) throw new Error('Add at least one item');
  return out;
}

async function createTab() {
  let items;
  try { items = validItems(); } catch (e) { toast(e.message); return; }
  const charge = toCents(S.charge);
  if (!Number.isInteger(charge) || charge <= 0) { toast('Enter what your card was charged'); S.step = 'review'; renderStart(); return; }
  if (!S.hostName.trim()) { toast('Enter your name'); $('#hostName').focus(); return; }
  const btn = app.querySelector('[data-act="create"]'); btn.disabled = true;
  try {
    const d = await post({ op: 'create', title: S.title, hostName: S.hostName.trim(), venmo: S.venmo.trim(), items, charge, people: S.people, mode: S.mode, device: DEVICE, scan: S.scan || 'typed' });
    store.set('tab-profile', JSON.stringify({ name: S.hostName.trim(), venmo: S.venmo.trim() }));
    tabId = d.id; hostKey = d.hostKey; me = HOST; isHost = true;
    store.set('tab-host:' + tabId, hostKey); store.set('tab-me:' + tabId, HOST);
    history.pushState(null, '', '/t/' + tabId);
    T = d.state; view = 'people';
    renderAll(); poll();
    openSheet({ type: 'created' });
  } catch (e) { toast(e.message); btn.disabled = false; }
}

app.addEventListener('click', (e) => {
  if (tabId) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'type') { S.step = 'review'; S.receipt = null; S.scan = null; if (!S.items.length) S.items = [{ name: '', qty: 1, price: '' }, { name: '', qty: 1, price: '' }]; renderStart(); app.querySelector('.ie input').focus(); }
  if (a === 'addline') { S.items.push({ name: '', qty: 1, price: '' }); renderStart(); const ins = app.querySelectorAll('.ie'); ins[ins.length - 1].querySelector('input').focus(); }
  if (a === 'delline') { S.items.splice(Number(b.dataset.k), 1); renderStart(); }
  if (a === 'toPeople') { try { validItems(); } catch (err) { toast(err.message); return; } const c = toCents(S.charge); if (!Number.isInteger(c) || c <= 0) { toast('Enter what your card was charged'); $('#charge').focus(); return; } S.step = 'people'; renderStart(); window.scrollTo(0, 0); }
  if (a === 'back') { S.step = 'review'; renderStart(); }
  if (a === 'restart') { Object.assign(S, { step: 'photo', items: [], charge: '', receipt: null, check: null, scan: null, title: '' }); renderStart(); }
  if (a === 'delname') { S.people.splice(Number(b.dataset.k), 1); renderPeople(); }
  if (a === 'create') createTab();
});

/* ======================================================================
   A tab
   ====================================================================== */
let T = null;
let view = 'items';
const pend = new Map(); // "item|person" -> units not yet saved
const pendModes = new Map();
const openPeople = new Set();
let sheet = null;
let lastActivity = Date.now();
let payReturn = null; // { amt } while someone is off in Venmo

function units(i, p) {
  const k = i + '|' + p;
  if (pend.has(k)) return pend.get(k);
  if (T.mode === 'even') return T.out && T.out[i] && T.out[i][p] ? 0 : 1;
  return (T.claims[i] && T.claims[i][p]) || 0;
}
const isOut = (i, p) => units(i, p) === 0;
const modeOf = (it) => (it.qty < 2 ? 'share' : pendModes.get(it.id) || (T.modes && T.modes[it.id]) || 'count');
const people = () => peopleOf(T);
const compute_ = () => compute(T, { units, modeOf, isOut });
const nameOf = (p) => (T.people[p] ? T.people[p].name : 'Someone');
function personalLink(p) { return `${location.origin}/t/${tabId}?p=${p}`; }
function venmoUrl(c) {
  const note = encodeURIComponent(T.title || 'Tab');
  return `https://venmo.com/${encodeURIComponent(T.payer.venmo)}?txn=pay&amount=${(Math.round(c) / 100).toFixed(2)}&note=${note}&audience=private`;
}

function accept(st) {
  if (!st || typeof st.rev !== 'number') return;
  if (T && st.rev < T.rev) return;
  T = st;
  if (me && !T.people[me]) { me = null; store.set('tab-me:' + tabId, null); toast('You’re no longer on this tab. Pick your name again.'); }
  renderAll();
}

let flushT = null, flushing = false;
function scheduleFlush(ms = 250) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
async function flush() {
  if (flushing) { scheduleFlush(150); return; }
  if (!pend.size) return;
  const changes = [...pend].map(([k, u]) => { const [i, p] = k.split('|'); return { i, p, u }; });
  flushing = true;
  try {
    const r = await post(body({ op: 'claims', changes }));
    changes.forEach((c) => { const k = c.i + '|' + c.p; if (pend.get(k) === c.u) pend.delete(k); });
    accept(r.state);
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && e.status !== 409) { pend.clear(); toast(e.message); await poll(true); }
    else { if (e.status !== 409) online(false); scheduleFlush(e.status === 409 ? 400 : 3000); }
  } finally { flushing = false; }
}
async function act(b, okMsg) {
  try { const r = await post(body(b)); accept(r.state); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message); poll(true); return null; }
}

let pollT = null, polling = false;
function schedulePoll() {
  clearTimeout(pollT);
  if (document.hidden || !T) return;
  const C = compute_();
  const mine = me && C.byId[me];
  const settledMe = me && me !== HOST && mine && mine.settled;
  const busy = Date.now() - lastActivity < 180000;
  const ms = T.closed ? 60000 : settledMe ? 60000 : busy ? 3000 : 15000;
  pollT = setTimeout(() => poll(), ms);
}
async function poll(full) {
  if (polling && !full) return;
  polling = true;
  try {
    const r = await fetch(`${API}?t=${tabId}` + (T && !full ? `&rev=${T.rev}` : ''), { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) { renderMissing(d.error); return; }
    if (!r.ok) throw new Error(String(r.status));
    online(true);
    if (!d.same) accept(d);
  } catch (e) {
    online(false);
    if (!T) app.innerHTML = '<p class="muted" role="status">Can’t load the tab. Check your connection; it will keep trying.</p>';
  } finally { polling = false; schedulePoll(); }
}
function renderMissing(msg) {
  app.innerHTML = `<h1>Tab not found</h1><p class="lede">${esc(msg || 'Check the link.')}</p><a class="btn" href="/">Start a new tab</a>`;
  $('#dock').hidden = true;
}

/* ---------- Rendering a tab ---------- */
function renderAll() {
  if (!tabId) return renderStart();
  if (!T) return;
  if (!me && linkPerson && T.people[linkPerson]) setMe(linkPerson, true);
  const C = compute_();
  $('#title').textContent = T.title || 'Tab';
  $('#subtitle').textContent = `${fmt(T.charge)} · paid by ${T.payer.name}${T.closed ? ' · closed' : ''}`;
  const mp = me && T.people[me];
  document.documentElement.style.setProperty('--me', mp ? pc(mp) : PALETTE[0]);
  const btn = $('#meBtn');
  btn.hidden = !mp;
  if (mp) setHTML(btn, `${av(mp)}<span class="nm">${esc(mp.name)}${isHost ? ' (host)' : ''}</span>`);
  if (!mp) { renderJoin(); $('#dock').hidden = true; if (sheet) closeSheet(); return; }
  let html = '';
  if (T.closed) html += `<p class="banner ok">This tab is closed. Thanks, everyone.</p>`;
  if (isHost) html += `<div class="seg" role="tablist" aria-label="Host view">
      <button type="button" role="tab" data-act="view" data-v="people" aria-selected="${view === 'people'}">People</button>
      <button type="button" role="tab" data-act="view" data-v="items" aria-selected="${view === 'items'}">Items</button></div>`;
  html += isHost && view === 'people' ? hostPanel(C) : itemsList(C);
  setHTML(app, html);
  renderDock(C);
  if (sheet) renderSheet(C);
}

function renderJoin() {
  const list = people().filter((p) => p.id !== HOST || isHost);
  setHTML(app, `
    <h1>Who are you?</h1>
    <p class="lede">${esc(T.payer.name)} paid ${fmt(T.charge)}. Tap your name, then pick what you had.</p>
    <div class="names">${list.map((p) => `<button type="button" class="name-btn" data-act="pick" data-p="${p.id}">${av(p, 'lg')}<span>${esc(p.name)}</span></button>`).join('')}</div>
    ${T.closed ? '' : `<form id="joinForm" class="row2" autocomplete="off"><label class="sr" for="joinName">Your name</label>
      <input id="joinName" class="in" placeholder="Not listed? Type your name" maxlength="24" enterkeyhint="go" autocapitalize="words">
      <button class="btn" type="submit" style="flex:0 0 auto">Join</button></form>`}`);
}

function itemsList(C) {
  const even = T.mode === 'even';
  const help = even
    ? 'Everything is split evenly. Untick anything you didn’t have.'
    : 'Tap what you had. For shared plates, use ⋯ to add everyone who shared.';
  const open = C.openItems.length;
  let html = `<p class="note" style="margin:0 2px 10px">${help}</p>`;
  if (!even && open) html += `<p class="note" style="margin:0 2px 10px">${open} ${open === 1 ? 'item' : 'items'} nobody has claimed yet.</p>`;
  html += '<div class="rows">' + T.items.map((it) => itemRowHtml(it, C)).join('') + '</div>';
  return html;
}
function itemRowHtml(it, C) {
  const inf = C.info[it.id], even = T.mode === 'even';
  const m = inf.m, myU = units(it.id, me), mine = myU > 0;
  const meta = [];
  if (!even && m === 'count' && it.qty > 1) {
    meta.push(`<span class="money">${fmt(it.cents / it.qty)} each</span>`);
    if (inf.over > 0) meta.push(`<em>${inf.over} too many claimed</em>`);
    else if (!inf.tot) meta.push('<em>none claimed</em>');
    else if (inf.left > 0) meta.push(`<em>${inf.left} left</em>`);
  } else {
    meta.push(`<span class="money">${fmt(it.cents)}</span>`);
    if (!inf.ent.length) meta.push(even ? '<em>nobody had it</em>' : '<em>unclaimed</em>');
    else if (inf.ent.length > 1) meta.push(`<span>split ${inf.ent.length} ways</span>`);
  }
  if (mine && inf.out[me] != null) meta.push(`<b class="money">You ${fmt(inf.out[me])}</b>`);
  const addedBy = T.by && T.by[it.id] && T.by[it.id][me];
  if (addedBy && addedBy !== me && (mine || even)) meta.push(`<span class="tag">${even ? 'Changed' : 'Added'} by ${esc(addedBy === HOST ? T.payer.name : nameOf(addedBy))}</span>`);
  const label = `${esc(it.name)}${it.qty > 1 ? ` <span class="muted">×${it.qty}</span>` : ''}`;
  let ctl;
  if (T.closed) ctl = '';
  else if (!even && m === 'count' && it.qty > 1) {
    ctl = mine
      ? `<span class="step"><button type="button" data-act="dec" data-i="${it.id}" aria-label="One fewer ${esc(it.name)}">−</button><output aria-label="You have">${myU}</output><button type="button" data-act="inc" data-i="${it.id}" aria-label="One more ${esc(it.name)}">+</button></span>`
      : `<button type="button" class="plus" data-act="inc" data-i="${it.id}" aria-label="I had one ${esc(it.name)}">+</button>`;
  } else {
    ctl = `<button type="button" class="tick" data-act="toggle" data-i="${it.id}" aria-pressed="${mine}" aria-label="${even ? 'I had' : 'Mine:'} ${esc(it.name)}">${CHECK}</button>`;
  }
  return `<div class="row${mine ? ' mine' : ''}">
    <button type="button" class="r-main" data-act="item" data-i="${it.id}" aria-label="${esc(it.name)}: who had it">
      <span class="r-name">${label}</span><span class="r-meta">${meta.join('')}</span></button>
    ${ctl}
    ${T.closed ? '' : `<button type="button" class="more" data-act="item" data-i="${it.id}" aria-label="Who had ${esc(it.name)}">⋯</button>`}</div>`;
}

function statusOf(r) {
  const p = r.p;
  if (p.waived && r.settled) return ['done', p.paid ? `Paid ${fmt(p.paid)}, rest let go` : 'Let go'];
  if (p.paid != null && r.owed <= SLACK) return p.ok ? ['done', 'Paid ✓'] : ['done', `Says paid ${fmt(p.paid)}. Check Venmo`];
  if (p.paid != null) return ['due', `Paid ${fmt(p.paid)}, owes ${fmt(r.owed)} more`];
  if (!r.total) return ['', 'Nothing claimed yet'];
  return ['due', `Owes ${fmt(r.owed)}`];
}

function hostPanel(C) {
  const others = C.res.filter((r) => r.p.id !== HOST);
  const pct = C.expected ? Math.min(100, Math.round((C.collected / C.expected) * 100)) : 0;
  let html = `<div class="card"><h3 class="money">${fmt(C.collected)} of ${fmt(C.expected)} paid back</h3>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <p class="note money">Your own share is ${fmt(C.byId[HOST].total)}. Everyone’s totals include tax, fees and tip in proportion to what they had.</p></div>`;

  if (C.openItems.length || Math.abs(C.pool) > SLACK) {
    html += `<div class="card"><h3 class="money">Not covered yet: ${fmt(C.pool)}</h3>`;
    if (C.openItems.length) {
      html += `<p class="note">Assign each to whoever had it.</p><ul class="lines">${C.openItems.map((it) => {
        const inf = C.info[it.id];
        const what = inf.m === 'count' && it.qty > 1 ? `${inf.left} × ${it.name}` : it.name;
        return `<li><span>${esc(what)}</span><button type="button" class="btn sm ghost" data-act="assign" data-i="${it.id}">Assign</button></li>`;
      }).join('')}</ul>`;
    }
    if (!T.closed) {
      html += `<p class="note">Or settle the rest in one tap:</p><div class="acts">
        <button type="button" class="btn sm" data-act="pool" data-v="spread">Split it across everyone who hasn’t paid</button>
        <button type="button" class="btn sm ghost" data-act="pool" data-v="cover">I’ll cover it</button></div>`;
    }
    html += '</div>';
  } else if (T.pool) {
    html += `<p class="banner ok">${T.pool === 'spread' ? 'Anything unclaimed is split across everyone who hasn’t paid.' : 'You’re covering anything unclaimed.'} <button type="button" class="link" data-act="pool" data-v="none">Undo</button></p>`;
  }

  html += `<div class="card"><h3>People</h3>${others.map((r) => personHtml(r, C)).join('') || '<p class="note">Nobody else yet. Add people below or share the link.</p>'}
    ${T.closed ? '' : `<form id="addPerson" class="row2" style="margin-top:12px" autocomplete="off"><label class="sr" for="addPersonName">Add someone</label>
      <input id="addPersonName" class="in" placeholder="Add someone" maxlength="24"><button class="btn" type="submit" style="flex:0 0 auto">Add</button></form>`}</div>`;

  const done = C.allPaid || (others.every((r) => r.settled || !r.total) && Math.abs(C.pool) <= SLACK);
  html += `<div class="card"><h3>Tab</h3><div class="acts">
    <button type="button" class="btn sm ghost" data-act="share">Share the link</button>
    <button type="button" class="btn sm ghost" data-act="report">See the report</button>
    ${T.closed ? '<button type="button" class="btn sm ghost" data-act="reopen">Reopen</button>'
    : `<button type="button" class="btn sm${done ? '' : ' ghost'}" data-act="close" ${done ? '' : 'aria-describedby="closeNote"'}>Close the tab</button>`}</div>
    ${!T.closed && !done ? '<p class="note" id="closeNote">You can close it once everyone has paid and nothing is left uncovered.</p>' : ''}</div>`;
  return html;
}
function personHtml(r, C) {
  const p = r.p, [cls, status] = statusOf(r);
  let acts = '';
  if (!T.closed) {
    if (!r.settled && r.owed > SLACK) acts += `<button type="button" class="btn sm" data-act="remind" data-p="${p.id}">Remind privately</button>`;
    acts += `<button type="button" class="btn sm ghost" data-act="assignTo" data-p="${p.id}">Add items for them</button>`;
    if (!r.settled && r.owed > SLACK) acts += `<button type="button" class="btn sm ghost" data-act="markpaid" data-p="${p.id}">Mark paid</button>`;
    if (p.paid != null && !p.ok) acts += `<button type="button" class="btn sm ghost" data-act="confirm" data-p="${p.id}">Got it</button>`;
    if (p.paid != null && r.owed > SLACK) acts += `<button type="button" class="btn sm ghost" data-act="waive" data-p="${p.id}">Let the ${fmt(r.owed)} go</button>`;
    if (p.paid != null) acts += `<button type="button" class="btn sm ghost" data-act="unpaid" data-p="${p.id}">Undo payment</button>`;
    acts += `<button type="button" class="btn sm ghost" data-act="remove" data-p="${p.id}">Remove</button>`;
  }
  return `<details class="person" data-p="${p.id}" ${openPeople.has(p.id) ? 'open' : ''}>
    <summary>${av(p)}<span class="p-name"><b>${esc(p.name)}</b><small class="${cls}">${esc(status)}</small></span><b class="money">${fmt(r.total)}</b></summary>
    <div class="p-body">${linesHtml(r)}<div class="acts">${acts}</div></div></details>`;
}
function linesHtml(r) {
  if (!r.lines.length) return '<p class="note">Nothing claimed yet.</p>';
  return `<ul class="lines">${r.lines.map((l) => `<li><span>${esc(l.label)}</span><span class="money">${fmt(l.amt)}</span></li>`).join('')}
    <li><span>Tax, fees and tip</span><span class="money">${fmt(r.extrasR)}</span></li>
    <li class="tot"><span>Total</span><span class="money">${fmt(r.total)}</span></li></ul>
    ${r.locked ? '<p class="note">Locked when they paid, so later changes won’t move it.</p>' : ''}`;
}

function renderDock(C) {
  const dock = $('#dock');
  dock.hidden = false;
  const r = C.byId[me];
  let left, right = '';
  if (me === HOST) {
    left = `<span>Paid back to you</span><strong class="money">${fmt(C.collected)}</strong><small class="money">of ${fmt(C.expected)}</small>`;
    right = T.closed ? '' : '<button type="button" class="btn" data-act="share">Share link</button>';
  } else if (r.p.paid != null && r.owed <= SLACK) {
    left = `<span>You’re all set</span><strong class="money">${fmt(r.total)}</strong><small>${r.p.ok ? `${esc(T.payer.name)} confirmed it` : 'Marked as paid'}</small>`;
    right = '<button type="button" class="btn ghost" data-act="mine">Details</button>';
  } else if (!r.total) {
    left = `<span>Your total</span><strong class="money">$0.00</strong><small>${T.mode === 'even' ? 'Tap items you had' : 'Tap what you had'}</small>`;
  } else {
    left = `<span>${r.p.paid != null ? 'Still to pay' : 'Your total'}</span><strong class="money">${fmt(r.owed)}</strong><small>Tax and tip included</small>`;
    right = T.closed ? '' : '<button type="button" class="btn" data-act="mine">Review and pay</button>';
  }
  setHTML($('#dockIn'), `<div class="dock-sum" aria-live="polite">${left}</div>${right}`);
}

/* ---------- Sheets ---------- */
const dlg = $('#sheet');
function openSheet(s) { sheet = s; const b = $('#sheetBody'); b._h = null; renderSheet(compute_()); if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); } }
function closeSheet() { sheet = null; if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); } }
dlg.addEventListener('close', () => { sheet = null; const b = $('#sheetBody'); b._h = null; b.innerHTML = ''; });
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
const done = (label = 'Done') => `<button type="button" class="btn ghost wide" data-act="close-sheet">${label}</button>`;

function renderSheet(C) {
  const b = $('#sheetBody');
  const s = sheet;
  if (!s) return;
  if (s.type === 'item') {
    const it = T.items.find((x) => x.id === s.i); if (!it) { closeSheet(); return; }
    const inf = C.info[it.id], even = T.mode === 'even', m = inf.m;
    const rows = [me, ...people().map((p) => p.id).filter((id) => id !== me)].map((pid) => {
      const p = T.people[pid], n = units(it.id, pid), amt = inf.out[pid] || 0;
      const who = pid === me ? 'You' : esc(p.name);
      const control = even || m === 'share'
        ? `<button type="button" class="tick" data-act="s-toggle" data-p="${pid}" aria-pressed="${n > 0}" aria-label="${who} had ${esc(it.name)}">${CHECK}</button>`
        : `<span class="stepper"><button type="button" data-act="s-dec" data-p="${pid}" aria-label="One fewer for ${who}" ${n <= 0 ? 'disabled' : ''}>−</button><output>${n}</output><button type="button" data-act="s-inc" data-p="${pid}" aria-label="One more for ${who}">+</button></span>`;
      return `<div class="prow">${av(p)}<span class="grow">${who}</span><span class="money muted">${amt ? fmt(amt) : ''}</span>${control}</div>`;
    }).join('');
    const seg = !even && it.qty > 1 ? `<div class="seg" role="group" aria-label="How ${esc(it.name)} is split">
      <button type="button" data-act="s-mode" data-m="count" aria-pressed="${m === 'count'}">Count each one</button>
      <button type="button" data-act="s-mode" data-m="share" aria-pressed="${m === 'share'}">Shared</button></div>` : '';
    const sub = even ? 'Everyone ticked shares it evenly.' : m === 'count' ? `${it.qty} on the receipt at ${fmt(it.cents / it.qty)} each. Set how many each person had.` : 'Everyone ticked shares it evenly.';
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">${esc(it.name)} <span class="muted money">${fmt(it.cents)}</span></h2><p class="sub">${sub}</p>${seg}${rows}<div class="sh-foot">${done()}</div></div>`);
  } else if (s.type === 'mine') {
    const r = C.byId[me];
    let pay = '';
    if (me !== HOST && r.owed > SLACK && !T.closed) {
      pay = T.payer.venmo
        ? `<a class="btn wide" href="${venmoUrl(r.owed)}" target="_blank" rel="noopener" data-act="venmo" data-amt="${r.owed}">Pay ${fmt(r.owed)} on Venmo</a>`
        : `<p class="banner">${esc(T.payer.name)} didn’t add a Venmo username. Pay them however you usually do, then record it.</p>`;
      pay += `<button type="button" class="btn ghost wide" data-act="other">I paid another way</button>`;
    }
    if (me !== HOST && r.p.paid != null && !T.closed) pay += `<button type="button" class="link" data-act="unpaid-me">Undo my payment</button>`;
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">${me === HOST ? 'Your share' : 'Your total'} <span class="money">${fmt(r.total)}</span></h2>
      <p class="sub">Your items, plus your share of tax, fees and tip in proportion to what you had.</p>
      ${linesHtml(r)}
      ${r.p.paid != null && me !== HOST ? `<p class="banner ${r.owed <= SLACK ? 'ok' : ''} money">You’ve paid ${fmt(r.p.paid)}${r.p.waived ? `; ${esc(T.payer.name)} let ${fmt(r.p.waived)} go` : ''}${r.owed > SLACK ? `. ${fmt(r.owed)} left.` : '.'}</p>` : ''}
      <div class="sh-foot">${pay}${done('Close')}</div></div>`);
  } else if (s.type === 'paycheck') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Did your Venmo go through?</h2><p class="sub">Mark it so ${esc(T.payer.name)} knows you’re square.</p>
      <div class="sh-foot"><button type="button" class="btn wide" data-act="paidyes" data-amt="${s.amt}">Yes, I paid ${fmt(s.amt)}</button>${done('Not yet')}</div></div>`);
  } else if (s.type === 'other' || s.type === 'markpaid') {
    if (b.querySelector('#amount')) return; // keep what they're typing
    const who = s.type === 'other' ? me : s.p;
    const r = C.byId[who];
    b._h = null;
    b.innerHTML = `<div class="sh"><h2 id="sheetTitle">${s.type === 'other' ? 'How much did you send?' : `What did ${esc(nameOf(who))} pay?`}</h2>
      <p class="sub">${s.type === 'other' ? 'Cash, Zelle, anything. Put in what you actually sent.' : 'Put in what they actually paid you.'}</p>
      <form id="amountForm"><label class="sr" for="amount">Amount in dollars</label>
      <input id="amount" class="in money" inputmode="decimal" value="${dollars(Math.max(0, r.owed))}" autocomplete="off">
      <div class="sh-foot"><button class="btn wide" type="submit">Save</button>${done('Cancel')}</div></form></div>`;
  } else if (s.type === 'assign' || s.type === 'assignTo') {
    if (s.type === 'assign') {
      const it = T.items.find((x) => x.id === s.i); if (!it) { closeSheet(); return; }
      setHTML(b, `<div class="sh"><h2 id="sheetTitle">Who had ${esc(it.name)}?</h2><p class="sub">They’ll see it on their total, marked as added by you.</p>
        ${people().map((p) => `<div class="prow">${av(p)}<span class="grow">${p.id === me ? 'You' : esc(p.name)}</span><button type="button" class="btn sm ghost" data-act="give" data-p="${p.id}">Give it to them</button></div>`).join('')}
        <div class="sh-foot">${done()}</div></div>`);
    } else {
      const p = T.people[s.p]; if (!p) { closeSheet(); return; }
      const even = T.mode === 'even';
      setHTML(b, `<div class="sh"><h2 id="sheetTitle">What did ${esc(p.name)} have?</h2><p class="sub">${even ? 'Untick anything they didn’t have.' : 'They’ll see these marked as added by you.'}</p>
        ${T.items.map((it) => { const n = units(it.id, s.p); return `<div class="prow"><span class="grow">${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span>${
          !even && it.qty > 1 && modeOf(it) === 'count'
            ? `<span class="stepper"><button type="button" data-act="a-dec" data-i="${it.id}" aria-label="One fewer ${esc(it.name)} for ${esc(p.name)}" ${n <= 0 ? 'disabled' : ''}>−</button><output>${n}</output><button type="button" data-act="a-inc" data-i="${it.id}" aria-label="One more ${esc(it.name)} for ${esc(p.name)}">+</button></span>`
            : `<button type="button" class="tick" data-act="a-toggle" data-i="${it.id}" aria-pressed="${n > 0}" aria-label="${esc(p.name)} had ${esc(it.name)}">${CHECK}</button>`}</div>`; }).join('')}
        <div class="sh-foot">${done()}</div></div>`);
    }
  } else if (s.type === 'created') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Your tab is ready</h2>
      <p class="sub">Send the link to the group chat. Everyone taps their name, picks what they had and pays you.</p>
      <div class="sh-foot"><button type="button" class="btn wide" data-act="share">Send the link</button>${done('Later')}</div>
      <p class="note">This phone is now the host. Keep this page’s address to manage the tab from another device: ${esc(location.origin)}/t/${tabId}#h=${esc(hostKey)}</p></div>`);
  } else if (s.type === 'who') {
    if (b.querySelector('#renameInput')) return;
    const p = T.people[me];
    b._h = null;
    b.innerHTML = `<div class="sh"><h2 id="sheetTitle">You’re ${esc(p.name)}</h2><p class="sub">Fix your name, or switch if this isn’t you.</p>
      <form id="renameForm"><label class="sr" for="renameInput">Your name</label><input id="renameInput" class="in" maxlength="24" value="${esc(p.name)}">
      <div class="sh-foot"><button class="btn wide" type="submit">Save name</button>
      ${me === HOST ? '' : `<button type="button" class="btn ghost wide" data-act="switch">I’m not ${esc(p.name)}</button>`}${done('Close')}</div></form></div>`;
  }
}

/* ---------- Actions on a tab ---------- */
function setUnits(i, p, u) {
  lastActivity = Date.now();
  pend.set(i + '|' + p, Math.max(0, Math.min(99, u)));
  renderAll(); scheduleFlush();
}
async function setMode(i, mval) {
  pendModes.set(i, mval); renderAll();
  try { const r = await post(body({ op: 'mode', i, m: mval })); if (pendModes.get(i) === mval) pendModes.delete(i); accept(r.state); } catch (e) { pendModes.delete(i); toast(e.message); renderAll(); }
}
function claimTap(it, who = me) {
  const even = T.mode === 'even', u = units(it.id, who);
  if (!even && modeOf(it) === 'count' && it.qty > 1) {
    const inf = compute_().info[it.id];
    if (inf.tot >= it.qty) toast(`All ${it.qty} are already claimed. Use ⋯ to fix the counts.`);
    setUnits(it.id, who, u + 1);
  } else setUnits(it.id, who, u > 0 ? 0 : 1);
}
function setMe(id, fromLink) {
  me = id;
  store.set('tab-me:' + tabId, id);
  if (id) beacon({ op: 'pick', p: id });
  view = isHost ? view : 'items';
  if (!fromLink) { renderAll(); window.scrollTo(0, 0); }
}
async function shareText(text, msg) {
  if (navigator.share) { try { await navigator.share({ text }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; } }
  try { await navigator.clipboard.writeText(text); toast(msg || 'Copied. Paste it in a message.'); return true; } catch (e) { toast('Couldn’t copy. Long-press the link to copy it.'); return false; }
}
function shareLink() {
  track('share_tapped');
  shareText(`Splitting ${T.title || 'the tab'}. Tap your name, pick what you had, and pay ${T.payer.name} back: ${location.origin}/t/${tabId}`, 'Link copied. Paste it in the group chat.');
}
function remind(pid) {
  const r = compute_().byId[pid];
  track('nudge_sent', { to: pid });
  shareText(`Hi ${r.p.name}! For ${T.title || 'the tab'}, your share comes to ${fmt(r.owed)}, tax and tip included. Here’s your link to check it and pay: ${personalLink(pid)}`, 'Reminder copied. Send it to them directly.');
}
function afterVenmo(amt) {
  track('pay_tapped', { amount: Math.round(amt) });
  payReturn = { amt };
  setTimeout(() => { if (payReturn && !document.hidden) openSheet({ type: 'paycheck', amt: payReturn.amt }); }, 1500);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollT); return; }
  lastActivity = Date.now();
  if (payReturn) openSheet({ type: 'paycheck', amt: payReturn.amt });
  if (tabId && T) { poll(); if (pend.size) scheduleFlush(50); }
});

app.addEventListener('click', (e) => {
  if (!tabId || !T) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  lastActivity = Date.now();
  if (a === 'pick') { setMe(b.dataset.p); toast(`Hi ${nameOf(b.dataset.p)}! Tap what you had.`); return; }
  if (a === 'view') { view = b.dataset.v; renderAll(); return; }
  const it = b.dataset.i && T.items.find((x) => x.id === b.dataset.i);
  if (a === 'item' && it) { openSheet({ type: 'item', i: it.id }); return; }
  if (a === 'inc' && it) claimTap(it);
  if (a === 'dec' && it) setUnits(it.id, me, units(it.id, me) - 1);
  if (a === 'toggle' && it) setUnits(it.id, me, units(it.id, me) > 0 ? 0 : 1);
  if (a === 'assign' && it) openSheet({ type: 'assign', i: it.id });
  if (a === 'assignTo') openSheet({ type: 'assignTo', p: b.dataset.p });
  if (a === 'pool') act({ op: 'setup', pool: b.dataset.v === 'none' ? null : b.dataset.v }, b.dataset.v === 'spread' ? 'Split across everyone who hasn’t paid' : b.dataset.v === 'cover' ? 'You’re covering it' : 'Undone');
  if (a === 'remind') remind(b.dataset.p);
  if (a === 'markpaid') openSheet({ type: 'markpaid', p: b.dataset.p });
  if (a === 'confirm') act({ op: 'confirm', p: b.dataset.p }, `Confirmed ${nameOf(b.dataset.p)}’s payment`);
  if (a === 'waive') act({ op: 'waive', p: b.dataset.p }, 'Let it go');
  if (a === 'unpaid') act({ op: 'unpaid', p: b.dataset.p }, 'Payment undone');
  if (a === 'remove' && confirm(`Remove ${nameOf(b.dataset.p)}? Their items go back to unclaimed.`)) { openPeople.delete(b.dataset.p); act({ op: 'remove', p: b.dataset.p }, 'Removed'); }
  if (a === 'share') shareLink();
  if (a === 'report') window.open(`/api/report?t=${tabId}&key=${encodeURIComponent(hostKey)}`, '_blank', 'noopener');
  if (a === 'close' && confirm('Close the tab? Nobody can change it after this, but you can reopen it.')) act({ op: 'close' }, 'Tab closed');
  if (a === 'reopen') act({ op: 'reopen' }, 'Tab reopened');
});
app.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.classList && d.classList.contains('person')) { if (d.open) openPeople.add(d.dataset.p); else openPeople.delete(d.dataset.p); }
}, true);
app.addEventListener('submit', async (e) => {
  if (!tabId || !T) return;
  if (e.target.id === 'joinForm') {
    e.preventDefault();
    const name = $('#joinName').value.trim(); if (!name) return;
    const r = await act({ op: 'join', name });
    if (r && r.person) { setMe(r.person); toast(`Hi ${nameOf(r.person)}! Tap what you had.`); }
  }
  if (e.target.id === 'addPerson') {
    e.preventDefault();
    const name = $('#addPersonName').value.trim(); if (!name) return;
    const r = await act({ op: 'add', name }, `Added ${name}`);
    if (r) { $('#addPersonName').value = ''; }
  }
});

$('#meBtn').addEventListener('click', () => openSheet({ type: 'who' }));
$('#dockIn').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'mine') openSheet({ type: 'mine' });
  if (b.dataset.act === 'share') shareLink();
});
$('#sheetBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !sheet) return;
  const a = b.dataset.act, s = sheet;
  lastActivity = Date.now();
  if (a === 'close-sheet') { if (s.type === 'paycheck') payReturn = null; closeSheet(); return; }
  if (a === 'share') { shareLink(); return; }
  if (a === 'venmo') { afterVenmo(Number(b.dataset.amt)); return; }
  if (a === 'other') { openSheet({ type: 'other' }); return; }
  if (a === 'paidyes') { payReturn = null; closeSheet(); act({ op: 'paid', p: me, amount: Number(b.dataset.amt), how: 'venmo' }, 'Marked as paid. Thanks!'); return; }
  if (a === 'unpaid-me') { closeSheet(); act({ op: 'unpaid', p: me }, 'Payment undone'); return; }
  if (a === 'switch') { closeSheet(); me = null; store.set('tab-me:' + tabId, null); renderAll(); return; }
  if (a === 'give') { const it = T.items.find((x) => x.id === s.i); if (it) { const inf = compute_().info[it.id]; const add = inf.m === 'count' && it.qty > 1 ? Math.max(1, inf.left) : 1; setUnits(it.id, b.dataset.p, units(it.id, b.dataset.p) + add); toast(`Given to ${nameOf(b.dataset.p)}`); } closeSheet(); return; }
  if (s.type === 'item') {
    const it = T.items.find((x) => x.id === s.i); if (!it) return;
    const pid = b.dataset.p;
    if (a === 's-mode') { setMode(it.id, b.dataset.m); return; }
    if (a === 's-toggle') setUnits(it.id, pid, units(it.id, pid) > 0 ? 0 : 1);
    if (a === 's-inc') setUnits(it.id, pid, units(it.id, pid) + 1);
    if (a === 's-dec') setUnits(it.id, pid, units(it.id, pid) - 1);
  }
  if (s.type === 'assignTo') {
    const it = T.items.find((x) => x.id === b.dataset.i); if (!it) return;
    if (a === 'a-toggle') setUnits(it.id, s.p, units(it.id, s.p) > 0 ? 0 : 1);
    if (a === 'a-inc') setUnits(it.id, s.p, units(it.id, s.p) + 1);
    if (a === 'a-dec') setUnits(it.id, s.p, units(it.id, s.p) - 1);
  }
});
$('#sheetBody').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = sheet; if (!s) return;
  if (e.target.id === 'amountForm') {
    const c = toCents($('#amount').value);
    if (!Number.isInteger(c) || c <= 0) { toast('Enter an amount'); return; }
    const p = s.type === 'other' ? me : s.p;
    closeSheet();
    act({ op: 'paid', p, amount: c, how: 'other' }, s.type === 'other' ? 'Recorded. Thanks!' : `Marked ${nameOf(p)} as paid`);
  }
  if (e.target.id === 'renameForm') {
    const name = $('#renameInput').value.trim(); if (!name) return;
    closeSheet(); act({ op: 'rename', p: me, name }, 'Name updated');
  }
});
window.addEventListener('online', () => { if (tabId) { poll(); if (pend.size) scheduleFlush(50); } });
window.addEventListener('pagehide', () => { if (pend.size) flush(); });
window.addEventListener('popstate', () => location.reload());

/* ---------- Start ---------- */
async function start() {
  if (!tabId) { renderStart(); return; }
  if (hostKey) {
    try { const d = await post({ op: 'checkhost', t: tabId, key: hostKey }); isHost = !!d.isHost; } catch (e) { isHost = false; }
    if (isHost) { me = HOST; store.set('tab-me:' + tabId, HOST); } else { hostKey = null; }
  }
  if (isHost) view = 'people';
  await poll(true);
  track('link_opened');
}
start();

// For tests
export const _debug = { get T() { return T; }, get me() { return me; }, get isHost() { return isHost; }, flush, itemsTotal };
