/* Reproduces the user's report: "the YouTube link is removed once a song is
 * edited." Runs the REAL client (js/api.js) against the REAL Worker over an
 * in-memory SQLite D1 adapter — the same stack the phone uses, minus network.
 *
 * Run:  node --experimental-sqlite server/test/repro-link-edit.mjs
 */
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
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
  ALLOWED_ORIGINS: 'http://localhost', VAPID_PUBLIC_KEY: 'B', VAPID_SUBJECT: 'mailto:t@t.t',
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { ROSTER_CONFIG: { apiBase: 'http://api.local', vapidPublicKey: '' } };
globalThis.fetch = async (url, init = {}) =>
  worker.fetch(new Request(url, { method: init.method || 'GET', headers: init.headers || {}, body: init.body }), env);

const apiSrc = readFileSync(join(here, '..', '..', 'js', 'api.js'), 'utf8');
vm.runInThisContext(apiSrc, { filename: 'api.js' });
const API = globalThis.window.RosterAPI;

// Mirror the app's own normalizeLink so we test what the Edit modal actually sends.
function normalizeLink(v) {
  let t = (v || '').trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return '';
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(t) ? t : '';
}

const link = (songs, id) => songs.find((s) => s.id === id).link;

await API.createTeam('Repro Team', 'Leader');

console.log('Reproducing: edit a song and check the listening link survives\n');

// Case A: full https:// YouTube link, edit the TITLE only (link field prefilled).
let a = await API.addSong('2026-07-05', 'Waymaker', 'E', normalizeLink('https://youtu.be/abc123'));
let songs = (await API.getState()).songs;
assert.equal(link(songs, a.id), 'https://youtu.be/abc123');
console.log('  A. added with https link  ->', link(songs, a.id));
await API.editSong(a.id, { title: 'Way Maker', key: 'E', link: normalizeLink('https://youtu.be/abc123') });
songs = (await API.getState()).songs;
assert.equal(link(songs, a.id), 'https://youtu.be/abc123', 'link must survive a title edit');
console.log('  A. after editing title    ->', link(songs, a.id), ' ✓ kept\n');

// Case B: user types a BARE link with no scheme (the bug we fixed).
let b = await API.addSong('2026-07-05', 'Goodness of God', 'C', normalizeLink('youtu.be/xyz789'));
songs = (await API.getState()).songs;
assert.equal(link(songs, b.id), 'https://youtu.be/xyz789', 'bare link gets https:// added, not dropped');
console.log('  B. added bare "youtu.be/xyz789" ->', link(songs, b.id));
await API.editSong(b.id, { title: 'The Goodness of God', key: 'C', link: normalizeLink('youtu.be/xyz789') });
songs = (await API.getState()).songs;
assert.equal(link(songs, b.id), 'https://youtu.be/xyz789', 'bare link survives edit');
console.log('  B. after editing title          ->', link(songs, b.id), ' ✓ kept\n');

// Case C: a genuinely dangerous scheme is still blocked (security preserved).
let c = await API.addSong('2026-07-05', 'Test', 'G', normalizeLink('javascript:alert(1)'));
songs = (await API.getState()).songs;
assert.equal(link(songs, c.id), '', 'javascript: link rejected');
console.log('  C. "javascript:alert(1)"        ->', JSON.stringify(link(songs, c.id)), ' ✓ blocked\n');

console.log('All good — links are preserved through edits; dangerous schemes stay blocked.');
