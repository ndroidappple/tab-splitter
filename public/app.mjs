// The tab page: start a tab (host), assign or claim items, pay, and the host's panel.
// The host comes first: they enter the receipt, assign what they know, and send the link for the rest.
import { HOST, SLACK, compute, people as peopleOf, itemsTotal, tidyName, slotsOf } from './split.mjs';
import { installMotion, still, dur, ease, anim, collapse, EXIT_EASE } from './motion.mjs';

const API = '/api/tab';
const LIVE = 'https://tabsplitterns.netlify.app';
const PALETTE = ['#4B57D1', '#0E8A5C', '#C2410C', '#7C3AED', '#0E7490', '#BE185D', '#4D7C0F', '#A16207', '#4338CA', '#0F766E', '#9D174D', '#475569'];
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
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const readJSON = (k, d) => { try { return JSON.parse(store.get(k) || '') ?? d; } catch (e) { return d; } };
/* Toast: a pill that rises over the dock. A tap puts it away (unless it offers Undo, so a near miss
   can't commit what Undo would take back); so does a swipe down or to either side, which it follows.
   Undo toasts stay 6 s, others 3 s. `done` runs once it goes without Undo. */
let toastEl = null, toastT;
function toast(msg, { undo, done } = {}) {
  const root = $('#toasts'), host = dlg.open && !closing ? dlg : document.body;
  if (root.parentNode !== host) host.appendChild(root); // over an open sheet, which sits in the top layer
  if (toastEl) dismissToast(toastEl);
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="msg">${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  el._done = done; el._undo = !!undo;
  if (undo) el.querySelector('button').addEventListener('click', () => { el._done = null; undo(); dismissToast(el); });
  swipeAway(el);
  root.appendChild(el); toastEl = el;
  clearTimeout(toastT); toastT = setTimeout(() => dismissToast(el), undo ? 6000 : 3000);
}
function dismissToast(el, thrown) {
  if (!el || el._gone) return;
  el._gone = true;
  if (toastEl === el) { toastEl = null; clearTimeout(toastT); }
  if (el._done) { const d = el._done; el._done = null; d(); }
  if (still()) { el.remove(); return; }
  if (!thrown) el.classList.add('leaving');
  setTimeout(() => el.remove(), dur('exit') + 40);
}
function swipeAway(el) {
  let g = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, on: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!g || g.id !== e.pointerId) return;
    g.dx = e.clientX - g.x; g.dy = Math.max(0, e.clientY - g.y); // down only: up has nowhere to go
    if (!g.on && Math.max(Math.abs(g.dx), g.dy) < 6) return;
    if (!g.on) { g.on = true; el.style.animation = 'none'; el.style.transition = 'none'; }
    el.style.transform = `translate(${g.dx}px, ${g.dy}px)`;
    el.style.opacity = String(1 - Math.min(0.6, Math.max(Math.abs(g.dx), g.dy) / 200));
  });
  const up = (e) => {
    if (!g || g.id !== e.pointerId) return;
    const d = g; g = null;
    if (!d.on) { if (e.type === 'pointerup' && !el._undo) dismissToast(el); return; } // a tap
    if (e.type === 'pointerup' && Math.max(Math.abs(d.dx), d.dy) > 44) {
      // Off the way it was thrown.
      el.style.transition = still() ? 'none' : `transform ${dur('exit')}ms ${EXIT_EASE}, opacity ${dur('exit')}ms ${EXIT_EASE}`;
      el.style.transform = Math.abs(d.dx) > d.dy ? `translateX(${Math.sign(d.dx) * (el.offsetWidth + 40)}px)` : `translateY(${d.dy + 60}px)`;
      el.style.opacity = '0';
      dismissToast(el, true);
    } else {
      el.style.transition = `transform ${dur('slide')}ms ${ease('slide')}, opacity ${dur('slide')}ms ${ease('slide')}`;
      el.style.transform = ''; el.style.opacity = '';
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
const CHECK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV = '<svg class="go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- Ways to get paid back ---------- */
const WAYS = ['venmo', 'cashapp', 'paypal', 'zelle'];
const PAY = {
  venmo: { name: 'Venmo', field: 'Venmo username', pre: '@', ph: 'username', url: (h, c, note) => `https://venmo.com/${encodeURIComponent(h)}?txn=pay&amount=${dollars(c)}&note=${encodeURIComponent(note)}&audience=private` },
  cashapp: { name: 'Cash App', field: 'Cash App $cashtag', pre: '$', ph: 'cashtag', url: (h, c) => `https://cash.app/$${encodeURIComponent(h)}/${dollars(c)}` },
  paypal: { name: 'PayPal', field: 'PayPal.Me name', pre: 'paypal.me/', ph: 'name', url: (h, c) => `https://paypal.me/${encodeURIComponent(h)}/${dollars(c)}USD` },
  zelle: { name: 'Zelle', field: 'Zelle email or phone', pre: '', ph: 'you@example.com' },
};
const wayName = (how) => (PAY[how] ? PAY[how].name : 'payment');
// The fields for each way, in the setup step and in the host's settings.
function payField(k, v) {
  const w = PAY[k];
  return `<label class="f" for="${k}">${w.field}</label>
    <div class="adorn">${w.pre ? `<span aria-hidden="true">${w.pre}</span>` : ''}<input id="${k}" class="in" value="${esc(v || '')}" placeholder="${w.ph}" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="80" ${k === 'zelle' ? 'inputmode="email"' : ''}></div>`;
}

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

// Tabs this phone has hosted or joined, newest first, for the start screen.
function rememberTab() {
  if (!T || !me) return;
  const list = readJSON('tab-recent', []).filter((x) => x && x.id !== tabId);
  list.unshift({ id: tabId, title: T.title || 'Tab', charge: T.charge, host: isHost, t: T.created || Date.now() });
  store.set('tab-recent', JSON.stringify(list.slice(0, 8)));
}

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
   Starting a tab: receipt, then people. Each step is a history entry, so Back goes back a step,
   and the draft is saved as it's typed, so a reload or a stray swipe loses nothing.
   ====================================================================== */
const profile = readJSON('tab-profile', {});
const S = {
  step: 'photo', title: '', items: [], charge: '', receipt: null, check: null, scan: null, busy: false, photo: null,
  hostName: profile.name || '', venmo: profile.venmo || '', cashapp: profile.cashapp || '', paypal: profile.paypal || '', zelle: profile.zelle || '',
  private: !!profile.private, people: [], mode: 'items',
};
const DRAFT = ['title', 'items', 'charge', 'receipt', 'check', 'scan', 'hostName', ...WAYS, 'private', 'people', 'mode'];
const hasDraft = (d) => d && ((d.items || []).some((it) => it.name || it.price) || (d.people || []).length);
function saveDraft() { store.set('tab-draft', JSON.stringify(Object.assign({ at: Date.now() }, Object.fromEntries(DRAFT.map((k) => [k, S[k]]))))); }
const draft = !tabId ? readJSON('tab-draft', null) : null;
const STEPS = { photo: 0, review: 1, people: 2 };
function go(step, push = true) {
  S.step = step;
  if (push) history.pushState({ step }, '');
  saveDraft(); renderStart(); window.scrollTo(0, 0);
}
const stepTag = (n) => `<p class="eyebrow">Step ${n} of 3</p>`;

function renderStart() {
  $('#title').textContent = 'Tab';
  $('#subtitle').textContent = 'Split the bill';
  $('#meBtn').hidden = true;
  $('#dock').hidden = true;
  if (S.step === 'review') return renderReview();
  if (S.step === 'people') return renderPeople();
  const recent = readJSON('tab-recent', []).filter((x) => x && /^[a-z0-9]{10}$/.test(x.id));
  const d = readJSON('tab-draft', null);
  app.innerHTML = `
    <section class="hero">
      <h1>Split the bill<br>in a minute.</h1>
      <p class="lede">Snap the receipt, tap who had what, and everyone pays you back with tax and tip worked out.</p>
    </section>
    ${hasDraft(d) ? `<div class="card resume"><div><b>Pick up where you left off</b><span class="muted">${esc(d.title || 'Your last receipt')} · ${plural((d.items || []).filter((it) => it.name).length, 'item')}</span></div>
      <div class="row2"><button type="button" class="btn sm" data-act="resume">Continue</button><button type="button" class="btn sm ghost" data-act="discard">Discard</button></div></div>` : ''}
    <div class="stack">
      <label class="btn wide big" for="photo">${S.busy ? '<span class="spin"></span> Reading the receipt…' : 'Take a photo of the receipt'}</label>
      <input id="photo" type="file" accept="image/*" class="sr" ${S.busy ? 'disabled' : ''}>
      <button type="button" class="btn ghost wide" data-act="type" ${S.busy ? 'disabled' : ''}>Type the items instead</button>
    </div>
    <p id="scanStatus" class="sr" role="status" aria-live="polite">${S.busy ? 'Reading the receipt' : ''}</p>
    <ol class="how">
      <li><span><b>Snap the receipt.</b> We read the items and the total.</span></li>
      <li><span><b>Say who had what,</b> or send the link and let everyone tap their own.</span></li>
      <li><span><b>Get paid back</b> on Venmo, Cash App, PayPal or Zelle.</span></li>
    </ol>
    ${recent.length ? `<h2 class="group">Your tabs</h2><div class="rows">${recent.map((x) => `<a class="list-row" href="/t/${x.id}"><span class="grow"><b>${esc(x.title)}</b><small class="muted">${new Date(x.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${fmt(x.charge || 0)}${x.host ? ' · you paid' : ''}</small></span>${CHEV}</a>`).join('')}</div>` : ''}`;
  $('#photo').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) scanPhoto(f); });
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
    S.items = (rc.items || []).map((it) => ({ name: tidyName(it.name || '', it.quantity || 1), qty: it.quantity || 1, price: dollars(Math.round((it.price || 0) * 100)) }));
    S.charge = dollars(d.charge);
    S.photo = 'data:image/jpeg;base64,' + image; // kept in memory so the lines can be checked against it
    S.busy = false;
    go('review');
  } catch (e) {
    S.busy = false; renderStart();
    toast(e.message + ' You can type the items instead.');
  }
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
  const parts = [`<p class="sum-line money"><span>Items add up to</span><b>${fmt(n.sum + n.inSub)}</b></p>`];
  if (n.printed) {
    const diff = n.printed - n.inSub - n.sum;
    if (Math.abs(diff) < 1) parts.push(`<p class="banner ok">That matches the receipt’s ${fmt(n.printed)} subtotal.</p>`);
    else parts.push(`<p class="banner warn">The receipt says ${fmt(n.printed)}. Check the lines against the photo.</p>`);
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
    ${stepTag(1)}
    <h1>Check the receipt</h1>
    <p class="lede">${S.receipt ? 'Fix anything that doesn’t match the paper.' : 'Add each line from the receipt.'}</p>
    ${S.photo ? `<button type="button" class="photo-btn" data-act="photo"><img src="${S.photo}" alt=""><span><b>See the receipt</b><small class="muted">Tap to compare</small></span>${CHEV}</button>` : ''}
    <label class="f" for="tTitle">Name this tab</label>
    <input id="tTitle" class="in" value="${esc(S.title)}" placeholder="Friday dinner" maxlength="60" autocomplete="off">
    <h2>Items</h2>
    <div class="items-edit" id="itemsEdit">${S.items.map(itemRow).join('')}</div>
    <button type="button" class="btn ghost wide add-line" data-act="addline">+ Add a line</button>
    <label class="f" for="charge">Total charged to your card, with tip</label>
    <div class="adorn big"><span aria-hidden="true">$</span><input id="charge" class="in money" inputmode="decimal" value="${esc(S.charge)}" placeholder="0.00" autocomplete="off"></div>
    ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
    <div id="reviewStatus" role="status" aria-live="polite">${reviewStatus()}</div>
    <div class="sh-foot"><button type="button" class="btn wide" data-act="toPeople">Next: who was there</button>
    <button type="button" class="link" data-act="restart">Start over</button></div>`;
}
const itemRow = (it, k) => `<div class="ie" data-k="${k}">
  <input class="in ie-name" data-f="name" aria-label="Item ${k + 1} name" value="${esc(it.name)}" placeholder="Item ${k + 1}" maxlength="60" autocomplete="off">
  <button type="button" class="x" data-act="delline" data-k="${k}" aria-label="Remove item ${k + 1}">×</button>
  <div class="ie-sub">
    <label class="adorn sm"><span>Qty</span><input class="in" data-f="qty" aria-label="Item ${k + 1} quantity" inputmode="numeric" value="${esc(it.qty)}"></label>
    <label class="adorn sm price"><span>$</span><input class="in money" data-f="price" aria-label="Item ${k + 1} line total in dollars" inputmode="decimal" value="${esc(it.price)}" placeholder="Line total"></label>
  </div></div>`;

function renderPeople() {
  const extra = WAYS.slice(1).some((k) => S[k]);
  app.innerHTML = `
    ${stepTag(2)}
    <h1>Who was there?</h1>
    <p class="lede">Add everyone, including anyone who already left. You can assign their items next, or send them the link.</p>
    <div class="card">
      <label class="f" for="hostName" style="margin-top:0">Your name</label><input id="hostName" class="in" value="${esc(S.hostName)}" maxlength="24" autocomplete="given-name" placeholder="Your name">
      ${payField('venmo', S.venmo)}
      <details class="more-ways" ${extra ? 'open' : ''}><summary>Cash App, PayPal or Zelle</summary>${WAYS.slice(1).map((k) => payField(k, S[k])).join('')}</details>
    </div>
    <label class="f" for="addName">Everyone else</label>
    <form id="addForm" class="row2" autocomplete="off"><input id="addName" class="in" placeholder="Name (or several, with commas)" maxlength="200" enterkeyhint="done" autocapitalize="words"><button class="btn" type="submit" style="flex:0 0 auto">Add</button></form>
    <div class="chips" id="chips">${S.people.map((n, k) => `<span class="chip">${av({ name: n, color: k + 1 })}${esc(n)}<button type="button" data-act="delname" data-k="${k}" aria-label="Remove ${esc(n)}">×</button></span>`).join('')}</div>
    <h2>How to split</h2>
    <div class="choices" role="radiogroup">
      <label class="choice"><input type="radio" name="mode" value="items" ${S.mode === 'items' ? 'checked' : ''}><span><b>By what each person had</b><span>Best when people ordered different things.</span></span></label>
      <label class="choice"><input type="radio" name="mode" value="even" ${S.mode === 'even' ? 'checked' : ''}><span><b>Evenly, minus what people skipped</b><span>Best for big groups and shared plates.</span></span></label>
    </div>
    <label class="switch"><input type="checkbox" id="private" ${S.private ? 'checked' : ''}><span class="track" aria-hidden="true"></span><span><b>Keep totals private</b><span>Friends see only their own total, not everyone’s.</span></span></label>
    <div class="sh-foot"><button type="button" class="btn wide" data-act="create">Create the tab</button></div>`;
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const names = $('#addName').value.split(/[,\n]/).map((n) => n.replace(/\s+/g, ' ').trim().slice(0, 24)).filter(Boolean);
    if (!names.length) return;
    for (const n of names) if (!S.people.some((x) => x.toLowerCase() === n.toLowerCase())) S.people.push(n);
    saveDraft(); renderPeople(); $('#addName').focus();
  });
}

// The field already shows @ or $, so a typed one is dropped.
function dropPrefix(e) {
  const k = e.target.id, w = PAY[k];
  if (w && (k === 'venmo' || k === 'cashapp') && e.target.value.startsWith(w.pre)) e.target.value = e.target.value.slice(1);
}
document.addEventListener('input', dropPrefix, true);
app.addEventListener('input', (e) => {
  if (tabId) return;
  const row = e.target.closest('.ie');
  if (row) { S.items[Number(row.dataset.k)][e.target.dataset.f] = e.target.value; setHTML($('#reviewStatus'), reviewStatus()); saveDraft(); return; }
  if (e.target.id === 'charge') { S.charge = e.target.value; setHTML($('#reviewStatus'), reviewStatus()); }
  if (e.target.id === 'tTitle') S.title = e.target.value;
  if (e.target.id === 'hostName') S.hostName = e.target.value;
  if (WAYS.includes(e.target.id)) S[e.target.id] = e.target.value;
  if (e.target.name === 'mode') S.mode = e.target.value;
  if (e.target.id === 'private') S.private = e.target.checked;
  saveDraft();
});
app.addEventListener('change', (e) => {
  if (tabId) return;
  if (e.target.name === 'mode') S.mode = e.target.value;
  if (e.target.id === 'private') S.private = e.target.checked;
  saveDraft();
});

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
  if (!Number.isInteger(charge) || charge <= 0) { toast('Enter what your card was charged'); go('review'); return; }
  if (!S.hostName.trim()) { toast('Enter your name'); $('#hostName').focus(); return; }
  const btn = app.querySelector('[data-act="create"]'); btn.disabled = true;
  try {
    const title = S.title.trim() || `Tab · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const ways = Object.fromEntries(WAYS.map((k) => [k, S[k].trim()]));
    const d = await post({ op: 'create', title, hostName: S.hostName.trim(), ...ways, items, charge, people: S.people, mode: S.mode, private: S.private, device: DEVICE, scan: S.scan || 'typed' });
    store.set('tab-profile', JSON.stringify({ name: S.hostName.trim(), ...ways, private: S.private }));
    store.set('tab-draft', null);
    tabId = d.id; hostKey = d.hostKey; me = HOST; isHost = true;
    store.set('tab-host:' + tabId, hostKey); store.set('tab-me:' + tabId, HOST);
    history.pushState(null, '', '/t/' + tabId);
    T = d.state; view = 'people';
    rememberTab();
    renderAll(); poll();
    openSheet({ type: 'created' });
  } catch (e) { toast(e.message); btn.disabled = false; }
}

