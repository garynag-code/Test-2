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
  const add = await call('POST', '/api/songs', { token: memberTokens[0], body: { month: '2026-07-05', title: 'Reckless Love', key: 'C' } });
  assert.equal(add.status, 201, 'a non-admin member can add a song');
  const del = await call('DELETE', `/api/songs/${add.data.id}`, { token: memberTokens[1] });
  assert.equal(del.status, 200, 'a different member can remove it');
  // Re-add for later assertions that expect a July song to exist.
  await call('POST', '/api/songs', { token: leaderToken, body: { month: '2026-07-05', title: 'Reckless Love', key: 'C' } });
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

await test('admin can change a member’s positions (and clear them)', async () => {
  const state = await call('GET', '/api/state', { token: leaderToken });
  const leaderId = state.data.me.id;
  // Set positions, then clear them (an admin with no position shows as "Administrator" in the UI).
  assert.equal((await call('PUT', `/api/members/${leaderId}`, { token: leaderToken, body: { positions: ['keys', 'bogus'] } })).status, 200);
  let after = await call('GET', '/api/state', { token: leaderToken });
  assert.deepEqual(after.data.members.find((m) => m.id === leaderId).positions, ['keys'], 'junk positions dropped');
  assert.equal((await call('PUT', `/api/members/${leaderId}`, { token: leaderToken, body: { positions: [] } })).status, 200);
  after = await call('GET', '/api/state', { token: leaderToken });
  assert.deepEqual(after.data.members.find((m) => m.id === leaderId).positions, [], 'positions cleared');
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
  const song = await call('POST', '/api/songs', { token: memberTokens[2], body: { month: '2026-09-06', title: 'Test', key: 'D' } });
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

// ---- Song chord PDFs --------------------------------------------------------
function rawPdfReq(id, token, body, name) {
  const u = 'https://api.example/api/songs/' + id + '/pdf' + (name ? '?name=' + encodeURIComponent(name) : '');
  return new Request(u, { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf' }, body });
}

await test('a member can attach a chord PDF and anyone can fetch it', async () => {
  const add = await call('POST', '/api/songs', { token: memberTokens[0], body: { month: '2026-10-04', title: 'PDF Song', key: 'G' } });
  const id = add.data.id;
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
  const up = await worker.fetch(rawPdfReq(id, memberTokens[0], pdf, 'chart.pdf'), env);
  assert.equal(up.status, 201);

  const st = await call('GET', '/api/state', { token: leaderToken });
  const song = st.data.songs.find((s) => s.id === id);
  assert.equal(song.hasPdf, true);
  assert.equal(song.pdfName, 'chart.pdf');

  const get = await worker.fetch(new Request('https://api.example/api/songs/' + id + '/pdf', { headers: { Origin: ORIGIN, Authorization: 'Bearer ' + leaderToken } }), env);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Content-Type'), 'application/pdf');
  const back = new Uint8Array(await get.arrayBuffer());
  assert.deepEqual([...back.slice(0, 4)], [0x25, 0x50, 0x44, 0x46], 'round-trips the %PDF bytes');

  // Deleting the song removes its PDF too.
  await call('DELETE', '/api/songs/' + id, { token: leaderToken });
  const gone = await worker.fetch(new Request('https://api.example/api/songs/' + id + '/pdf', { headers: { Origin: ORIGIN, Authorization: 'Bearer ' + leaderToken } }), env);
  assert.equal(gone.status, 404);
});

await test('non-PDF and oversized uploads are rejected', async () => {
  const add = await call('POST', '/api/songs', { token: leaderToken, body: { month: '2026-10-04', title: 'X', key: '' } });
  const id = add.data.id;
  const notPdf = new TextEncoder().encode('hello, definitely not a pdf');
  assert.equal((await worker.fetch(rawPdfReq(id, leaderToken, notPdf), env)).status, 400);
  const big = new Uint8Array(801 * 1024); big.set([0x25, 0x50, 0x44, 0x46]);
  assert.equal((await worker.fetch(rawPdfReq(id, leaderToken, big), env)).status, 413);
});

// ---- Song listening link + edit --------------------------------------------
await test('a song carries a listening link and can be edited; unsafe links stripped', async () => {
  const add = await call('POST', '/api/songs', { token: memberTokens[0], body: { month: '2026-11-01', title: 'Link Song', key: 'C', link: 'https://youtu.be/abc' } });
  assert.equal(add.status, 201);
  const id = add.data.id;
  let st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.songs.find((s) => s.id === id).link, 'https://youtu.be/abc');

  const ed = await call('PUT', '/api/songs/' + id, { token: memberTokens[1], body: { link: 'https://youtu.be/xyz' } });
  assert.equal(ed.status, 200);
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.songs.find((s) => s.id === id).link, 'https://youtu.be/xyz');

  await call('PUT', '/api/songs/' + id, { token: leaderToken, body: { link: 'javascript:alert(1)' } });
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.songs.find((s) => s.id === id).link, '', 'non-http(s) link is stripped');
});

// ---- Song library -----------------------------------------------------------
await test('library: any member can add, view, update and delete', async () => {
  const add = await call('POST', '/api/library', { token: memberTokens[0], body: { title: 'Goodness of God', artist: 'Bethel', lyrics: 'I love You Lord', chords: 'G  C  D', link: 'https://youtu.be/n0Y' } });
  assert.equal(add.status, 201);
  const id = add.data.id;

  let st = await call('GET', '/api/state', { token: memberTokens[2] });
  const item = st.data.library.find((l) => l.id === id);
  assert.ok(item, 'appears in state for any member');
  assert.equal(item.artist, 'Bethel');
  assert.equal(item.chords, 'G  C  D');
  assert.equal(item.link, 'https://youtu.be/n0Y');

  const up = await call('PUT', '/api/library/' + id, { token: memberTokens[1], body: { lyrics: 'Updated lyrics' } });
  assert.equal(up.status, 200);
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.library.find((l) => l.id === id).lyrics, 'Updated lyrics');

  const del = await call('DELETE', '/api/library/' + id, { token: memberTokens[0] });
  assert.equal(del.status, 200);
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.library.find((l) => l.id === id), undefined);
});

