// In-memory stand-in for Netlify Blobs, with the same conditional writes.
export function fakeStore() {
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
    raw: (key) => JSON.parse(m.get(key).body),
  };
}