app.addEventListener('click', (e) => {
  if (tabId) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'type') { S.receipt = null; S.scan = null; if (!S.items.length) S.items = [{ name: '', qty: 1, price: '' }, { name: '', qty: 1, price: '' }]; go('review'); app.querySelector('.ie input').focus(); }
  if (a === 'resume') { Object.assign(S, readJSON('tab-draft', {})); go('review'); }
  if (a === 'discard') { const was = store.get('tab-draft'); store.set('tab-draft', null); renderStart(); toast('Draft discarded', { undo: () => { store.set('tab-draft', was); renderStart(); } }); }
  if (a === 'photo') openSheet({ type: 'photo' });
  if (a === 'addline') { S.items.push({ name: '', qty: 1, price: '' }); saveDraft(); renderStart(); const ins = app.querySelectorAll('.ie'); ins[ins.length - 1].querySelector('input').focus(); }
  if (a === 'delline') { S.items.splice(Number(b.dataset.k), 1); saveDraft(); renderStart(); }
  if (a === 'toPeople') { try { validItems(); } catch (err) { toast(err.message); return; } const c = toCents(S.charge); if (!Number.isInteger(c) || c <= 0) { toast('Enter what your card was charged'); $('#charge').focus(); return; } go('people'); }
  if (a === 'restart') {
    const was = JSON.stringify(S);
    Object.assign(S, { items: [], charge: '', receipt: null, check: null, scan: null, title: '', photo: null });
    store.set('tab-draft', null); go('photo');
    toast('Started over', { undo: () => { Object.assign(S, JSON.parse(was)); go('review'); } });
  }
  if (a === 'delname') { S.people.splice(Number(b.dataset.k), 1); saveDraft(); renderPeople(); }
  if (a === 'create') createTab();
});

