/**
 * /api/health — deployment diagnostic (GET)
 * Tells you whether the server can see your secrets, WITHOUT leaking them.
 *   curl https://your-app.vercel.app/api/health
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Cache-Control', 'no-store');
  const e = process.env;
  return res.status(200).json({
    ok: true,
    service: 'hidden-hydra-api',
    node: process.version,
    now: new Date().toISOString(),
    env: {
      GROQ_API_KEY:  !!(e.GROQ_API_KEY || e.GROQ_KEY),
      IMGBB_API_KEY: !!(e.IMGBB_API_KEY || e.IMGBB_KEY),
      GROQ_MODEL:    e.GROQ_MODEL || 'llama-3.1-8b-instant (default)',
      APP_ORIGIN:    e.APP_ORIGIN ? 'set' : 'unset (open)'
    },
    hint: 'If a key shows false here but you added it in Vercel: env vars only apply to NEW deployments — redeploy after adding them.'
  });
}