await test('library requires a title', async () => {
  assert.equal((await call('POST', '/api/library', { token: leaderToken, body: { lyrics: 'no title' } })).status, 400);
});

// ---- Devotionals ------------------------------------------------------------
await test('devotionals: any member can add (with author), view, edit, delete', async () => {
  const add = await call('POST', '/api/devotionals', { token: memberTokens[0], body: { title: 'Walking in Faith', link: 'https://youtu.be/dev', scripture: 'Proverbs 3:5-6', application: 'Trust God this week', prayer: 'Lord, help me trust You.' } });
  assert.equal(add.status, 201);
  const id = add.data.id;

  let st = await call('GET', '/api/state', { token: memberTokens[2] });
  const item = st.data.devotionals.find((x) => x.id === id);
  assert.ok(item, 'visible to all members');
  assert.equal(item.scripture, 'Proverbs 3:5-6');
  assert.equal(item.application, 'Trust God this week');
  assert.equal(item.prayer, 'Lord, help me trust You.');
  assert.equal(item.author, 'David', 'stamped with the author name');
  assert.equal(item.link, 'https://youtu.be/dev');

  const up = await call('PUT', '/api/devotionals/' + id, { token: memberTokens[1], body: { prayer: 'Updated prayer' } });
  assert.equal(up.status, 200);
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.devotionals.find((x) => x.id === id).prayer, 'Updated prayer');

  assert.equal((await call('DELETE', '/api/devotionals/' + id, { token: memberTokens[0] })).status, 200);
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.devotionals.find((x) => x.id === id), undefined);
});

await test('a devotional requires a title', async () => {
  assert.equal((await call('POST', '/api/devotionals', { token: leaderToken, body: { prayer: 'no title' } })).status, 400);
});

await test('a devotional with a long (>60 char) title still saves', async () => {
  const title = 'Trusting God When Life Gets Hard: Lessons on Faith, Patience and Perseverance';
  assert.ok(title.length > 60);
  const add = await call('POST', '/api/devotionals', { token: memberTokens[0], body: { title, application: 'Live it out.' } });
  assert.equal(add.status, 201, 'long title accepted');
  const st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.devotionals.find((x) => x.id === add.data.id).title, title, 'full title stored');
});