/* ======================================================================
   A tab
   ====================================================================== */
let T = null;
let view = 'items';
let editFor = null; // whose items the item controls change, when not your own
let editReturn = null; // where Done goes once editing someone else's items
const pend = new Map(); // even split: "item|person" -> 1 (in) or 0 (out), not yet saved
let pendOps = []; // itemized: slot changes not yet saved, in order
const openPeople = new Set();
const openCards = new Set(); // person cards the viewer has expanded
let sheet = null;
let lastActivity = Date.now();
let payReturn = null; // { amt, how } while someone is off paying
const leaving = new Set(); // people the host removed, hidden while Undo is offered; sent when it goes
let arrangement = null; // which items sat in "Needs someone" when the list was opened; rows stay put until you come back
let shownView = null; // the view on screen, so the switch's pill can slide from it
let popAfter = null; // the control just tapped, which pops once the page redraws

/* Undo for a payment: marking paid undoes with "unpaid"; undoing a payment puts the same amount back.
   Offered only when that gets the person back exactly as they were. */
const undoPaid = (p) => (T.people[p] && T.people[p].paid == null ? () => act({ op: 'unpaid', p }, 'Payment undone') : undefined);
function undoUnpaid(p) {
  const was = T.people[p];
  if (!was || !was.paid || was.waived || (was.ok && !isHost)) return undefined;
  return () => act({ op: 'paid', p, amount: was.paid, how: 'other' }, 'Payment put back');
}
async function removePerson(p) {
  const name = nameOf(p);
  const card = app.querySelector(`details.pc[data-p="${p}"]`);
  await collapse(card && card.closest('.person-card'));
  leaving.add(p); openPeople.delete(p); openCards.delete(p);
  if (editFor === p) editFor = null;
  renderAll();
  const send = () => { if (leaving.delete(p)) act({ op: 'remove', p }); };
  toast(`Removed ${name}. Their items are open again.`, { undo: () => { leaving.delete(p); renderAll(); }, done: send });
}

function units(i, p) {
  const k = i + '|' + p;
  if (pend.has(k)) return pend.get(k);
  return T.out && T.out[i] && T.out[i][p] ? 0 : 1;
}
const isOut = (i, p) => units(i, p) === 0;
// The tab as this phone sees it: saved slots plus taps that haven't synced yet.
function viewT() {
  if (!pendOps.length || T.mode === 'even') return T;
  const slots = {};
  for (const it of T.items) slots[it.id] = slotsOf(T, it).map((x) => x.slice());
  for (const c of pendOps) {
    const sl = slots[c.i]; if (!sl) continue;
    if (c.a === 'take') { const k = sl.findIndex((x) => !x.length); if (k >= 0) sl[k] = [c.p]; }
    if (c.a === 'join' && sl[c.k] && !sl[c.k].includes(c.p)) sl[c.k].push(c.p);
    if (c.a === 'leave' && sl[c.k]) sl[c.k] = sl[c.k].filter((x) => x !== c.p);
  }
  return Object.assign({}, T, { slots });
}
const slotsNow = (it) => slotsOf(viewT(), it);
const count = (it, p) => (T.mode === 'even' ? units(it.id, p) : slotsNow(it).filter((x) => x.includes(p)).length);
const people = () => peopleOf(T).filter((p) => !leaving.has(p.id));
const compute_ = () => compute(viewT(), { isOut });
const nameOf = (p) => (T.people[p] ? T.people[p].name : 'Someone');
const showAll = () => isHost || !T.private; // friends see everyone's totals unless the host keeps them private
function personalLink(p) { return `${location.origin}/t/${tabId}?p=${p}`; }

function accept(st) {
  if (!st || typeof st.rev !== 'number') return;
  if (T && st.rev < T.rev) return;
  st.items = (st.items || []).map((it) => Object.assign({}, it, { name: tidyName(it.name, it.qty) }));
  st.payer = st.payer || {};
  T = st;
  if (me && !T.people[me]) { me = null; store.set('tab-me:' + tabId, null); toast('You’re no longer on this tab. Pick your name again.'); }
  if (editFor && !T.people[editFor]) editFor = null;
  renderAll();
}

let flushT = null, flushing = false;
function scheduleFlush(ms = 250) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
async function flush() {
  if (flushing) { scheduleFlush(150); return; }
  if (!pend.size && !pendOps.length) return;
  flushing = true;
  try {
    if (pendOps.length) {
      const sent = pendOps.slice();
      const r = await post(body({ op: 'slots', changes: sent }));
      pendOps = pendOps.slice(sent.length);
      accept(r.state);
    }
    if (pend.size) {
      const changes = [...pend].map(([k, u]) => { const [i, p] = k.split('|'); return { i, p, u }; });
      const r = await post(body({ op: 'claims', changes }));
      changes.forEach((c) => { const k = c.i + '|' + c.p; if (pend.get(k) === c.u) pend.delete(k); });
      accept(r.state);
    }
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && e.status !== 409) { pend.clear(); pendOps = []; toast(e.message); await poll(true); }
    else { if (e.status !== 409) online(false); scheduleFlush(e.status === 409 ? 400 : 3000); }
  } finally { flushing = false; }
}
async function act(b, okMsg, undo) {
  try { const r = await post(body(b)); accept(r.state); if (okMsg) toast(okMsg, { undo }); return r; } catch (e) { toast(e.message); poll(true); return null; }
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
    if (r.status === 404) {
      if (hostKey && !T) {
        // A tab started on a preview: bring it over once, using the host key.
        try { const m = await post({ op: 'import', t: tabId, key: hostKey }); isHost = true; me = HOST; store.set('tab-me:' + tabId, HOST); view = 'people'; accept(m.state); toast('Your tab is on the live site now. Share the new link.'); return; } catch (e) { /* not importable */ }
      }
      renderMissing(d.error); return;
    }
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
  // Checks and highlights take the colour of whoever the taps are for.
  const target = mp ? T.people[who()] : null;
  document.documentElement.style.setProperty('--me', target ? pc(target) : PALETTE[0]);
  const btn = $('#meBtn');
  btn.hidden = !mp;
  if (mp) setHTML(btn, `${av(mp)}<span class="nm">${esc(mp.name)}${isHost ? ' · host' : ''}</span>`);
  if (!mp) { renderJoin(C); $('#dock').hidden = true; if (sheet) closeSheet(); return; }
  if (!showAll()) view = 'items';
  let html = '';
  if (T.closed) html += `<p class="banner ok">This tab is closed. Thanks, everyone.</p>`;
  if (showAll()) {
    html += `<div class="seg" role="group" aria-label="View"><span class="seg-pill" style="--i:${view === 'people' ? 0 : 1}" aria-hidden="true"></span>
      <button type="button" data-act="view" data-v="people" aria-pressed="${view === 'people'}">${isHost ? 'Overview' : 'People'}</button>
      <button type="button" data-act="view" data-v="items" aria-pressed="${view === 'items'}">Items</button></div>`;
  }
  html += view === 'people' ? peoplePanel(C) : itemsList(C);
  setHTML(app, html);
  slidePill();
  renderDock(C);
  if (sheet) renderSheet(C);
  if (popAfter) { anim(app.querySelector(popAfter), [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], 'pop'); popAfter = null; }
}
// The switch's pill slides from where it was; the page under it changes at once.
function slidePill() {
  const pill = app.querySelector('.seg-pill');
  if (pill && shownView && shownView !== view) {
    const at = (v) => `translateX(calc(${v === 'people' ? 0 : 1} * (100% + 3px)))`;
    anim(pill, [{ transform: at(shownView) }, { transform: at(view) }], 'slide');
  }
  shownView = view;
}

function renderJoin(C) {
  const list = people().filter((p) => p.id !== HOST || isHost);
  setHTML(app, `
    <h1>Who are you?</h1>
    <p class="lede">${esc(T.payer.name)} paid ${fmt(T.charge)}. Tap your name, then pick what you had.</p>
    <div class="names">${list.map((p) => {
      const r = C.byId[p.id];
      const tag = p.paid != null && r.owed <= SLACK ? '<small class="pill ok">Paid</small>' : r.total ? `<small class="pill">${showAll() ? `${fmt(r.total)} so far` : 'Has items'}</small>` : '';
      return `<button type="button" class="name-btn" data-act="pick" data-p="${p.id}">${av(p, 'lg')}<span><b>${esc(p.name)}</b>${tag}</span></button>`;
    }).join('')}</div>
    ${T.closed ? '' : `<form id="joinForm" class="row2" autocomplete="off"><label class="sr" for="joinName">Your name</label>
      <input id="joinName" class="in" placeholder="Not listed? Type your name" maxlength="24" enterkeyhint="go" autocapitalize="words">
      <button class="btn" type="submit" style="flex:0 0 auto">Join</button></form>`}`);
}

