import { readReceipt } from '../lib/read-receipt.mjs';
import { HttpError } from '../lib/core.mjs';
import { tabStore } from '../lib/store.mjs';

// Monthly ceiling for receipt reading, in Netlify credits. Change it with the
// SCAN_CREDIT_CAP environment variable.
const DEFAULT_CAP = 30;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req, context) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body;
    try { body = JSON.parse(await req.text()); } catch { return json({ error: 'Bad request' }, 400); }
    const cap = Number(process.env.SCAN_CREDIT_CAP) > 0 ? Number(process.env.SCAN_CREDIT_CAP) : DEFAULT_CAP;
    const out = await readReceipt({ imageBase64: body.image, mediaType: 'image/jpeg', store: tabStore(context), cap });
    return json(out);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Couldn’t read that receipt. Try again, or type the items.' }, 500);
  }
};

export const config = { path: '/api/scan' };