// ---- Spiritual journey: logs, flags, read counts ---------------------------
await test('members log prayer/word into their own private journey', async () => {
  assert.equal((await call('POST', '/api/log', { token: memberTokens[0], body: { kind: 'prayer', minutes: 20 } })).status, 201);
  assert.equal((await call('POST', '/api/log', { token: memberTokens[0], body: { kind: 'word', minutes: 15 } })).status, 201);
  const st = await call('GET', '/api/state', { token: memberTokens[0] });
  assert.ok(st.data.myLog.length >= 2);
  assert.ok(st.data.myLog.reduce((a, e) => a + e.minutes, 0) >= 35);
  // another member's journey is separate
  const st2 = await call('GET', '/api/state', { token: memberTokens[1] });
  assert.equal(st2.data.myLog.length, 0, 'logs are per-member');
  // validation: 0 is allowed (honest "none today"); junk kind and out-of-range rejected
  assert.equal((await call('POST', '/api/log', { token: leaderToken, body: { kind: 'nope', minutes: 10 } })).status, 400);
  assert.equal((await call('POST', '/api/log', { token: leaderToken, body: { kind: 'prayer', minutes: 0 } })).status, 201);
  assert.equal((await call('POST', '/api/log', { token: leaderToken, body: { kind: 'prayer', minutes: -1 } })).status, 400);
  assert.equal((await call('POST', '/api/log', { token: leaderToken, body: { kind: 'word', minutes: 601 } })).status, 400);
});

await test('devotion reads: personal flag + team count, toggle off', async () => {
  const add = await call('POST', '/api/devotionals', { token: leaderToken, body: { title: 'Read Test' } });
  const key = 'read:' + add.data.id;
  assert.equal((await call('POST', '/api/flags', { token: memberTokens[0], body: { key, on: true } })).status, 200);
  assert.equal((await call('POST', '/api/flags', { token: memberTokens[1], body: { key, on: true } })).status, 200);
  let st = await call('GET', '/api/state', { token: memberTokens[0] });
  const dv = st.data.devotionals.find((x) => x.id === add.data.id);
  assert.equal(dv.reads, 2, 'two members read it');
  assert.ok(st.data.myFlags.includes(key), 'my read flag is set');
  await call('POST', '/api/flags', { token: memberTokens[0], body: { key, on: false } });
  st = await call('GET', '/api/state', { token: leaderToken });
  assert.equal(st.data.devotionals.find((x) => x.id === add.data.id).reads, 1, 'count drops when undone');
});

await test('ministry check-in flags work; junk flags are rejected', async () => {
  const key = 'ministry:2026-08-02:practice';
  assert.equal((await call('POST', '/api/flags', { token: memberTokens[0], body: { key, on: true } })).status, 200);
  const st = await call('GET', '/api/state', { token: memberTokens[0] });
  assert.ok(st.data.myFlags.includes(key));
  assert.equal((await call('POST', '/api/flags', { token: memberTokens[0], body: { key: 'evil:hack', on: true } })).status, 400);
  assert.equal((await call('POST', '/api/flags', { token: memberTokens[0], body: { key: 'ministry:bad:practice', on: true } })).status, 400);
});

// ---- Leader team report -----------------------------------------------------
await test('leader team report aggregates each member’s week; members are refused', async () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  // David (memberTokens[0]) already logged 20m prayer + 15m word today; add a ministry check for today.
  await call('POST', '/api/flags', { token: memberTokens[0], body: { key: `ministry:${TODAY}:practice`, on: true } });

  const rep = await call('GET', '/api/team-report?sunday=' + TODAY, { token: leaderToken });
  assert.equal(rep.status, 200);
  assert.ok(Array.isArray(rep.data.members) && rep.data.members.length >= 3, 'every member is listed');
  assert.equal(rep.data.members.reduce((a, m) => a + m.prayerMin, 0), 20, 'aggregates prayer minutes for the week');
  assert.equal(rep.data.members.reduce((a, m) => a + m.wordMin, 0), 15, 'aggregates Word minutes for the week');
  const david = rep.data.members.find((m) => m.prayerMin === 20);
  assert.ok(david && david.wordMin === 15 && david.checkedCount >= 1, 'same member carries Word + ministry');

  // Members cannot view the report; bad/missing dates are rejected.
  assert.equal((await call('GET', '/api/team-report?sunday=' + TODAY, { token: memberTokens[0] })).status, 403);
  assert.equal((await call('GET', '/api/team-report', { token: leaderToken })).status, 400);
  assert.equal((await call('GET', '/api/team-report?sunday=nope', { token: leaderToken })).status, 400);
});

console.log(`\n${passed} tests passed.`);