// Whose items the item controls change: the host can switch to editing someone else's.
const who = () => (editFor && T.people[editFor] ? editFor : me);
const shortName = (p) => (p === me ? 'You' : p === HOST ? T.payer.name : nameOf(p));

// "Nick ×4, Anna" or "Ryan, Haven & Christina" or "Everyone but Ben"
function holders(it, inf) {
  if (!inf.ent.length) return '';
  if (T.mode === 'even') {
    const all = people().length;
    if (inf.ent.length >= all) return 'Everyone';
    const outs = people().filter((p) => !inf.ent.some(([id]) => id === p.id)).map((p) => shortName(p.id));
    return outs.length <= 2 ? `Everyone but ${outs.join(' and ')}` : inf.ent.map(([id]) => shortName(id)).join(', ');
  }
  const groups = new Map();
  for (const sl of inf.slots) if (sl.length) { const k = sl.join('+'); groups.set(k, (groups.get(k) || 0) + 1); }
  return [...groups].map(([k, n]) => {
    const names = k.split('+').map(shortName);
    const who_ = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0];
    return n > 1 ? `${who_} ×${n}` : who_;
  }).join(', ');
}

// The host taps items for one person at a time; this strip picks who.
function assignStrip(C) {
  const t = who();
  const list = people();
  return `<div class="assign"><p class="assign-label">${t === me ? 'Tapping for <b>you</b>. Tap a name to do theirs.' : `Editing <b>${esc(nameOf(t))}</b>’s items. Tap what they had.`}</p>
    <div class="assign-people" role="group" aria-label="Whose items">${list.map((p) => {
      const r = C.byId[p.id];
      return `<button type="button" class="who-chip" data-act="assignto" data-p="${p.id}" aria-pressed="${p.id === t}" style="--pc:${pc(p)}">${av(p)}<span><b>${p.id === me ? 'You' : esc(p.name)}</b><small class="money">${fmt(r ? r.total : 0)}</small></span></button>`;
    }).join('')}</div></div>`;
}

function itemsList(C) {
  const even = T.mode === 'even';
  const target = who();
  let html = '';
  if (isHost && !T.closed) html += assignStrip(C);
  else if (editFor && T.people[editFor]) {
    html += `<div class="banner edit" role="status"><span>Editing <b>${esc(nameOf(editFor))}</b>’s items. Tap to add or remove.</span>
      <button type="button" class="btn sm" data-act="editdone">Done</button></div>`;
  } else if (!T.closed) {
    html += `<p class="note intro">${even ? 'Everything is split evenly. Untick anything you didn’t have.' : 'Tap what you had. Shared a plate? Tap Split to add the others.'}</p>`;
  }
  // Rows sort into the two groups when you arrive, then stay where they are while you tap.
  const key = `${target}|${T.items.map((it) => it.id).join()}`;
  if (!arrangement || arrangement.key !== key) arrangement = { key, needs: new Set(T.items.filter((it) => !C.info[it.id].done).map((it) => it.id)) };
  const needs = T.items.filter((it) => arrangement.needs.has(it.id));
  const taken = T.items.filter((it) => !arrangement.needs.has(it.id));
  if (needs.length) {
    const left = needs.filter((it) => !C.info[it.id].done).length;
    html += `<h2 class="group">${even ? 'Nobody had these' : 'Needs someone'} <span class="count${left ? ' pend' : ' ok'}">${left || '✓'}</span></h2>
      <div class="rows">${needs.map((it) => itemRowHtml(it, C, target)).join('')}</div>`;
  }
  if (taken.length) {
    html += `<h2 class="group">${even ? 'Shared' : 'Claimed'} <span class="count">${taken.length}</span></h2>
      <div class="rows">${taken.map((it) => itemRowHtml(it, C, target)).join('')}</div>`;
  }
  return html;
}

function itemRowHtml(it, C, target) {
  const inf = C.info[it.id], even = T.mode === 'even';
  const mine = count(it, target) > 0;
  const forName = target === me ? '' : ` for ${nameOf(target)}`;
  const price = !even && it.qty > 1 ? `${fmt(it.cents / it.qty)} each` : fmt(it.cents);
  const meta = [`<span class="money">${price}</span>`];
  const h = holders(it, inf);
  meta.push(h ? `<span class="who">${esc(h)}</span>` : `<span class="st">${even ? 'Nobody' : 'No one yet'}</span>`);
  if (!even && it.qty > 1 && inf.left > 0 && inf.ent.length) meta.push(`<span class="st pend">${inf.left} of ${it.qty} left</span>`);
  const share = inf.out[target];
  if (mine && share != null && Math.round(share) !== it.cents) meta.push(`<b class="money">${target === me ? 'Yours' : esc(nameOf(target)) + '’s'} ${fmt(share)}</b>`);
  const addedBy = T.by && T.by[it.id] && T.by[it.id][target];
  if (!editFor && addedBy && addedBy !== target && (mine || even)) meta.push(`<span class="tag">${even ? 'Changed' : 'Added'} by ${esc(shortName(addedBy))}</span>`);
  const name = esc(it.name);
  if (!even && it.qty > 1) {
    return `<div class="row slotted${mine ? ' mine' : ''}"><div class="row-top">
      <button type="button" class="r-main" data-act="item" data-i="${it.id}" aria-label="${name}: who had each one">
        <span class="r-name">${name} <span class="muted">×${it.qty}</span></span><span class="r-meta">${meta.join('')}</span></button>
      ${T.closed ? '' : `<button type="button" class="mini" data-act="item" data-i="${it.id}" aria-label="Who had each ${name}">Edit</button>`}</div>
      ${slotsHtml(it, inf, target)}</div>`;
  }
  const ctl = T.closed ? ''
    : `<button type="button" class="mini" data-act="item" data-i="${it.id}" aria-label="Who shared ${name}">Split</button>
       <button type="button" class="tick" data-act="toggle" data-i="${it.id}" aria-pressed="${mine}" aria-label="${name}${forName}">${CHECK}</button>`;
  return `<div class="row${mine ? ' mine' : ''}">
    <button type="button" class="r-main" data-act="item" data-i="${it.id}" aria-label="${name}: who had it">
      <span class="r-name">${name}</span><span class="r-meta">${meta.join('')}</span></button>
    ${ctl}</div>`;
}

// One slot per unit on the receipt. A slot shows who had it: one initial, or
// two for a shared one ("H C"), or "+" when it's open.
function slotFace(ps) {
  if (!ps.length) return { face: '+', style: '' };
  const cols = ps.map((p) => pc(T.people[p]));
  const style = cols.length === 1 ? `--pc:${cols[0]}` : `--pc:${cols[0]};background:linear-gradient(135deg,${cols[0]} 50%,${cols[1]} 50%)`;
  const face = ps.length === 1 ? initial(T.people[ps[0]].name) : ps.length === 2 ? ps.map((p) => initial(T.people[p].name)).join('') : `${initial(T.people[ps[0]].name)}+${ps.length - 1}`;
  return { face: esc(face), style };
}
function slotsHtml(it, inf, target) {
  const name = esc(it.name);
  const slots = inf.slots.map((ps, k) => {
    const n = `${name} ${k + 1} of ${it.qty}`;
    const names = ps.map(shortName);
    const label = !ps.length ? `${n}: open, tap to take it${target === me ? '' : ` for ${esc(nameOf(target))}`}`
      : ps.includes(target) ? `${n}: ${esc(names.join(' and '))}. Tap to ${target === me ? 'give yours back' : `take ${esc(nameOf(target))} off`}`
        : `${n}: ${esc(names.join(' and '))}. Tap if ${target === me ? 'you' : esc(nameOf(target))} shared it`;
    const cls = !ps.length ? 'slot open' : ps.includes(target) ? 'slot mine' : 'slot taken';
    const { face, style } = slotFace(ps);
    return `<button type="button" class="${cls}${ps.length > 1 ? ' shared' : ''}" ${style ? `style="${style}"` : ''} data-act="slot" data-i="${it.id}" data-k="${k}" data-owner="${ps.join('+')}" aria-label="${label}" ${T.closed ? 'disabled' : ''}>${face}</button>`;
  }).join('');
  return `<div class="slots" role="group" aria-label="${name}, one per drink or plate">${slots}</div>`;
}

// [card style, words] for a person's status.
function statusOf(r) {
  const p = r.p;
  if (p.id === HOST) return ['', 'Paid the bill'];
  if (p.waived && r.settled) return ['done', p.paid ? `Paid ${fmt(p.paid)}, rest let go` : 'Let go'];
  if (p.paid != null && r.owed <= SLACK) return p.ok ? ['done', 'Paid ✓'] : ['check', isHost ? `Says they paid ${fmt(p.paid)}` : `Paid ${fmt(p.paid)}`];
  if (p.paid != null) return ['due', `Paid ${fmt(p.paid)}, owes ${fmt(r.owed)} more`];
  if (!r.total) return ['', 'No items yet'];
  return ['due', `Owes ${fmt(r.owed)}`];
}

