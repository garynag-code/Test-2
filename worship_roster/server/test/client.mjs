/* Verifies the real front-end API client (worship_roster/js/api.js) against the
 * real Worker, by stubbing the browser globals it relies on (window,
 * localStorage, fetch) and routing fetch to worker.fetch over an in-memory
 * SQLite D1 adapter. This exercises the exact request-building / response-
 * handling code the browser runs, without needing a browser or the network.
 *
 * Run:  node --experimental-sqlite server/test/client.mjs
 */
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

// ---- Real Worker over in-memory SQLite -------------------------------------
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

// ---- Browser global stubs ---------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { ROSTER_CONFIG: { apiBase: 'http://api.local', vapidPublicKey: '' } };
globalThis.fetch = async (url, init = {}) => {
  const request = new Request(url, {
    method: init.method || 'GET',
    headers: init.headers || {},
    body: init.body,
  });
  return worker.fetch(request, env);
};

// Load the REAL client file into this context (it is a browser IIFE).
const apiSrc = readFileSync(join(here, '..', '..', 'js', 'api.js'), 'utf8');
vm.runInThisContext(apiSrc, { filename: 'api.js' });
const API = globalThis.window.RosterAPI;

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓', name); }

console.log('Front-end API client against the real Worker');

let invite;
await test('client.configured() reflects config', () => {
  assert.equal(API.configured(), true);
  assert.equal(API.hasSession(), false);
});

await test('createTeam stores the session token', async () => {
  const d = await API.createTeam('Grace Worship', 'Naomi');
  assert.ok(d.deviceToken && d.inviteCode);
  invite = d.inviteCode;
  assert.equal(API.hasSession(), true, 'token persisted to localStorage');
  assert.equal(API.team().role, 'leader');
});

await test('getState returns every field the UI mapping needs', async () => {
  const s = await API.getState();
  for (const key of ['team', 'me', 'members', 'assignments', 'votes', 'locks', 'songs']) {
    assert.ok(key in s, 'missing ' + key);
  }
  assert.equal(s.members.length, 1);
  assert.equal(s.me.isLeader, true);
});

await test('vote then lock round-trips (1 member => majority of 1)', async () => {
  await API.vote('2026-07', 'weekday', '2026-07-02');
  let s = await API.getState();
  assert.equal(s.votes.length, 1);
  assert.equal(s.votes[0].date, '2026-07-02');

  const locked = await API.lock('2026-07', 'weekday');
  assert.equal(locked.lockedDate, '2026-07-02');
  s = await API.getState();
  assert.equal(s.locks.length, 1);
  assert.equal(s.locks[0].locked_date, '2026-07-02');
});

await test('voting a locked block is refused (client surfaces the error)', async () => {
  await assert.rejects(() => API.vote('2026-07', 'weekday', '2026-07-09'), /locked|new vote/i);
});

await test('new vote clears the lock, re-enabling voting', async () => {
  await API.newVote('2026-07', 'weekday');
  const s = await API.getState();
  assert.equal(s.locks.length, 0);
  assert.equal(s.votes.length, 0);
});

await test('addSong then deleteSong via the client', async () => {
  const added = await API.addSong('2026-07', 'Great Are You Lord', 'A');
  let s = await API.getState();
  assert.equal(s.songs.length, 1);
  assert.equal(s.songs[0].title, 'Great Are You Lord');
  await API.deleteSong(added.id);
  s = await API.getState();
  assert.equal(s.songs.length, 0);
});

await test('joinTeam with the invite code switches the session', async () => {
  const d = await API.joinTeam(invite, 'David');
  assert.equal(d.role, 'member');
  const s = await API.getState();
  assert.equal(s.me.isLeader, false, 'joined as a non-leader');
  assert.equal(s.members.length, 2, 'team now has leader + David');
});

await test('a member cannot lock (server rejects, client throws)', async () => {
  await API.vote('2026-08', 'weekday', '2026-08-04');
  await assert.rejects(() => API.lock('2026-08', 'weekday'), /admin/i);
});

console.log(`\n${passed} tests passed.`);
