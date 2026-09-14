/**
 * api.js — client bridge to the Vercel serverless functions in /api
 * Secrets (GROQ_API_KEY, IMGBB_API_KEY) live ONLY in Vercel env vars;
 * the browser never sees them. Local dev: `node dev-server.mjs` emulates /api.
 */

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = data?.error || ('Service unavailable (' + res.status + ')');
    throw new Error(msg);
  }
  return data;
}

/* ── AI (Groq, proxied server-side) ── */
export const aiChat     = (history, username) => post('/api/ai', { action: 'assistant', history, username }).then(d => d.reply || '');
export const aiWelcome  = (username, country) => post('/api/ai', { action: 'welcome', username, country }).then(d => d.reply || '');
export const aiModerate = (text)              => post('/api/ai', { action: 'moderate', text }).then(d => d.verdict || null);

/* ── image upload (imgbb, proxied server-side) ── */
export async function uploadImage(source) {
  const dataUrl = typeof source === 'string' ? source : await compressImage(source);
  const base64 = dataUrl.split(',')[1];
  const d = await post('/api/upload', { image: base64 });
  return d.url;
}

/** downscale + re-encode an image File/Blob to a compact JPEG dataURL */
export function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Not a valid image'));
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0c0c18';           // flatten transparency for JPEG
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