// Where the bill stands: the payer's own share, what's back, what's owed, and what nobody has claimed.
function summaryCard(C) {
  const others = C.res.filter((r) => r.p.id !== HOST && !leaving.has(r.p.id));
  const yours = Math.max(0, C.byId[HOST] ? C.byId[HOST].total : 0);
  const paid = C.collected;
  const owed = others.reduce((s, r) => s + (r.settled ? 0 : Math.max(0, r.owed)), 0);
  const open = Math.max(0, C.pool);
  const back = Math.max(0, T.charge - yours);
  const parts = [['paid', 'Paid back', paid], ['owed', 'Owed', owed], ['open', 'Not claimed', open], ['yours', isHost ? 'Your share' : `${T.payer.name}’s share`, yours]].filter((x) => x[2] > SLACK);
  const sum = Math.max(T.charge, parts.reduce((s, x) => s + x[2], 0)) || 1;
  return `<div class="card summary">
    <p class="eyebrow">${isHost ? 'Paid back to you' : `Paid back to ${esc(T.payer.name)}`}</p>
    <p class="big-num money">${fmt(paid)} <span class="muted">of ${fmt(back)}</span></p>
    <div class="stack-bar" aria-hidden="true">${parts.map(([k, , v]) => `<i class="${k}" style="width:${(v / sum) * 100}%"></i>`).join('')}</div>
    <ul class="legend">${parts.map(([k, label, v]) => `<li><i class="${k}"></i>${label} <b class="money">${fmt(v)}</b></li>`).join('')}</ul></div>`;
}

function peoplePanel(C) {
  const others = C.res.filter((r) => r.p.id !== HOST && !leaving.has(r.p.id));
  let html = summaryCard(C);

  if (C.openItems.length || Math.abs(C.pool) > SLACK) {
    const n = C.openItems.length;
    html += `<div class="card open-card"><div class="card-h"><h3>${n ? `${plural(n, 'item')} not claimed yet` : 'Not covered yet'}</h3><b class="money">${fmt(C.pool)}</b></div>
      <p class="note" style="margin-top:0">${isHost ? 'Assign them, or once everyone’s had a look, split what’s left or cover it.' : `If you had one of these, claim it. Until then ${esc(T.payer.name)} is covering it.`}</p>`;
    if (n) {
      html += `<ul class="lines">${C.openItems.map((it) => {
        const inf = C.info[it.id];
        const what = T.mode !== 'even' && it.qty > 1 ? `${inf.left} × ${it.name}` : it.name;
        return `<li><span>${esc(what)}</span>${isHost ? `<button type="button" class="btn sm ghost" data-act="assign" data-i="${it.id}">Who had it?</button>` : `<button type="button" class="btn sm ghost" data-act="item" data-i="${it.id}">I had it</button>`}</li>`;
      }).join('')}</ul>`;
    }
    if (!T.closed && isHost) {
      html += `<div class="acts"><button type="button" class="btn sm ghost" data-act="pool" data-v="spread">Split across everyone who hasn’t paid</button>
        <button type="button" class="btn sm ghost" data-act="pool" data-v="cover">I’ll cover it</button></div>`;
    }
    html += '</div>';
  } else if (T.pool) {
    html += `<p class="banner ok">${T.pool === 'spread' ? 'Anything unclaimed is split across everyone who hasn’t paid.' : `${isHost ? 'You’re' : esc(T.payer.name) + ' is'} covering anything unclaimed.`}${isHost ? ' <button type="button" class="link" data-act="pool" data-v="none">Undo</button>' : ''}</p>`;
  }

  html += `<h2 class="group">People <span class="count">${others.length + 1}</span></h2>
    <div class="stack">${[C.byId[HOST], ...others].map((r) => personCard(r)).join('')}</div>
    ${T.closed || !isHost ? '' : `<form id="addPerson" class="row2" style="margin-top:12px" autocomplete="off"><label class="sr" for="addPersonName">Add someone</label>
      <input id="addPersonName" class="in" placeholder="Add someone" maxlength="24" autocapitalize="words"><button class="btn" type="submit" style="flex:0 0 auto">Add</button></form>`}`;

  if (!isHost) return html;
  const allDone = C.allPaid || (others.every((r) => r.settled || !r.total) && Math.abs(C.pool) <= SLACK);
  const owing = others.filter((r) => !r.settled && r.owed > SLACK).length;
  const row = (a, label, sub = '') => `<button type="button" class="list-row" data-act="${a}"><span class="grow"><b>${label}</b>${sub ? `<small class="muted">${sub}</small>` : ''}</span>${CHEV}</button>`;
  html += `<h2 class="group">Tab</h2><div class="rows">
    ${row('share', 'Share the link', 'Everyone taps their name and picks what they had')}
    ${owing && !T.closed ? row('remindall', 'Nudge the group', `${plural(owing, 'person owes', 'people owe')} you`) : ''}
    ${row('settings', 'Tab settings', 'Name, ways to pay you, privacy')}
    ${row('report', 'See the report')}
    ${/^deploy-preview-/.test(location.hostname) ? `<a class="list-row" href="${LIVE}/t/${tabId}#h=${encodeURIComponent(hostKey)}"><span class="grow"><b>Open on the live site</b></span>${CHEV}</a>` : ''}
    ${T.closed ? row('reopen', 'Reopen the tab') : row('close', 'Close the tab', allDone ? 'Everyone’s square' : 'Best once everyone has paid and nothing is left uncovered')}</div>`;
  return html;
}

function personCard(r) {
  const p = r.p, isMe = p.id === me, [cls, status] = statusOf(r);
  const items = r.lines.length
    ? `<ul class="mini-items">${r.lines.map((l) => `<li><span>${esc(l.label)}</span><span class="money">${fmt(l.amt)}</span></li>`).join('')}
       <li class="muted"><span>Tax, fees and tip</span><span class="money">${fmt(r.extrasR)}</span></li></ul>`
    : '<p class="note" style="margin:6px 0 0 50px">No items yet.</p>';
  let acts = '';
  let more = '';
  if (!T.closed && !isHost) {
    if (p.id === me) {
      acts += `<button type="button" class="btn sm ghost" data-act="editdone">Edit my items</button>`;
      if (r.owed > SLACK && !r.settled) acts += `<button type="button" class="btn sm" data-act="mine">Review and pay</button>`;
    }
  } else if (!T.closed) {
    const owes = !r.settled && r.owed > SLACK;
    if (p.id !== HOST && p.paid != null && !p.ok) acts += `<button type="button" class="btn sm" data-act="confirm" data-p="${p.id}">Confirm ${fmt(p.paid)}</button>`;
    else if (p.id !== HOST && owes) acts += `<button type="button" class="btn sm" data-act="remind" data-p="${p.id}">Remind</button>`;
    acts += `<button type="button" class="btn sm ghost" data-act="editfor" data-p="${p.id}">${p.id === me ? 'Edit my items' : 'Edit items'}</button>`;
    if (p.id !== HOST) {
      if (p.paid != null && !p.ok && owes) more += `<button type="button" class="btn sm ghost" data-act="remind" data-p="${p.id}">Remind</button>`;
      if (owes) more += `<button type="button" class="btn sm ghost" data-act="markpaid" data-p="${p.id}">Mark paid</button>`;
      if (p.paid != null && r.owed > SLACK) more += `<button type="button" class="btn sm ghost" data-act="waive" data-p="${p.id}">Let the ${fmt(r.owed)} go</button>`;
      if (p.paid != null) more += `<button type="button" class="btn sm ghost" data-act="unpaid" data-p="${p.id}">Undo payment</button>`;
      more += `<button type="button" class="btn sm danger" data-act="remove" data-p="${p.id}">Remove ${esc(p.name)}</button>`;
    }
  }
  const n = r.lines.length;
  return `<div class="card person-card ${cls === 'due' && r.total ? 'due' : cls}">
    <details class="pc" data-p="${p.id}" ${openCards.has(p.id) ? 'open' : ''}>
    <summary class="pc-head">${av(p, 'md')}<span class="p-name"><b>${isMe ? 'You' : esc(p.name)}</b><small class="st-${cls || 'none'}">${esc(status)}${n ? ` · ${plural(n, 'item')}` : ''}</small></span><b class="money pc-total">${fmt(r.total)}</b><span class="chev" aria-hidden="true"></span></summary>
    ${items}
    ${r.locked ? '<p class="note" style="margin-left:50px">Locked when they paid, so later changes won’t move it.</p>' : ''}
    </details>
    ${acts ? `<div class="acts">${acts}${more ? `<details class="more-acts" data-p="${p.id}" ${openPeople.has(p.id) ? 'open' : ''}><summary class="btn sm ghost" aria-label="More for ${esc(p.name)}">More</summary><div class="acts">${more}</div></details>` : ''}</div>` : ''}
  </div>`;
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
  if (editFor && T.people[editFor]) {
    const r = C.byId[editFor];
    setHTML($('#dockIn'), `<div class="dock-sum" aria-live="polite"><span>${esc(nameOf(editFor))}’s total</span><strong class="money">${fmt(r.total)}</strong><small>Tax and tip included</small></div>
      <button type="button" class="btn" data-act="editdone">Done</button>`);
    return;
  }
  const r = C.byId[me];
  let left, right = '';
  if (me === HOST) {
    const open = Math.max(0, C.pool), owed = C.res.reduce((s, x) => s + (x.p.id === HOST || x.settled ? 0 : Math.max(0, x.owed)), 0);
    left = `<span>Paid back to you</span><strong class="money">${fmt(C.collected)}</strong><small class="money">${open > SLACK ? `${fmt(open)} not claimed yet` : owed > SLACK ? `${fmt(owed)} still owed` : 'Everyone’s square'}</small>`;
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
/* GymBuddy's sheet: rises from the bottom edge on the surface spring while the scrim fades in, slides
   back down however it closes, and moves to a new sheet by easing its height. */
const dlg = $('#sheet'), panel = $('#sheetPanel'), scrim = $('#scrim'), sheetWrap = $('#sheetWrap');
let closing = null;
const sheetC = () => (T ? compute_() : null);
function openSheet(s) {
  const b = $('#sheetBody');
  if (dlg.open && !closing) { // already up: swap what it shows
    const h0 = panel.offsetHeight;
    sheet = s; b._h = null; renderSheet(sheetC()); b.scrollTop = 0;
    const h1 = panel.offsetHeight;
    if (Math.abs(h1 - h0) > 1) {
      const a = anim(panel, [{ height: `${h0}px` }, { height: `${h1}px` }], 'surface');
      if (a) { panel.style.overflow = 'hidden'; a.finished.catch(() => {}).then(() => { panel.style.overflow = ''; }); }
    }
    anim(b, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 'enter');
    return;
  }
  if (closing) { closing = null; stopSheetMotion(); } // reopened on its way out
  sheet = s; b._h = null; renderSheet(sheetC());
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  document.documentElement.style.overflow = 'hidden';
  fitSheet();
  anim(panel, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], 'surface');
  anim(scrim, [{ opacity: 0 }, { opacity: 1 }], 'enter');
}
function stopSheetMotion() {
  for (const el of [panel, scrim]) if (el.getAnimations) el.getAnimations().forEach((x) => x.cancel());
  panel.style.transform = ''; scrim.style.opacity = '';
}
/** Closes the sheet now as far as the page is concerned; the slide down finishes on its own. */
function closeSheet() {
  sheet = null;
  if (!dlg.open || closing) return;
  const tok = closing = {};
  const done = () => {
    if (closing !== tok) return; // reopened meanwhile
    closing = null;
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
    const b = $('#sheetBody'); b._h = null; b.innerHTML = '';
    document.documentElement.style.overflow = '';
    document.body.appendChild($('#toasts'));
    stopSheetMotion();
  };
  const at = panel.animate ? getComputedStyle(panel).transform : 'none'; // where a drag left it
  const opts = { duration: dur('exit') + 20, easing: EXIT_EASE, fill: 'forwards' };
  const a = still() ? null : anim(panel, [{ transform: at === 'none' ? 'translateY(0)' : at }, { transform: 'translateY(100%)' }], 'exit', opts);
  if (!a) { done(); return; }
  anim(scrim, [{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], 'exit', opts);
  a.finished.catch(() => {}).then(done);
}
dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); }); // Escape
scrim.addEventListener('click', () => closeSheet());

