/**
 * /api/upload — Vercel serverless function (imgbb proxy)
 *
 * IMGBB_API_KEY lives ONLY in Vercel environment variables.
 * Body: { image: "<base64 jpeg>", name?: "optional" }  → { url }
 * Clients compress images on-device first (max ~1600px, JPEG q0.82).
 */

export async function runUpload(body = {}, env = {}) {
  const key = env.IMGBB_API_KEY || env.IMGBB_KEY;   // tolerate common alias
  if (!key) throw Object.assign(new Error('IMGBB_API_KEY is not set on the server. Add it in Vercel → Project → Settings → Environment Variables.'), { status: 501 });

  const b64 = String(body.image || '');
  if (!b64 || b64.length > 4_200_000) throw Object.assign(new Error('Image missing or too large (max ~3 MB after compression)'), { status: 413 });

  const form = new URLSearchParams();
  form.append('key', key);
  form.append('image', b64);
  if (body.name) form.append('name', String(body.name).slice(0, 60));

  const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!data?.data?.url) throw new Error(data?.error?.message || 'imgbb upload failed');
  return { url: data.data.url, display: data.data.display_url || data.data.url };
}

/* ── Vercel handler ── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const out = await runUpload(req.body || {}, process.env);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
