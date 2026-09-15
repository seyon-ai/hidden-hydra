/**
 * dev-server.mjs — local development server (NOT used on Vercel)
 *
 *   node dev-server.mjs          → http://localhost:3000
 *
 * Serves the static site AND emulates the two Vercel serverless functions
 * (/api/ai, /api/upload) using secrets from .env in this folder.
 * On Vercel the real functions in /api run instead — same code paths.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAI } from './api/ai.js';
import { runUpload } from './api/upload.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

/* load .env */
const env = { ...process.env };
if (existsSync(path.join(ROOT, '.env'))) {
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);

  /* API emulation */
  if (p === '/api/health' || p === '/api/health.js') {
    return json(res, 200, {
      ok: true, service: 'hidden-hydra-api (local dev)', node: process.version,
      now: new Date().toISOString(),
      env: {
        GROQ_API_KEY: !!env.GROQ_API_KEY || !!env.GROQ_KEY,
        IMGBB_API_KEY: !!env.IMGBB_API_KEY || !!env.IMGBB_KEY,
        GROQ_MODEL: env.GROQ_MODEL || 'llama-3.1-8b-instant (default)',
        APP_ORIGIN: env.APP_ORIGIN ? 'set' : 'unset (open)'
      }
    });
  }
  if (p === '/api/ai' || p === '/api/ai.js') {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    try { return json(res, 200, await runAI(await readBody(req), env)); }
    catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (p === '/api/upload' || p === '/api/upload.js') {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    try { return json(res, 200, await runUpload(await readBody(req), env)); }
    catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }

  /* static files (with clean-URL + 404 fallback like Vercel) */
  if (p === '/') p = '/index.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    let st = await stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    if (!path.extname(file)) {
      const alt = file + '.html';
      if (existsSync(alt)) file = alt;
    }
    if (!existsSync(file)) file = path.join(ROOT, '404.html');
  }
  const ext = path.extname(file).toLowerCase();
  try {
    const data = await readFile(file);
    res.writeHead(ext === '.html' ? 200 : 200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  } catch { res.writeHead(500); res.end('server error'); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hidden Hydra dev server → http://localhost:${PORT}`);
  console.log(env.GROQ_API_KEY ? '• GROQ_API_KEY loaded' : '• GROQ_API_KEY missing (AI will report config error)');
  console.log(env.IMGBB_API_KEY ? '• IMGBB_API_KEY loaded' : '• IMGBB_API_KEY missing (uploads will report config error)');
});
