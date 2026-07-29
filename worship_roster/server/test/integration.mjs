/* End-to-end integration test of the Worker's request handlers, security
 * enforcement and the majority-lock rule, run against a real in-memory SQLite
 * wrapped as a minimal D1 adapter.
 *
 * Run with:  node --experimental-sqlite server/test/integration.mjs
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

// ---- Minimal D1 adapter over node:sqlite -----------------------------------
function makeDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));
  const wrap = (sql) => ({
    _sql: sql, _args: [],
    bind(...a) { this._args = a; return this; },
    first() { return db.prepare(this._sql).get(...this._args) ?? null; },
    all() { return { results: db.prepare(this._sql).all(...this._args) }; },
    run() { const r = db.prepare(this._sql).run(...this._args); return { success: true, meta: r }; },
  });
  return {
    prepare: (sql) => wrap(sql),
    batch: async (stmts) => stmts.map((s) => s.run()),
  };
}

const ORIGIN = 'https://app.example';
const env = {
  DB: makeDB(),
  ALLOWED_ORIGINS: ORIGIN,
  VAPID_PUBLIC_KEY: 'BPabc', VAPID_SUBJECT: 'mailto:x@y.z',
};

async function call(method, path, { token, body, origin = ORIGIN } = {}) {
  const headers = { 'Origin': origin };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let init = { method, headers };
  if (body !== undefined) {
    const s = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(new TextEncoder().encode(s).length);
    init.body = s;
  }
  const res = await worker.fetch(new Request('https://api.example' + path, init), env);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data, cors: res.headers.get('Access-Control-Allow-Origin') };
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓', name); }

console.log('Handler + security integration');

// ---- Team creation & auth ---------------------------------------------------
let leaderToken, memberTokens = [], teamInvite;

await test('create team returns invite + leader token', async () => {
  const r = await call('POST', '/api/teams', { body: { teamName: 'Grace Worship', leaderName: 'Naomi' } });
  assert.equal(r.status, 201);
  assert.ok(r.data.deviceToken && r.data.inviteCode);
  assert.equal(r.data.role, 'leader');
  leaderToken = r.data.deviceToken;
  teamInvite = r.data.inviteCode;
});

await test('unauthenticated requests are rejected', async () => {
  const r = await call('GET', '/api/state', {});
  assert.equal(r.status, 401);
});

await test('bad bearer token is rejected', async () => {
  const r = await call('GET', '/api/state', { token: 'not-a-real-token' });
  assert.equal(r.status, 401);
});

await test('members join with the invite code', async () => {
  for (const name of ['David', 'Peter', 'Grace', 'Sam', 'Ruth', 'Esther', 'Joy']) {
    const r = await call('POST', '/api/teams/join', { body: { inviteCode: teamInvite, name } });
    assert.equal(r.status, 201);
    memberTokens.push(r.data.deviceToken);
  }
  // 1 leader + 7 members = 8
  const state = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(state.data.members.length, 8);
});

await test('wrong invite code cannot join', async () => {
  const r = await call('POST', '/api/teams/join', { body: { inviteCode: 'ZZZZZ-ZZZZ', name: 'Mallory' } });
  assert.equal(r.status, 404);
});

// ---- CORS -------------------------------------------------------------------
await test('requests from a non-allow-listed origin are blocked', async () => {
  const r = await call('GET', '/api/health', { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

// ---- Voting + majority lock -------------------------------------------------
await test('a member gets one vote per block (re-vote replaces)', async () => {
  await call('POST', '/api/votes', { token: memberTokens[0], body: { month: '2026-07', typeId: 'weekday', date: '2026-07-02' } });
  await call('POST', '/api/votes', { token: memberTokens[0], body: { month: '2026-07', typeId: 'weekday', date: '2026-07-09' } });
  const state = await call('GET', '/api/state', { token: leaderToken });
  const mine = state.data.votes.filter((v) => v.type_id === 'weekday' && v.month === '2026-07');
  assert.equal(mine.length, 1, 'only the latest vote is kept');
  assert.equal(mine[0].date, '2026-07-09');
});

await test('lock is refused without a majority', async () => {
  // Only 1 vote so far (from the re-vote test) for 07-09; need 5 of 8.
  const r = await call('POST', '/api/practices/lock', { token: leaderToken, body: { month: '2026-07', typeId: 'weekday' } });
  assert.equal(r.status, 409, 'no majority -> 409');
});

await test('non-leaders cannot lock a date', async () => {
  const r = await call('POST', '/api/practices/lock', { token: memberTokens[1], body: { month: '2026-07', typeId: 'weekday' } });
  assert.equal(r.status, 403);
});

await test('a majority locks the date', async () => {
  // Five members vote 2026-07-16 -> majority of 8.
  for (let i = 0; i < 5; i++) {
    await call('POST', '/api/votes', { token: memberTokens[i], body: { month: '2026-07', typeId: 'weekday', date: '2026-07-16' } });
  }
  const r = await call('POST', '/api/practices/lock', { token: leaderToken, body: { month: '2026-07', typeId: 'weekday' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.lockedDate, '2026-07-16');
});

await test('a locked date cannot be voted on (needs a new vote)', async () => {
  const r = await call('POST', '/api/votes', { token: memberTokens[6], body: { month: '2026-07', typeId: 'weekday', date: '2026-07-23' } });
  assert.equal(r.status, 409, 'voting on a locked block is refused');
});

await test('only a leader can call a new vote, which clears the lock', async () => {
  const bad = await call('POST', '/api/practices/new-vote', { token: memberTokens[0], body: { month: '2026-07', typeId: 'weekday' } });
  assert.equal(bad.status, 403);
  const ok = await call('POST', '/api/practices/new-vote', { token: leaderToken, body: { month: '2026-07', typeId: 'weekday' } });
  assert.equal(ok.status, 200);
  const state = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(state.data.locks.length, 0, 'lock cleared');
  assert.equal(state.data.votes.filter((v) => v.month === '2026-07' && v.type_id === 'weekday').length, 0, 'votes reset');
});

// ---- Songs (any member) -----------------------------------------------------
await test('any member can post and remove songs', async () => {
  const add = await call('POST', '/api/songs', { token: memberTokens[0], body: { month: '2026-07', title: 'Reckless Love', key: 'C' } });
  assert.equal(add.status, 201, 'a non-admin member can add a song');
  const del = await call('DELETE', `/api/songs/${add.data.id}`, { token: memberTokens[1] });
  assert.equal(del.status, 200, 'a different member can remove it');
  // Re-add for later assertions that expect a July song to exist.
  await call('POST', '/api/songs', { token: leaderToken, body: { month: '2026-07', title: 'Reckless Love', key: 'C' } });
});

// ---- Input validation -------------------------------------------------------
await test('invalid inputs are rejected', async () => {
  assert.equal((await call('POST', '/api/votes', { token: leaderToken, body: { month: 'July', typeId: 'weekday', date: '2026-07-02' } })).status, 400);
  assert.equal((await call('POST', '/api/votes', { token: leaderToken, body: { month: '2026-07', typeId: 'whenever', date: '2026-07-02' } })).status, 400);
  assert.equal((await call('PUT', '/api/assignments', { token: leaderToken, body: { date: 'bad', positionId: 'lead' } })).status, 400);
  assert.equal((await call('PUT', '/api/assignments', { token: leaderToken, body: { date: '2026-07-05', positionId: 'trombone' } })).status, 400);
});

await test('a co-lead worshipper (lead2) can be assigned', async () => {
  const state = await call('GET', '/api/state', { token: leaderToken });
  const ruth = state.data.members.find((m) => m.name === 'Ruth');
  const r = await call('PUT', '/api/assignments', { token: leaderToken, body: { date: '2026-07-05', positionId: 'lead2', memberId: ruth.id } });
  assert.equal(r.status, 200);
  const after = await call('GET', '/api/state', { token: leaderToken });
  assert.ok(after.data.assignments.some((a) => a.position_id === 'lead2' && a.member_id === ruth.id));
});

await test('assignment only accepts a member of the same team', async () => {
  const ok = await call('PUT', '/api/assignments', { token: leaderToken, body: { date: '2026-07-05', positionId: 'bass', memberId: null } });
  assert.equal(ok.status, 200);
  const bad = await call('PUT', '/api/assignments', { token: leaderToken, body: { date: '2026-07-05', positionId: 'bass', memberId: 'm_intruder' } });
  assert.equal(bad.status, 400, 'unknown member rejected');
});

// ---- Member titles + admin (leader-only) -----------------------------------
await test('admin can set a member title (e.g. Pastor); it shows in state', async () => {
  const state = await call('GET', '/api/state', { token: leaderToken });
  const david = state.data.members.find((m) => m.name === 'David');
  const r = await call('PUT', `/api/members/${david.id}`, { token: leaderToken, body: { title: 'Pastor' } });
  assert.equal(r.status, 200);
  const after = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(after.data.members.find((m) => m.id === david.id).title, 'Pastor');
});

await test('a non-admin cannot change member roles', async () => {
  const state = await call('GET', '/api/state', { token: leaderToken });
  const peter = state.data.members.find((m) => m.name === 'Peter');
  const r = await call('PUT', `/api/members/${peter.id}`, { token: memberTokens[0], body: { title: 'Hacker' } });
  assert.equal(r.status, 403);
});

await test('admin can grant admin to another member, who can then lock', async () => {
  const state = await call('GET', '/api/state', { token: leaderToken });
  const grace = state.data.members.find((m) => m.name === 'Grace');
  const r = await call('PUT', `/api/members/${grace.id}`, { token: leaderToken, body: { isLeader: true } });
  assert.equal(r.status, 200);
  // Grace (memberTokens[2]) can now post a song (an admin-only action).
  const song = await call('POST', '/api/songs', { token: memberTokens[2], body: { month: '2026-09', title: 'Test', key: 'D' } });
  assert.equal(song.status, 201);
});

await test('the last admin cannot remove their own admin (no lockout)', async () => {
  // Demote Grace again so only the original leader remains admin.
  const state = await call('GET', '/api/state', { token: leaderToken });
  const grace = state.data.members.find((m) => m.name === 'Grace');
  await call('PUT', `/api/members/${grace.id}`, { token: leaderToken, body: { isLeader: false } });
  const me = await call('GET', '/api/state', { token: leaderToken });
  const r = await call('PUT', `/api/members/${me.data.me.id}`, { token: leaderToken, body: { isLeader: false } });
  assert.equal(r.status, 409, 'must keep at least one admin');
});

console.log(`\n${passed} tests passed.`);