/* The sheet stays in the part of the screen the keyboard leaves visible. */
const vv = window.visualViewport;
function fitSheet() { if (!vv) return; sheetWrap.style.setProperty('--vv-top', `${vv.offsetTop}px`); sheetWrap.style.setProperty('--vv-h', `${vv.height}px`); }
if (vv) { vv.addEventListener('resize', fitSheet); vv.addEventListener('scroll', fitSheet); }

/* Drag down to close, from the grab bar and title, or from the content when it's scrolled to the top.
   Far (140 px or 35%) or fast (0.5 px/ms) closes from where the finger let go; otherwise it springs back.
   Text fields keep their own gestures. */
{
  const START = 8, FAR = 140, FLICK = 0.5;
  let g = null;
  panel.addEventListener('touchstart', (e) => {
    g = null;
    if (e.touches.length !== 1 || closing || e.target.closest('input, textarea, select')) return;
    for (let el = e.target; el && el !== panel; el = el.parentElement) if (el.scrollTop > 0) return; // scroll back up first
    g = { x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0, on: null, trail: [] };
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (!g || g.on === false) return;
    const p = e.touches[0];
    if (g.on === null) {
      const dx = p.clientX - g.x, dy = p.clientY - g.y;
      if (Math.hypot(dx, dy) < START) return;
      g.on = dy > 0 && dy > Math.abs(dx);
      if (!g.on) return;
      g.y += START; // the dead zone doesn't count, so the sheet doesn't jump when it starts following
      panel.classList.add('dragging');
    }
    e.preventDefault();
    g.dy = Math.max(0, p.clientY - g.y);
    panel.style.transform = `translateY(${g.dy}px)`;
    scrim.style.opacity = String(1 - Math.min(1, g.dy / panel.offsetHeight));
    g.trail.push([p.clientY, e.timeStamp]); if (g.trail.length > 5) g.trail.shift();
  }, { passive: false });
  const end = (e) => {
    const d = g; g = null;
    if (!d || !d.on) return;
    panel.classList.remove('dragging');
    const [a, z] = [d.trail[0], d.trail[d.trail.length - 1]];
    const speed = a && z && z[1] > a[1] ? (z[0] - a[0]) / (z[1] - a[1]) : 0;
    if (e.type === 'touchend' && (d.dy > Math.min(FAR, panel.offsetHeight * 0.35) || (speed > FLICK && d.dy > 24))) {
      if (sheet && sheet.type === 'paycheck') payReturn = null;
      closeSheet();
      return;
    }
    const at = panel.style.transform;
    panel.style.transform = ''; scrim.style.opacity = '';
    if (at) anim(panel, [{ transform: at }, { transform: 'translateY(0)' }], 'surface');
  };
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
}
const done = (label = 'Done') => `<button type="button" class="btn ghost wide" data-act="close-sheet">${label}</button>`;

// Pay buttons for each way the payer listed; the first is the main one.
function payButtons(amt) {
  const ways = WAYS.filter((k) => T.payer[k]);
  if (!ways.length) return `<p class="banner">${esc(T.payer.name)} didn’t list a way to pay. Pay them however you usually do, then record it.</p>`;
  return ways.map((k, n) => {
    const cls = `btn wide pay-btn${n ? ' ghost' : ''}`;
    if (k === 'zelle') return `<button type="button" class="${cls}" data-act="pay" data-how="zelle" data-amt="${amt}">Pay ${fmt(amt)} with Zelle</button><p class="note center">Zelle to ${esc(T.payer.zelle)}. Tapping copies it.</p>`;
    return `<a class="${cls}" href="${PAY[k].url(T.payer[k], amt, T.title || 'Tab')}" target="_blank" rel="noopener" data-act="pay" data-how="${k}" data-amt="${amt}">Pay ${fmt(amt)} with ${PAY[k].name}</a>`;
  }).join('');
}

