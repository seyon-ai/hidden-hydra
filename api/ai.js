/**
 * /api/ai — Vercel serverless function (Groq proxy)
 *
 * GROQ_API_KEY lives ONLY in Vercel environment variables.
 * Body: { action: 'assistant' | 'welcome' | 'moderate', ... }
 *   assistant: { history: [{role,content}], username }  → { reply }
 *   welcome:   { username, country }                    → { reply }
 *   moderate:  { text }                                 → { verdict: {toxic,severity,reason} }
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function askGroq(env, messages, systemPrompt) {
  const key = env.GROQ_API_KEY;
  if (!key) throw Object.assign(new Error('GROQ_API_KEY is not set on the server. Add it in Vercel → Project → Settings → Environment Variables.'), { status: 501 });
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.1-8b-instant',
      max_tokens: 512,
      temperature: 0.7,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export async function runAI(body = {}, env = {}) {
  const { action } = body;

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
