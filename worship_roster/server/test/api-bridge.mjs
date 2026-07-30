/* Test-only HTTP bridge: runs the real Worker (src/index.js) over an in-memory
 * SQLite D1 adapter so a browser can exercise the full cloud stack end-to-end.
 * NOT for production — production is Cloudflare Workers + D1.
 *
 * Usage: node --experimental-sqlite server/test/api-bridge.mjs <port> <allowedOrigin>
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8155);
const allowedOrigin = process.argv[3] || 'http://localhost:8154';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));
const wrap = (sql) => ({
  _sql: sql, _args: [],
  bind(...a) { this._args = a; return this; },
  first() { return db.prepare(this._sql).get(...this._args) ?? null; },
  all() { return { results: db.prepare(this._sql).all(...this._args) }; },
  run() { return { success: true, meta: db.prepare(this._sql).run(...this._args) }; },
});
const env = {
  DB: { prepare: (s) => wrap(s), batch: async (stmts) => stmts.map((s) => s.run()) },
  ALLOWED_ORIGINS: allowedOrigin,
  VAPID_PUBLIC_KEY: 'BtestPublicKey', VAPID_SUBJECT: 'mailto:test@example.com',
};

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    // Only attach a body for methods that actually carry one (never OPTIONS/GET/HEAD).
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && body.length > 0;
    const request = new Request('http://api.local' + req.url, {
      method: req.method, headers, body: hasBody ? body : undefined,
    });
    const out = await worker.fetch(request, env);
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'bridge: ' + (e && e.message) }));
  }
}).listen(port, () => console.log('api-bridge on ' + port + ' (allow ' + allowedOrigin + ')'));