function renderSheet(C) {
  const b = $('#sheetBody');
  const s = sheet;
  if (!s) return;
  if (s.type === 'photo') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">The receipt</h2><p class="sub">Pinch to zoom.</p><img class="receipt-img" src="${S.photo || ''}" alt="The receipt photo"><div class="sh-foot">${done()}</div></div>`);
    return;
  }
  if (!T) return;
  if (s.type === 'item') {
    const it = T.items.find((x) => x.id === s.i); if (!it) { closeSheet(); return; }
    const inf = C.info[it.id], even = T.mode === 'even';
    const k = Math.min(s.k || 0, it.qty - 1);
    const t = who();
    const order = [t, ...people().map((p) => p.id).filter((id) => id !== t)];
    const slot = even ? null : inf.slots[k];
    const isIn = (pid) => (even ? units(it.id, pid) > 0 : slot.includes(pid));
    const rows = order.map((pid) => {
      const p = T.people[pid], label = pid === me ? 'You' : esc(p.name);
      return `<div class="prow">${av(p)}<span class="grow">${label}</span>
        <button type="button" class="tick" style="--me:${pc(p)}" data-act="s-toggle" data-p="${pid}" aria-pressed="${isIn(pid)}" aria-label="${label} had ${even || it.qty < 2 ? esc(it.name) : `number ${k + 1}`}">${CHECK}</button></div>`;
    }).join('');
    const title = `<h2 id="sheetTitle">${esc(it.name)} <span class="muted money">${fmt(it.cents)}</span></h2>`;
    if (even || it.qty < 2) {
      const sub = even ? 'Everyone ticked splits it evenly.' : 'Tick everyone who had it. It’s split evenly between them.';
      setHTML(b, `<div class="sh">${title}<p class="sub">${sub}</p>${rows}<div class="sh-foot">${done()}</div></div>`);
      return;
    }
    // Several on the receipt: how many each person had, then (optionally) who shared a single one.
    const open = inf.slots.filter((x) => !x.length).length;
    const counts = order.map((pid) => {
      const p = T.people[pid], label = pid === me ? 'You' : esc(p.name);
      const n = inf.slots.filter((x) => x.includes(pid)).length;
      const shared = inf.slots.filter((x) => x.length > 1 && x.includes(pid)).length;
      return `<div class="prow">${av(p)}<span class="grow">${label}${shared ? ` <span class="muted">(${shared} shared)</span>` : ''}</span>
        <span class="stepper"><button type="button" data-act="s-dec" data-p="${pid}" aria-label="One fewer for ${label}" ${n ? '' : 'disabled'}>−</button><output aria-label="${label} has">${n}</output><button type="button" data-act="s-inc" data-p="${pid}" aria-label="One more for ${label}" ${open ? '' : 'disabled'}>+</button></span></div>`;
    }).join('');
    const strip = `<div class="slots sheet-slots" role="group" aria-label="Each one on the receipt">${inf.slots.map((ps, j) => {
      const { face, style } = slotFace(ps);
      const cls = !ps.length ? 'open' : ps.includes(t) ? 'mine' : 'taken';
      return `<button type="button" class="slot ${cls}${ps.length > 1 ? ' shared' : ''}${s.share && j === k ? ' picked' : ''}" ${style ? `style="${style}"` : ''} data-act="s-pick" data-k="${j}" aria-pressed="${!!s.share && j === k}" aria-label="Number ${j + 1}: ${ps.length ? esc(ps.map(shortName).join(' and ')) : 'open'}. Tap to choose who shared it">${face}</button>`;
    }).join('')}</div>`;
    let share = '';
    if (s.ask && slot.length && !slot.includes(t)) {
      share += `<div class="banner"><p style="margin:0 0 8px">Number ${k + 1} is ${esc(slot.map(shortName).join(' and '))}’s. Did ${t === me ? 'you' : esc(nameOf(t))} share it?</p>
        <button type="button" class="btn sm" data-act="s-yes">Yes, ${t === me ? 'I' : esc(nameOf(t))} shared it</button></div>`;
    }
    if (s.share) {
      share += `<h3 class="sheet-h">Who shared number ${k + 1}?</h3>${rows}
        ${slot.length ? `<button type="button" class="btn ghost wide" data-act="s-all" style="margin-top:10px">Same people for all ${it.qty}</button>` : ''}`;
    }
    setHTML(b, `<div class="sh">${title}
      <p class="sub">${it.qty} on the receipt at ${fmt(it.cents / it.qty)} each. ${open ? `${open} still open.` : 'All accounted for.'}</p>
      ${strip}
      <h3 class="sheet-h">How many each person had</h3>${counts}
      ${share || '<p class="note">If two people shared one, tap it above to pick who.</p>'}
      <div class="sh-foot">${done()}</div></div>`);
  } else if (s.type === 'mine') {
    const r = C.byId[me];
    let pay = '';
    if (me !== HOST && r.owed > SLACK && !T.closed) {
      pay = payButtons(r.owed) + `<button type="button" class="link" data-act="other">I paid another way</button>`;
    }
    if (me !== HOST && r.p.paid != null && !T.closed) pay += `<button type="button" class="link" data-act="unpaid-me">Undo my payment</button>`;
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">${me === HOST ? 'Your share' : 'Your total'} <span class="money">${fmt(r.total)}</span></h2>
      <p class="sub">Your items, plus your share of tax, fees and tip in proportion to what you had.</p>
      ${linesHtml(r)}
      ${r.p.paid != null && me !== HOST ? `<p class="banner ${r.owed <= SLACK ? 'ok' : ''} money">You’ve paid ${fmt(r.p.paid)}${r.p.waived ? `; ${esc(T.payer.name)} let ${fmt(r.p.waived)} go` : ''}${r.owed > SLACK ? `. ${fmt(r.owed)} left.` : '.'}</p>` : ''}
      <div class="sh-foot">${pay}${done('Close')}</div></div>`);
  } else if (s.type === 'paycheck') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Did your ${wayName(s.how)} payment go through?</h2><p class="sub">Mark it so ${esc(T.payer.name)} knows you’re square.</p>
      <div class="sh-foot"><button type="button" class="btn wide" data-act="paidyes" data-amt="${s.amt}">Yes, I paid ${fmt(s.amt)}</button>${done('Not yet')}</div></div>`);
  } else if (s.type === 'other' || s.type === 'markpaid') {
    if (b.querySelector('#amount')) return; // keep what they're typing
    const who = s.type === 'other' ? me : s.p;
    const r = C.byId[who];
    b._h = null;
    b.innerHTML = `<div class="sh"><h2 id="sheetTitle">${s.type === 'other' ? 'How much did you send?' : `What did ${esc(nameOf(who))} pay?`}</h2>
      <p class="sub">${s.type === 'other' ? 'Cash, Apple Cash, anything. Put in what you actually sent.' : 'Put in what they actually paid you.'}</p>
      <form id="amountForm"><label class="sr" for="amount">Amount in dollars</label>
      <div class="adorn big"><span aria-hidden="true">$</span><input id="amount" class="in money" inputmode="decimal" value="${dollars(Math.max(0, r.owed))}" autocomplete="off"></div>
      <div class="sh-foot"><button class="btn wide" type="submit">Save</button>${done('Cancel')}</div></form></div>`;
  } else if (s.type === 'created') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Your tab is ready</h2>
      <p class="sub">How do you want to fill it in?</p>
      <div class="paths">
        <button type="button" class="path" data-act="go-assign"><b>I know who had what</b><span>Assign the items yourself, then send each person their total.</span>${CHEV}</button>
        <button type="button" class="path" data-act="share"><b>Send the link</b><span>Everyone taps their name, picks what they had and pays you.</span>${CHEV}</button>
      </div>
      <p class="note">You can mix both: assign what you know, then share the link for the rest.</p>
      <div class="sh-foot">${done('Not now')}<button type="button" class="link" data-act="copyhost">Copy your host link</button></div>
      <p class="note center">This phone is the host. The host link lets you manage the tab from another device. Keep it to yourself.</p></div>`);
  } else if (s.type === 'close') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Close the tab?</h2><p class="sub">Nobody can change their items after this. You can reopen it.</p>
      <div class="sh-foot"><button type="button" class="btn wide" data-act="close-yes">Close the tab</button>${done('Cancel')}</div></div>`);
  } else if (s.type === 'settings') {
    if (b.querySelector('#settingsForm')) return; // keep what they're typing
    b._h = null;
    b.innerHTML = `<div class="sh"><h2 id="sheetTitle">Tab settings</h2>
      <form id="settingsForm" autocomplete="off">
      <label class="f" for="sTitle">Name of the tab</label><input id="sTitle" class="in" maxlength="60" value="${esc(T.title || '')}">
      <h3 class="sheet-h">How friends pay you</h3>
      <p class="sub">Fill in any you use. Friends get a button for each.</p>
      ${WAYS.map((k) => payField(k, T.payer[k])).join('')}
      <label class="switch" style="margin-top:18px"><input type="checkbox" id="sPrivate" ${T.private ? 'checked' : ''}><span class="track" aria-hidden="true"></span><span><b>Keep totals private</b><span>Friends see only their own total, not everyone’s.</span></span></label>
      <div class="sh-foot"><button class="btn wide" type="submit">Save</button>${done('Cancel')}</div></form></div>`;
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
function setUnits(i, p, u) { // even split: in (1) or out (0)
  lastActivity = Date.now();
  pend.set(i + '|' + p, u > 0 ? 1 : 0);
  renderAll(); scheduleFlush();
}
function slotOp(op) { // itemized: take / join / leave a slot
  lastActivity = Date.now();
  pendOps.push(op);
  renderAll(); scheduleFlush();
}
// The tick on a single item: in or out (joining shares it with whoever has it).
function toggleItem(it, p) {
  popAfter = `[data-act="toggle"][data-i="${it.id}"]`;
  if (T.mode === 'even') { setUnits(it.id, p, units(it.id, p) > 0 ? 0 : 1); return; }
  const k = 0, sl = slotsNow(it);
  slotOp({ a: sl[k].includes(p) ? 'leave' : 'join', i: it.id, k, p });
}
function setMe(id, fromLink) {
  me = id;
  store.set('tab-me:' + tabId, id);
  if (id) beacon({ op: 'pick', p: id });
  if (!isHost) view = 'items';
  arrangement = null;
  rememberTab();
  if (!fromLink) { renderAll(); window.scrollTo(0, 0); }
}
// Back to the list of people (or to your own items), from editing someone else's.
function editDone() {
  const back = editReturn || (editFor && !isHost ? 'people' : null);
  editFor = null; editReturn = null; arrangement = null;
  if (back) view = back; else if (!isHost) view = 'items';
  renderAll(); window.scrollTo(0, 0);
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); return true; } catch (e) { toast('Couldn’t copy. Long-press to copy it instead.'); return false; }
}
async function shareText(text, msg) {
  if (navigator.share) { try { await navigator.share({ text }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; } }
  return copyText(text, msg || 'Copied. Paste it in a message.');
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
function remindAll() {
  const C = compute_();
  const owing = C.res.filter((r) => r.p.id !== HOST && !r.settled && r.owed > SLACK);
  track('nudge_sent');
  const list = T.private ? '' : ` Still open: ${owing.map((r) => `${r.p.name} ${fmt(r.owed)}`).join(', ')}.`;
  shareText(`Quick nudge for ${T.title || 'the tab'}: if you haven’t yet, tap your name and pay ${T.payer.name} back.${list} ${location.origin}/t/${tabId}`, 'Nudge copied. Paste it in the group chat.');
}
function afterPay(amt, how) {
  track('pay_tapped', { amount: Math.round(amt) });
  payReturn = { amt, how };
  setTimeout(() => { if (payReturn && !document.hidden) openSheet({ type: 'paycheck', amt: payReturn.amt, how: payReturn.how }); }, 1500);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollT); return; }
  lastActivity = Date.now();
  if (payReturn) openSheet({ type: 'paycheck', amt: payReturn.amt, how: payReturn.how });
  if (tabId && T) { poll(); if (pend.size || pendOps.length) scheduleFlush(50); }
});

