// Reads a receipt for a new tab: Haiku 5.5 first, Sonnet 5 only when Haiku's
// items don't add up to the printed subtotal (the step 3 result). Spending is
// capped per month, counted with conditional writes so simultaneous scans
// can't undercount.

import { MODELS, scanReceipt } from './scan.mjs';
import { HttpError } from './core.mjs';

const MAX_IMAGE_CHARS = 4_000_000; // base64; about 3 MB of JPEG

// Do the items (plus any fee printed among them) add up to the printed subtotal?
export function addsUp(r) {
  if (!r || !Array.isArray(r.items) || !r.items.length) return false;
  const sum = r.items.reduce((s, it) => s + Math.round(Number(it.price || 0) * 100), 0) +
    (Array.isArray(r.fees) ? r.fees : []).filter((f) => f.listed_with_items).reduce((s, f) => s + Math.round(Number(f.amount || 0) * 100), 0);
  const printed = r.subtotal ?? r.total;
  return printed != null && Math.abs(sum - Math.round(printed * 100)) < 1;
}

// What the host most likely paid: the card charge if shown, else total plus a tip written outside it.
// A slip signed before the tip often has its printed total read as the card charge; when a tip is written
// below the total, the charge is at least total + tip, or the host would collect too little.
export function likelyCharge(r) {
  if (!r) return null;
  const c = (v) => Math.round(v * 100);
  const tip = r.tip != null && r.tip_included_in_total === false ? c(r.tip) : 0;
  const withTip = r.total != null ? c(r.total) + tip : null;
  if (r.card_charge != null) return withTip != null && tip ? Math.max(c(r.card_charge), withTip) : c(r.card_charge);
  return withTip;
}

const monthKey = (now) => `budget/${new Date(now).toISOString().slice(0, 7)}`;

async function spent(store, now) {
  const r = await store.getWithMetadata(monthKey(now), { type: 'json' });
  return { credits: (r && r.data && r.data.credits) || 0, etag: r && r.etag };
}
async function addSpend(store, now, credits) {
  for (let i = 0; i < 10; i++) {
    const cur = await spent(store, now);
    const next = { credits: Math.round((cur.credits + credits) * 1000) / 1000 };
    const w = await store.setJSON(monthKey(now), next, cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (w && w.modified) return next.credits;
  }
  return null;
}

export async function readReceipt({ imageBase64, mediaType, store, cap, now = Date.now(), env, fetchImpl }) {
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100) throw new HttpError(400, 'That photo didn’t come through. Try again, or type the items.');
  if (imageBase64.length > MAX_IMAGE_CHARS) throw new HttpError(413, 'That photo is too large. Try again, or type the items.');
  const before = await spent(store, now);
  if (before.credits >= cap) throw new HttpError(429, 'Receipt reading is paused for this month. Type the items instead.');

  const tries = [];
  let used = 0;
  for (const name of ['haiku', 'sonnet']) {
    const res = await scanReceipt({ imageBase64, mediaType, model: MODELS[name], env, fetchImpl });
    if (res.noKey) {
      // Not this receipt's fault: the AI key hasn't reached this function yet. The page waits and retries.
      console.error('receipt scan: no AI key yet');
      throw new HttpError(503, 'Receipt reading is warming up. Try again in a moment, or type the items.');
    }
    used += res.credits || 0;
    const ok = !res.error && res.receipt && addsUp(res.receipt);
    tries.push({ model: name, ok, error: res.error, credits: res.credits, ms: res.ms, receipt: res.receipt });
    if (ok) break;
    if (name === 'haiku' && before.credits + used >= cap) break; // no room for the fallback
  }
  const total = await addSpend(store, now, used);
  const best = tries.find((t) => t.ok) || tries.filter((t) => t.receipt).at(-1);
  if (!best) {
    // Without this the reason (bad key, rejected image, gateway down) never reaches the function logs.
    console.error('receipt scan failed', JSON.stringify(tries.map(({ model, error, ms }) => ({ model, error: error || 'no tool call in reply', ms }))));
    throw new HttpError(502, 'Couldn’t read that receipt. Try again, or type the items.');
  }
  return {
    receipt: best.receipt,
    model: best.model,
    check: best.ok ? 'matched' : 'flagged',
    charge: likelyCharge(best.receipt),
    credits: Math.round(used * 1000) / 1000,
    monthCredits: total,
    tries: tries.map(({ receipt, ...t }) => t),
  };
}
