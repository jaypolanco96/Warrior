// Temporary local server for checking changes before a push. Serves public/ and runs api/*.js like Vercel does.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = join(import.meta.dirname, '..'), PUB = join(ROOT, 'public'), PORT = 5199;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, ''), mod = await import(pathToFileURL(join(ROOT, 'api', `${name}.js`)).href);
      let raw = ''; for await (const chunk of req) raw += chunk;
      req.query = Object.fromEntries(url.searchParams); try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
      res.status = (code) => { res.statusCode = code; return res; }; res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; }; res.send = (o) => { res.end(typeof o === 'string' ? o : JSON.stringify(o)); return res; };
      await mod.default(req, res); return;
    }
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname), file = join(PUB, rel); if (!file.startsWith(PUB)) throw new Error('outside');
    const data = await readFile(file); res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); res.end(data);
  } catch (e) { if (!res.headersSent) res.statusCode = url.pathname.startsWith('/api/') ? 500 : 404; res.end(String(e.message)); }
}).listen(PORT, '127.0.0.1', () => console.log(`local Warrior on http://127.0.0.1:${PORT}`));
