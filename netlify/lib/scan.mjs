// Reads a receipt photo with Claude through Netlify AI Gateway.
// Netlify fills in ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY inside functions.

export const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5',
};

// USD per million tokens, from Netlify's AI pricing page (Oct 19, 2026).
const PRICE = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.12 },
  'claude-sonnet-5': { in: 2.00, out: 10.00, cacheRead: 0.20, cacheWrite: 2.50 },
};
const CREDITS_PER_USD = 180;

const SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: ['string', 'null'], description: 'Business name if printed, else null.' },
    items: {
      type: 'array',
      description: 'Only things ordered or bought. Never fees, surcharges, service charges, gratuity, tax or tip, even when printed among the items.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name as printed, without the leading quantity.' },
          quantity: { type: ['integer', 'null'], description: 'The leading count (e.g. "7 Ranch Water" is 7). 1 if none printed. null if hidden or unreadable.' },
          price: { type: 'number', description: 'The line total as printed (not the unit price).' },
        },
        required: ['name', 'quantity', 'price'],
      },
    },
    subtotal: { type: ['number', 'null'], description: 'Printed subtotal, or null if none is printed.' },
    fees: {
      type: 'array',
      description: 'Card fees, credit card surcharges, restaurant surcharges and similar.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          amount: { type: 'number' },
          listed_with_items: { type: 'boolean', description: 'True if printed among the items above the subtotal.' },
        },
        required: ['label', 'amount', 'listed_with_items'],
      },
    },
    gratuity: { type: ['number', 'null'], description: 'Automatic gratuity or service charge already added by the restaurant, else null.' },
    tax: { type: ['number', 'null'] },
    total: { type: ['number', 'null'], description: 'The printed total or amount line, before any tip written or printed below it.' },
    tip: { type: ['number', 'null'], description: 'A tip, printed or handwritten, if any. Not the automatic gratuity.' },
    tip_included_in_total: { type: ['boolean', 'null'], description: 'True if the total line already includes the tip.' },
    card_charge: { type: ['number', 'null'], description: 'What the card was finally charged, including any tip, if the receipt shows it. null if it cannot be known (for example, the check was printed before tipping).' },
    flags: { type: 'array', items: { type: 'string' }, description: 'Anything uncertain: hidden or unreadable parts, handwriting, a second receipt in the photo.' },
  },
  required: ['merchant', 'items', 'subtotal', 'fees', 'gratuity', 'tax', 'total', 'tip', 'tip_included_in_total', 'card_charge', 'flags'],
};

const INSTRUCTIONS = `Read this receipt photo and record it with the record_receipt tool.
Copy numbers exactly as printed; never calculate or correct them.
Names can wrap onto a second line, and a price can sit on the line above or below its name; pair each price with the item it belongs to.
If two receipts are in the photo, read only the one in front and flag the other.
If anything is hidden or unreadable, use null and add a flag rather than guessing.`;

export async function scanReceipt({ imageBase64, mediaType = 'image/jpeg', model, env = process.env, fetchImpl = fetch }) {
  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const started = Date.now();
  const res = await fetchImpl(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      tools: [{ name: 'record_receipt', description: 'Record what the receipt says.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'record_receipt' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: INSTRUCTIONS },
        ],
      }],
    }),
  });
  const ms = Date.now() - started;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (body.error && body.error.message) || `HTTP ${res.status}`, ms };
  const tool = (body.content || []).find((c) => c.type === 'tool_use');
  const usage = body.usage || {};
  return { receipt: tool ? tool.input : null, usage, credits: creditsFor(model, usage), ms, stop: body.stop_reason };
}

export function creditsFor(model, u) {
  const p = PRICE[model];
  if (!p) return null;
  const usd = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out +
    (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
  return Math.round(usd * CREDITS_PER_USD * 1000) / 1000;
}
