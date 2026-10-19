// Step 3 receipt test. Lives only on the receipt-eval branch's deploy preview.
// GET /api/eval?key=…&model=haiku|sonnet&r=<receipt>&run=1  scans one receipt and scores it
// GET /api/eval?key=…&summary=1                              totals per model
// GET /api/eval?key=…&detail=<model>:<receipt>:<run>         what was missed
import { getStore } from '@netlify/blobs';
import { MODELS, scanReceipt } from '../lib/scan.mjs';
import { RECEIPTS } from '../eval/receipts.mjs';
import { TRUTH } from '../eval/truth.mjs';
import { score } from '../eval/score.mjs';

const KEY = 'e291736b06108a0c35a5578d';
const CREDIT_CAP = 40; // stop the whole test before it spends more than this

const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req, context) => {
  const q = new URL(req.url).searchParams;
  if (q.get('key') !== KEY) return out({ error: 'Wrong key' }, 403);
  const where = (context && context.deploy && context.deploy.context) || 'dev';
  if (where === 'production') return out({ error: 'The receipt test only runs on a preview' }, 403);
  const store = getStore({ name: `eval-${where}`, consistency: 'strong' });

  if (q.get('summary')) {
    const { blobs } = await store.list({ prefix: 'r/' });
    const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    const by = {};
    for (const r of rows) {
      if (!r || r.error) continue;
      const m = (by[r.model] ||= { scans: 0, items_correct: 0, items_truth: 0, extras: 0, matched: 0, flagged: 0, silent_miss: 0, total_ok: 0, card_charge_ok: 0, card_charge_n: 0, gratuity_ok: 0, credits: 0, ms: 0, perReceipt: {} });
      const s = r.score;
      m.scans++; m.items_correct += s.items_correct; m.items_truth += s.items_truth; m.extras += s.extras;
      m[s.reconcile]++; m.total_ok += s.total_ok ? 1 : 0; m.gratuity_ok += s.gratuity_ok ? 1 : 0;
      if (s.card_charge_ok != null) { m.card_charge_n++; m.card_charge_ok += s.card_charge_ok ? 1 : 0; }
      m.credits += r.credits || 0; m.ms += r.ms || 0;
      (m.perReceipt[r.r] ||= []).push(`${s.items_correct}/${s.items_truth}${s.extras ? `+${s.extras}x` : ''} ${s.reconcile}`);
    }
    for (const m of Object.values(by)) {
      m.item_accuracy = Math.round((m.items_correct / (m.items_truth + m.extras)) * 1000) / 1000;
      m.credits_per_scan = Math.round((m.credits / m.scans) * 1000) / 1000;
      m.seconds_per_scan = Math.round(m.ms / m.scans / 100) / 10;
      m.credits = Math.round(m.credits * 100) / 100;
      delete m.ms;
    }
    const spent = (await store.get('spent', { type: 'json' })) || 0;
    return out({ spent: Math.round(spent * 100) / 100, models: by });
  }

  if (q.get('detail')) {
    const r = await store.get(`r/${q.get('detail').replace(/:/g, '/')}`, { type: 'json' });
    if (!r) return out({ error: 'No such result' }, 404);
    const g = r.receipt || {};
    return out({ model: r.model, r: r.r, score: r.score, got: { subtotal: g.subtotal, fees: g.fees, gratuity: g.gratuity, tax: g.tax, total: g.total, tip: g.tip, tip_included_in_total: g.tip_included_in_total, card_charge: g.card_charge, flags: g.flags }, usage: r.usage, error: r.error });
  }

  const model = MODELS[q.get('model')];
  const id = q.get('r');
  const run = String(Number(q.get('run')) || 1);
  if (!model || !RECEIPTS[id]) return out({ error: 'Pick model=haiku|sonnet and r=' + Object.keys(RECEIPTS).join('|') }, 400);
  const spent = (await store.get('spent', { type: 'json' })) || 0;
  if (spent >= CREDIT_CAP) return out({ error: `Credit cap of ${CREDIT_CAP} reached`, spent }, 429);

  const res = await scanReceipt({ imageBase64: RECEIPTS[id], model });
  await store.setJSON('spent', spent + (res.credits || 0));
  const result = { model: q.get('model'), r: id, run, ...res, score: res.receipt ? score(TRUTH[id], res.receipt) : null };
  await store.setJSON(`r/${q.get('model')}/${id}/${run}`, result);
  if (res.error) return out({ r: id, model: q.get('model'), error: res.error, ms: res.ms }, 502);
  const s = result.score;
  return out({ r: id, model: q.get('model'), run, items: `${s.items_correct}/${s.items_truth}`, extras: s.extras, reconcile: s.reconcile,
    total_ok: s.total_ok, card_charge_ok: s.card_charge_ok, gratuity_ok: s.gratuity_ok,
    credits: res.credits, seconds: Math.round(res.ms / 100) / 10, missed: s.missed, extra_items: s.extra_items, flags: (res.receipt.flags || []).slice(0, 4) });
};

export const config = { path: '/api/eval' };
