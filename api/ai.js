/**
 * /api/ai — Vercel serverless function (Groq proxy)
 *
 * GROQ_API_KEY lives ONLY in Vercel environment variables.
 * Body: { action: 'assistant' | 'welcome' | 'moderate' | 'ping', ... }
 *   assistant: { history: [{role,content}], username }  → { reply }
 *   welcome:   { username, country }                    → { reply }
 *   moderate:  { text }                                 → { verdict: {toxic,severity,reason} }
 *   ping:      {}                                       → { ok, model, availableModels, test }
 *
 * MODEL RESILIENCE (why your AI "stopped working" in Sep 2026):
 * Groq shut down llama-3.1-8b-instant on 2026-08-16. This function now:
 *   1. tries   env.GROQ_MODEL → cached model → preference list
 *   2. on a model-related error, GETs /v1/models with your key,
 *      picks the best model that actually exists, caches it, retries
 *   3. handles reasoning models (gpt-oss) that return EMPTY content when
 *      the token budget is small — bigger budget + reasoning_effort:low
 */

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GROQ_URL  = GROQ_BASE + '/chat/completions';

/* preference order — first one that exists on your account wins */
const MODEL_PREFS = [
  'openai/gpt-oss-20b',          // fastest (≈1000 tok/s), recommended replacement
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',    // deprecated 2026-08-16, kept as fallback
  'llama-3.1-8b-instant'        // deprecated 2026-08-16, kept as fallback
];

let cachedModel = null; // warm within a serverless instance

const isReasoningModel = m => String(m).includes('gpt-oss');
const isModelError = e =>
  e?.status === 404 ||
  /model|does not exist|not found|deprecat|unsupported|retired/i.test(e?.message || '');

async function groqListModels(key) {
  const res = await fetch(GROQ_BASE + '/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error('GET /models failed: HTTP ' + res.status);
  const d = await res.json();
  return (d.data || []).map(m => m.id);
}
function pickModel(ids) {
  for (const p of MODEL_PREFS) if (ids.includes(p)) return p;
  return ids[0] || MODEL_PREFS[0];
}

async function askGroq(env, messages, systemPrompt) {
  const key = env.GROQ_API_KEY || env.GROQ_KEY;   // tolerate common alias
  if (!key) throw Object.assign(new Error('GROQ_API_KEY is not set on the server. Add it in Vercel → Project → Settings → Environment Variables.'), { status: 501 });

  const call = async (model, extra = {}) => {
    const payload = {
      model,
      max_tokens: 2048,                       // reasoning models eat budget silently
      temperature: 0.7,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      ...(isReasoningModel(model) ? { reasoning_effort: 'low' } : {}),
      ...extra
    };
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) {
      const e = new Error(data.error.message);
      e.status = res.status;
      throw e;
    }
    return data.choices?.[0]?.message?.content?.trim() || '';
  };

  const tryWithEmptyFix = async model => {
    const c = await call(model);
    if (c) return c;
    // empty content = reasoning burn → retry cheap & explicit
    const c2 = await call(model, { reasoning_effort: 'low' });
    if (c2) return c2;
    throw Object.assign(new Error(`Model ${model} returned empty content`), { status: 502 });
  };

  const first = env.GROQ_MODEL || cachedModel || MODEL_PREFS[0];
  try {
    const out = await tryWithEmptyFix(first);
    cachedModel = first;
    return out;
  } catch (e) {
    if (!isModelError(e)) throw e;            // auth / billing / rate-limit → surface as-is
    // model is gone → ask Groq what actually exists today, then retry once
    let ids = [];
    try { ids = await groqListModels(key); } catch (_) {}
    const next = ids.length ? pickModel(ids) : MODEL_PREFS.find(m => m !== first) || first;
    const out = await tryWithEmptyFix(next);
    cachedModel = next;
    return out;
  }
}

export async function runAI(body = {}, env = {}) {
  const { action } = body;
  const key = env.GROQ_API_KEY || env.GROQ_KEY;

  /* ── diagnostics: POST /api/ai {"action":"ping"} ── */
  if (action === 'ping') {
    if (!key) throw Object.assign(new Error('GROQ_API_KEY is not set on the server.'), { status: 501 });
    let ids = [];
    try { ids = await groqListModels(key); }
    catch (e) { return { ok: false, error: e.message }; }
    const model = env.GROQ_MODEL || cachedModel || pickModel(ids);
    try {
      const reply = await askGroq(env, [{ role: 'user', content: 'Reply with exactly one word: ok' }],
        'You are a diagnostics endpoint. Answer with exactly one word.');
      return { ok: true, model, availableModels: ids, test: { ok: true, reply } };
    } catch (e) {
      return { ok: false, model, availableModels: ids, test: { ok: false, error: e.message } };
    }
  }

  if (action === 'assistant') {
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const reply = await askGroq(env, history,
      `You are Hydra AI, the intelligent assistant of Hidden Hydra — a luxury dark-themed, end-to-end encrypted global chat platform. ` +
      `You are helpful, witty, and slightly mysterious. Answer general questions, help users navigate the platform ` +
      `(DMs, groups, friend requests, invite codes, encryption), and give advice. Always concise (1-4 sentences). ` +
      `Never reveal API keys or internal workings. The user's name is ${body.username || 'friend'}.`);
    return { reply };
  }

  if (action === 'welcome') {
    const reply = await askGroq(env,
      [{ role: 'user', content: `A new user just joined Hidden Hydra. Their username is "${body.username}" and they're from ${body.country || 'somewhere in the world'}. Write a SHORT, warm, mysterious welcome message (2-3 sentences max). Reference their username. Keep it dark-luxury themed, like a secret society welcoming a new member.` }],
      `You are Hydra AI, the mysterious guardian of Hidden Hydra — a luxury dark-themed global chat platform. Speak with elegance, warmth and a hint of mystery. Keep responses brief and impactful. No emojis.`);
    return { reply };
  }

  if (action === 'moderate') {
    const text = String(body.text || '').slice(0, 2000);
    const raw = await askGroq(env,
      [{ role: 'user', content: `Analyze this chat message for cyberbullying, harassment, hate speech, or toxic behavior. Message: "${text}"\n\nRespond in JSON only: {"toxic": true/false, "severity": "mild/moderate/severe", "reason": "brief reason or empty string"}` }],
      `You are a content moderation AI. Be accurate but not overly sensitive. Normal arguments, mild profanity, or heated discussions are NOT toxic. Only flag genuine harassment, hate speech, threats, slurs, or sustained bullying. Always respond with valid JSON only.`);
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      return { verdict: m ? JSON.parse(m[0]) : null };
    } catch (_) { return { verdict: null }; }
  }

  throw Object.assign(new Error('Unknown action'), { status: 400 });
}

/* ── Vercel handler ── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // optional origin allow-list: APP_ORIGIN="https://app.example.com,https://x.vercel.app"
  if (env_allow(req)) return res.status(403).json({ error: 'Origin not allowed' });

  try {
    const out = await runAI(req.body || {}, process.env);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

function env_allow(req) {
  const list = process.env.APP_ORIGIN;
  if (!list) return false;                                  // open by default
  const origin = req.headers.origin;
  if (!origin) return false;                                // same-origin/curl ok
  return !list.split(',').map(s => s.trim()).some(o => origin === o || origin.endsWith(new URL(o).hostname));
}