app.addEventListener('click', (e) => {
  if (!tabId || !T) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  lastActivity = Date.now();
  if (a === 'pick') { setMe(b.dataset.p); return; }
  if (a === 'view') { view = b.dataset.v; editFor = null; editReturn = null; arrangement = null; renderAll(); return; }
  if (a === 'assignto') { editFor = b.dataset.p === me ? null : b.dataset.p; arrangement = null; renderAll(); return; }
  const it = b.dataset.i && T.items.find((x) => x.id === b.dataset.i);
  if (a === 'item' && it) { openSheet({ type: 'item', i: it.id }); return; }
  if (a === 'slot' && it) {
    const k = Number(b.dataset.k), t = who(), sl = slotsNow(it)[k] || [];
    popAfter = `[data-act="slot"][data-i="${it.id}"][data-k="${k}"]`;
    if (!sl.length) slotOp({ a: 'take', i: it.id, p: t });
    else if (sl.includes(t)) slotOp({ a: 'leave', i: it.id, k, p: t });
    else { popAfter = null; openSheet({ type: 'item', i: it.id, k, ask: true, share: true }); }
    return;
  }
  if (a === 'toggle' && it) toggleItem(it, who());
  if (a === 'editfor') { editFor = b.dataset.p === me ? null : b.dataset.p; editReturn = 'people'; view = 'items'; arrangement = null; renderAll(); window.scrollTo(0, 0); return; }
  if (a === 'editdone') { if (!editFor && !isHost) { view = 'items'; arrangement = null; renderAll(); window.scrollTo(0, 0); } else editDone(); return; }
  if (a === 'mine') { openSheet({ type: 'mine' }); return; }
  if (a === 'assign' && it) { view = 'items'; editFor = null; arrangement = null; renderAll(); openSheet({ type: 'item', i: it.id }); return; }
  if (a === 'pool') act({ op: 'setup', pool: b.dataset.v === 'none' ? null : b.dataset.v }, b.dataset.v === 'spread' ? 'Split across everyone who hasn’t paid' : b.dataset.v === 'cover' ? 'You’re covering it' : 'Undone');
  if (a === 'remind') remind(b.dataset.p);
  if (a === 'remindall') remindAll();
  if (a === 'markpaid') openSheet({ type: 'markpaid', p: b.dataset.p });
  if (a === 'confirm') act({ op: 'confirm', p: b.dataset.p }, `Confirmed ${nameOf(b.dataset.p)}’s payment`);
  if (a === 'waive') act({ op: 'waive', p: b.dataset.p }, 'Let it go');
  if (a === 'unpaid') act({ op: 'unpaid', p: b.dataset.p }, 'Payment undone', undoUnpaid(b.dataset.p));
  if (a === 'remove') removePerson(b.dataset.p);
  if (a === 'share') shareLink();
  if (a === 'settings') openSheet({ type: 'settings' });
  if (a === 'report') window.open(`/api/report?t=${tabId}&key=${encodeURIComponent(hostKey)}`, '_blank', 'noopener');
  if (a === 'close') openSheet({ type: 'close' });
  if (a === 'reopen') act({ op: 'reopen' }, 'Tab reopened');
});
app.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.classList && d.classList.contains('more-acts')) { if (d.open) openPeople.add(d.dataset.p); else openPeople.delete(d.dataset.p); }
  if (d.classList && d.classList.contains('pc')) { if (d.open) openCards.add(d.dataset.p); else openCards.delete(d.dataset.p); }
}, true);
app.addEventListener('submit', async (e) => {
  if (!tabId || !T) return;
  if (e.target.id === 'joinForm') {
    e.preventDefault();
    const name = $('#joinName').value.trim(); if (!name) return;
    const r = await act({ op: 'join', name });
    if (r && r.person) setMe(r.person);
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
  if (b.dataset.act === 'editdone') editDone();
});
$('#sheetBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !sheet) return;
  const a = b.dataset.act, s = sheet;
  lastActivity = Date.now();
  if (a === 'close-sheet') { if (s.type === 'paycheck') payReturn = null; closeSheet(); return; }
  if (!T) return;
  if (a === 'share') { shareLink(); return; }
  if (a === 'go-assign') { closeSheet(); view = 'items'; editFor = null; arrangement = null; renderAll(); window.scrollTo(0, 0); return; }
  if (a === 'copyhost') { copyText(`${location.origin}/t/${tabId}#h=${hostKey}`, 'Host link copied. Keep it somewhere private.'); return; }
  if (a === 'pay') {
    const amt = Number(b.dataset.amt), how = b.dataset.how;
    if (how === 'zelle') copyText(T.payer.zelle, `Copied. Send ${fmt(amt)} with Zelle in your bank app.`);
    afterPay(amt, how); return;
  }
  if (a === 'other') { openSheet({ type: 'other' }); return; }
  if (a === 'paidyes') { payReturn = null; closeSheet(); act({ op: 'paid', p: me, amount: Number(b.dataset.amt), how: s.how || 'venmo' }, 'Marked as paid. Thanks!', undoPaid(me)); return; }
  if (a === 'close-yes') { closeSheet(); act({ op: 'close' }, 'Tab closed', () => act({ op: 'reopen' }, 'Tab reopened')); return; }
  if (a === 'unpaid-me') { closeSheet(); act({ op: 'unpaid', p: me }, 'Payment undone', undoUnpaid(me)); return; }
  if (a === 'switch') { closeSheet(); me = null; store.set('tab-me:' + tabId, null); renderAll(); return; }
  if (s.type === 'item') {
    const it = T.items.find((x) => x.id === s.i); if (!it) return;
    const k = Math.min(s.k || 0, it.qty - 1);
    if (a === 's-pick') { sheet.k = Number(b.dataset.k); sheet.ask = false; sheet.share = true; renderSheet(compute_()); return; }
    if (a === 's-inc') {
      if (!slotsNow(it).some((x) => !x.length)) { toast(`All ${it.qty} are taken. Lower someone first, or tap one to share it.`); return; }
      slotOp({ a: 'take', i: it.id, p: b.dataset.p });
    }
    if (a === 's-dec') {
      const pid = b.dataset.p, sl = slotsNow(it);
      // give back a solo one first, the last one they took
      let j = -1;
      sl.forEach((x, n) => { if (x.length === 1 && x[0] === pid) j = n; });
      if (j < 0) sl.forEach((x, n) => { if (x.includes(pid)) j = n; });
      if (j >= 0) slotOp({ a: 'leave', i: it.id, k: j, p: pid });
    }
    if (a === 's-yes') { sheet.ask = false; sheet.share = true; slotOp({ a: 'join', i: it.id, k, p: who() }); return; }
    if (a === 's-toggle') {
      const pid = b.dataset.p;
      if (T.mode === 'even') setUnits(it.id, pid, units(it.id, pid) > 0 ? 0 : 1);
      else slotOp({ a: slotsNow(it)[k].includes(pid) ? 'leave' : 'join', i: it.id, k, p: pid });
    }
    if (a === 's-all') {
      const ps = slotsNow(it)[k].slice();
      flush().then(() => act({ op: 'shareAll', i: it.id, ps }, `All ${it.qty} shared by ${ps.length}`));
    }
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
    act({ op: 'paid', p, amount: c, how: 'other' }, s.type === 'other' ? 'Recorded. Thanks!' : `Marked ${nameOf(p)} as paid`, undoPaid(p));
  }
  if (e.target.id === 'renameForm') {
    const name = $('#renameInput').value.trim(); if (!name) return;
    closeSheet(); act({ op: 'rename', p: me, name }, 'Name updated');
  }
  if (e.target.id === 'settingsForm') {
    const f = { title: $('#sTitle').value.trim(), private: $('#sPrivate').checked };
    for (const k of WAYS) f[k] = $('#' + k).value.trim();
    act({ op: 'setup', ...f }, 'Settings saved').then((r) => { if (r) closeSheet(); });
  }
});
window.addEventListener('online', () => { if (tabId) { poll(); if (pend.size || pendOps.length) scheduleFlush(50); } });
window.addEventListener('pagehide', () => { if (pend.size || pendOps.length) flush(); if (toastEl) dismissToast(toastEl); }); // a pending remove goes now
window.addEventListener('popstate', (e) => {
  if (!tabId) { // a setup step
    const step = (e.state && e.state.step) || 'photo';
    S.step = step !== 'photo' && !S.items.length ? 'photo' : step;
    if (sheet) closeSheet();
    renderStart(); window.scrollTo(0, 0);
    return;
  }
  if (location.pathname === '/t/' + tabId) { if (sheet) closeSheet(); return; }
  location.reload();
});

/* ---------- Start ---------- */
async function start() {
  installMotion();
  if (!tabId) {
    // A reload keeps the step (it's in history); a fresh visit starts at the top and offers the draft.
    const step = history.state && history.state.step;
    if (step && hasDraft(draft)) { Object.assign(S, draft); S.step = STEPS[step] != null ? step : 'photo'; }
    else history.replaceState({ step: 'photo' }, '');
    renderStart();
    return;
  }
  if (hostKey) {
    let missing = false;
    try { const d = await post({ op: 'checkhost', t: tabId, key: hostKey }); isHost = !!d.isHost; } catch (e) { isHost = false; missing = e.status === 404; }
    if (isHost) { me = HOST; store.set('tab-me:' + tabId, HOST); } else if (!missing) { hostKey = null; }
  }
  if (isHost) view = 'people';
  await poll(true);
  rememberTab();
  track('link_opened');
}
start();

// For tests
export const _debug = { get T() { return T; }, get me() { return me; }, get isHost() { return isHost; }, flush, itemsTotal };
