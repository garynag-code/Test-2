/* ============================================================================
 * Worship Team Roster — Cloudflare Worker API
 *
 * A team-scoped, HTTPS-only backend on Cloudflare Workers + D1 (SQLite) that
 * lets every phone share one live roster and receive Web Push reminders.
 *
 * Security model (see server/README.md and worship_roster/SECURITY.md):
 *   - Bearer device tokens; only their SHA-256 hash is stored.
 *   - Invite codes are high-entropy and stored hashed.
 *   - Every request is scoped to the caller's team; leader-only actions are
 *     enforced server-side, never trusted from the client.
 *   - Parameterised D1 statements only (no string-built SQL).
 *   - Strict CORS allow-list, request-size cap, input validation, security
 *     headers. VAPID private key lives in a Worker secret, never shipped.
 *
 * Pure, security-critical helpers are exported at the bottom for unit testing.
 * ========================================================================== */

// ---- Domain constants (mirror the front-end) -------------------------------

const POSITION_IDS = ['lead', 'lead2', 'lead3', 'lead4', 'lead5', 'bass', 'drums', 'guitar', 'keys', 'bv1', 'bv2', 'bv3'];
const TYPE_IDS = ['weekday', 'afterchurch'];
const MAX_BODY_BYTES = 16 * 1024;          // 16 KB request cap (JSON endpoints)
const MAX_PDF_BYTES = 800 * 1024;          // 800 KB cap for attached chord PDFs
const TOKEN_BYTES = 32;                    // 256-bit device tokens
const INVITE_BYTES = 9;                    // ~14-char base32 invite code

// ============================================================================
// Utilities
// ============================================================================

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Random opaque token, URL-safe. */
function randomToken(nBytes) {
  return b64url(crypto.getRandomValues(new Uint8Array(nBytes)));
}
/** Human-typable invite code (Crockford-ish base32, no confusing chars). */
function randomInvite() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const raw = crypto.getRandomValues(new Uint8Array(INVITE_BYTES));
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += alphabet[raw[i] % alphabet.length];
    if (i === 4) out += '-';
  }
  return out;
}
function uid(prefix) {
  return prefix + '_' + b64url(crypto.getRandomValues(new Uint8Array(8))).slice(0, 12);
}

// ---- Validation (pure) -----------------------------------------------------

function isString(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function isMonth(v) { return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v); }
function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isPositionId(v) { return POSITION_IDS.includes(v); }
function isTypeId(v) { return TYPE_IDS.includes(v); }
function sanitizeName(v) {
  // Collapse whitespace; strip control chars. Display escaping still happens
  // client-side, but we keep stored values clean and bounded.
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= 60 ? t : null;
}
function sanitizePositions(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isPositionId))];
}

// ---- Majority-vote tally (pure) --------------------------------------------

/**
 * Given the votes for one (month,type) block and the number of team members,
 * return the leading candidate date and whether it clears a strict majority
 * (> half the team). This is the single source of truth for locking a date.
 */
function tallyMajority(voteRows, memberCount) {
  const counts = new Map();
  for (const r of voteRows) counts.set(r.date, (counts.get(r.date) || 0) + 1);
  let leader = null, leaderCount = 0;
  for (const [date, count] of counts) {
    if (count > leaderCount) { leader = date; leaderCount = count; }
  }
  const threshold = Math.floor(memberCount / 2) + 1;
  return { leader, leaderCount, threshold, hasMajority: leader != null && leaderCount >= threshold };
}

// ============================================================================
// HTTP helpers
// ============================================================================

function corsHeaders(origin, env) {
  const allow = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && allow.includes(origin);
  const h = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (ok) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(securityHeaders(), extra || {}),
  });
}
function err(status, message, extra) {
  return json({ error: message }, status, extra);
}

// ============================================================================
// Auth
// ============================================================================

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1]);
  const row = await env.DB
    .prepare('SELECT id, team_id, name, is_leader, positions FROM members WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!row) return null;
  return {
    id: row.id, teamId: row.team_id, name: row.name,
    isLeader: !!row.is_leader, positions: JSON.parse(row.positions || '[]'),
  };
}

// ============================================================================
// Route handlers
// ============================================================================

async function createTeam(request, env) {
  const body = await readJson(request);
  const teamName = sanitizeName(body && body.teamName);
  const leaderName = sanitizeName(body && body.leaderName);
  if (!teamName || !leaderName) return err(400, 'teamName and leaderName are required');

  const teamId = uid('t');
  const invite = randomInvite();
  const token = randomToken(TOKEN_BYTES);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare('INSERT INTO teams (id, name, invite_code_hash, created_at) VALUES (?,?,?,?)')
      .bind(teamId, teamName, await sha256Hex(invite), now),
    env.DB.prepare('INSERT INTO members (id, team_id, name, is_leader, positions, token_hash, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(uid('m'), teamId, leaderName, 1, '["lead"]', await sha256Hex(token), now),
  ]);

  return json({ teamId, teamName, inviteCode: invite, deviceToken: token, role: 'leader' }, 201);
}

async function joinTeam(request, env) {
  const body = await readJson(request);
  const code = typeof (body && body.inviteCode) === 'string' ? body.inviteCode.trim().toUpperCase() : '';
  const name = sanitizeName(body && body.name);
  if (!code || !name) return err(400, 'inviteCode and name are required');

  const team = await env.DB.prepare('SELECT id, name FROM teams WHERE invite_code_hash = ?')
    .bind(await sha256Hex(code)).first();
  if (!team) return err(404, 'Invalid invite code');

  const token = randomToken(TOKEN_BYTES);
  await env.DB.prepare('INSERT INTO members (id, team_id, name, is_leader, positions, token_hash, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(uid('m'), team.id, name, 0, '[]', await sha256Hex(token), new Date().toISOString())
    .run();

  return json({ teamId: team.id, teamName: team.name, deviceToken: token, role: 'member' }, 201);
}

/** Assemble the full shared state for the caller's team. */
async function getState(env, me) {
  const t = me.teamId;
  const [team, members, assigns, voteRows, locks, songs, pdfs] = await Promise.all([
    env.DB.prepare('SELECT name, season_start, season_end FROM teams WHERE id = ?').bind(t).first(),
    env.DB.prepare('SELECT id, name, is_leader, title, positions FROM members WHERE team_id = ? ORDER BY created_at').bind(t).all(),
    env.DB.prepare('SELECT date, position_id, member_id FROM assignments WHERE team_id = ?').bind(t).all(),
    env.DB.prepare('SELECT month, type_id, member_id, date FROM votes WHERE team_id = ?').bind(t).all(),
    env.DB.prepare('SELECT month, type_id, locked_date FROM practice_locks WHERE team_id = ?').bind(t).all(),
    env.DB.prepare('SELECT id, month, title, key_sig FROM songs WHERE team_id = ? ORDER BY created_at').bind(t).all(),
    env.DB.prepare('SELECT song_id, filename FROM song_pdfs WHERE team_id = ?').bind(t).all(),
  ]);
  const pdfMap = new Map((pdfs.results || []).map((r) => [r.song_id, r.filename || 'chords.pdf']));
  return {
    team: { name: team && team.name, seasonStart: team && team.season_start, seasonEnd: team && team.season_end },
    me: { id: me.id, isLeader: me.isLeader },
    members: (members.results || []).map((r) => ({
      id: r.id, name: r.name, isLeader: !!r.is_leader, title: r.title || '', positions: JSON.parse(r.positions || '[]'),
    })),
    assignments: assigns.results || [],
    votes: voteRows.results || [],
    locks: locks.results || [],
    songs: (songs.results || []).map((r) => ({
      id: r.id, month: r.month, title: r.title, key: r.key_sig,
      hasPdf: pdfMap.has(r.id), pdfName: pdfMap.get(r.id) || null,
    })),
  };
}

async function setAssignment(request, env, me) {
  const body = await readJson(request);
  if (!isDate(body && body.date) || !isPositionId(body && body.positionId)) return err(400, 'Invalid date or position');
  const memberId = body.memberId || null;
  if (memberId) {
    const owns = await env.DB.prepare('SELECT 1 FROM members WHERE id = ? AND team_id = ?').bind(memberId, me.teamId).first();
    if (!owns) return err(400, 'Unknown member');
  }
  await env.DB.prepare(
    'INSERT INTO assignments (team_id, date, position_id, member_id) VALUES (?,?,?,?) ' +
    'ON CONFLICT(team_id, date, position_id) DO UPDATE SET member_id = excluded.member_id'
  ).bind(me.teamId, body.date, body.positionId, memberId).run();
  return json({ ok: true });
}

/** Admin-only: set another member's display title and/or admin privileges. */
async function updateMember(request, env, me, memberId) {
  if (!me.isLeader) return err(403, 'Only an admin can change member roles');
  const target = await env.DB.prepare('SELECT id, is_leader FROM members WHERE id = ? AND team_id = ?')
    .bind(memberId, me.teamId).first();
  if (!target) return err(404, 'Member not found');

  const body = await readJson(request);
  const sets = [], vals = [];
  if (typeof body.title === 'string') {
    const title = body.title.replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    sets.push('title = ?'); vals.push(title);
  }
  if (typeof body.isLeader === 'boolean') {
    // Never leave the team without an admin.
    if (body.isLeader === false && target.is_leader) {
      const admins = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ? AND is_leader = 1')
        .bind(me.teamId).first();
      if (admins.n <= 1) return err(409, 'The team must keep at least one admin');
    }
    sets.push('is_leader = ?'); vals.push(body.isLeader ? 1 : 0);
  }
  if (!sets.length) return err(400, 'Nothing to update');

  vals.push(memberId, me.teamId);
  await env.DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`).bind(...vals).run();
  return json({ ok: true });
}

async function castVote(request, env, me) {
  const body = await readJson(request);
  if (!isMonth(body && body.month) || !isTypeId(body && body.typeId) || !isDate(body && body.date))
    return err(400, 'Invalid vote');
  const locked = await env.DB.prepare('SELECT 1 FROM practice_locks WHERE team_id = ? AND month = ? AND type_id = ?')
    .bind(me.teamId, body.month, body.typeId).first();
  if (locked) return err(409, 'Date is locked — a new vote must be called to change it');

  // One vote per member per block: upsert this member's single choice.
  await env.DB.prepare(
    'INSERT INTO votes (team_id, month, type_id, member_id, date) VALUES (?,?,?,?,?) ' +
    'ON CONFLICT(team_id, month, type_id, member_id) DO UPDATE SET date = excluded.date'
  ).bind(me.teamId, body.month, body.typeId, me.id, body.date).run();
  return json({ ok: true });
}

async function lockPractice(request, env, me) {
  if (!me.isLeader) return err(403, 'Only an admin can lock a date');
  const body = await readJson(request);
  if (!isMonth(body && body.month) || !isTypeId(body && body.typeId)) return err(400, 'Invalid request');

  const [{ results: voteRows }, memberCountRow] = await Promise.all([
    env.DB.prepare('SELECT date FROM votes WHERE team_id = ? AND month = ? AND type_id = ?')
      .bind(me.teamId, body.month, body.typeId).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').bind(me.teamId).first(),
  ]);
  const tally = tallyMajority(voteRows, memberCountRow.n);
  if (!tally.hasMajority) return err(409, `Need ${tally.threshold} of ${memberCountRow.n} votes for a majority`);

  await env.DB.prepare(
    'INSERT INTO practice_locks (team_id, month, type_id, locked_date, locked_by, locked_at) VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT(team_id, month, type_id) DO UPDATE SET locked_date = excluded.locked_date, locked_by = excluded.locked_by, locked_at = excluded.locked_at'
  ).bind(me.teamId, body.month, body.typeId, tally.leader, me.id, new Date().toISOString()).run();
  return json({ ok: true, lockedDate: tally.leader });
}

async function newVote(request, env, me) {
  if (!me.isLeader) return err(403, 'Only an admin can call a new vote');
  const body = await readJson(request);
  if (!isMonth(body && body.month) || !isTypeId(body && body.typeId)) return err(400, 'Invalid request');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM practice_locks WHERE team_id = ? AND month = ? AND type_id = ?')
      .bind(me.teamId, body.month, body.typeId),
    env.DB.prepare('DELETE FROM votes WHERE team_id = ? AND month = ? AND type_id = ?')
      .bind(me.teamId, body.month, body.typeId),
  ]);
  return json({ ok: true });
}

async function addSong(request, env, me) {
  // Any team member can post songs.
  const body = await readJson(request);
  const title = sanitizeName(body && body.title);
  if (!isMonth(body && body.month) || !title) return err(400, 'Invalid song');
  const key = typeof (body && body.key) === 'string' ? body.key.slice(0, 12).trim() : '';
  const id = uid('s');
  await env.DB.prepare('INSERT INTO songs (id, team_id, month, title, key_sig, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, me.teamId, body.month, title, key, new Date().toISOString()).run();
  return json({ ok: true, id }, 201);
}

async function deleteSong(env, me, songId) {
  // Any team member can remove a song (so mistakes can be fixed by anyone).
  await env.DB.batch([
    env.DB.prepare('DELETE FROM songs WHERE id = ? AND team_id = ?').bind(songId, me.teamId),
    env.DB.prepare('DELETE FROM song_pdfs WHERE song_id = ? AND team_id = ?').bind(songId, me.teamId),
  ]);
  return json({ ok: true });
}

/** Attach a chord-sheet PDF to a song (any member). Raw PDF body, ?name=filename. */
async function uploadSongPdf(request, env, me, songId, url) {
  const song = await env.DB.prepare('SELECT id FROM songs WHERE id = ? AND team_id = ?')
    .bind(songId, me.teamId).first();
  if (!song) return err(404, 'Song not found');

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return err(400, 'Empty file');
  if (bytes.byteLength > MAX_PDF_BYTES) return err(413, 'PDF too large — please keep it under 800 KB (1–2 page chord charts are fine).');
  // Basic PDF signature check ("%PDF").
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return err(400, 'That file is not a PDF.');
  }
  let filename = (url.searchParams.get('name') || 'chords.pdf').replace(/[\x00-\x1F\x7F/\\]/g, '').slice(0, 80);
  if (!/\.pdf$/i.test(filename)) filename += '.pdf';

  await env.DB.prepare(
    'INSERT INTO song_pdfs (song_id, team_id, filename, data, created_at) VALUES (?,?,?,?,?) ' +
    'ON CONFLICT(song_id) DO UPDATE SET filename = excluded.filename, data = excluded.data, created_at = excluded.created_at'
  ).bind(songId, me.teamId, filename, b64url(bytes), new Date().toISOString()).run();
  return json({ ok: true }, 201);
}

/** Return the attached PDF bytes for a song (any member of the team). */
async function getSongPdf(env, me, songId) {
  const row = await env.DB.prepare('SELECT filename, data FROM song_pdfs WHERE song_id = ? AND team_id = ?')
    .bind(songId, me.teamId).first();
  if (!row) return err(404, 'No PDF attached');
  const bytes = b64urlToBytes(row.data);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${row.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function subscribePush(request, env, me) {
  const body = await readJson(request);
  const sub = body && body.subscription;
  if (!sub || !isString(sub.endpoint, 1024) || !sub.keys || !isString(sub.keys.p256dh, 256) || !isString(sub.keys.auth, 256))
    return err(400, 'Invalid subscription');
  await env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint, member_id, team_id, p256dh, auth, created_at) VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, team_id = excluded.team_id, p256dh = excluded.p256dh, auth = excluded.auth'
  ).bind(sub.endpoint, me.id, me.teamId, sub.keys.p256dh, sub.keys.auth, new Date().toISOString()).run();
  return json({ ok: true }, 201);
}

// ============================================================================
// Web Push (VAPID) — tickle notifications (no payload; SW prompts to open app)
// ============================================================================

/** Import a raw VAPID P-256 key pair into a WebCrypto signing key. */
async function importVapidKey(publicB64, privateB64) {
  const pub = b64urlToBytes(publicB64);   // 65 bytes, 0x04 || X(32) || Y(32)
  const d = b64urlToBytes(privateB64);    // 32 bytes
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: b64url(d), ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Build a signed VAPID JWT for a given push endpoint origin. */
async function vapidJwt(env, audience) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  })));
  const key = await importVapidKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Send a payload-less push to one subscription. Returns the HTTP status. */
async function sendPush(env, endpoint) {
  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(env, audience);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Length': '0',
    },
  });
  return res.status;
}

// ============================================================================
// Cron: compute due reminders and push tickles
// ============================================================================

async function runReminders(env) {
  const today = new Date().toISOString().slice(0, 10);
  const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 3 = Wednesday
  const teams = await env.DB.prepare('SELECT id FROM teams').all();

  for (const { id: teamId } of (teams.results || [])) {
    const due = [];
    // Weekly song-list nudge: fire on Wednesdays for leaders.
    if (dow === 3) due.push(`songlist:${today}`);
    // Practice reminders: 2 days before any locked practice date.
    const locks = await env.DB.prepare('SELECT month, type_id, locked_date FROM practice_locks WHERE team_id = ?')
      .bind(teamId).all();
    for (const l of (locks.results || [])) {
      const remindOn = new Date(l.locked_date + 'T00:00:00Z');
      remindOn.setUTCDate(remindOn.getUTCDate() - 2);
      if (remindOn.toISOString().slice(0, 10) === today) due.push(`practice:${l.month}:${l.type_id}`);
    }
    if (!due.length) continue;

    // Skip anything already sent (idempotent across cron re-runs).
    const fresh = [];
    for (const tag of due) {
      const seen = await env.DB.prepare('SELECT 1 FROM reminder_log WHERE team_id = ? AND tag = ?').bind(teamId, tag).first();
      if (!seen) fresh.push(tag);
    }
    if (!fresh.length) continue;

    const subs = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE team_id = ?').bind(teamId).all();
    for (const s of (subs.results || [])) {
      try {
        const status = await sendPush(env, s.endpoint);
        if (status === 404 || status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
        }
      } catch (_) { /* one bad endpoint shouldn't stop the batch */ }
    }
    for (const tag of fresh) {
      await env.DB.prepare('INSERT OR IGNORE INTO reminder_log (team_id, tag, sent_at) VALUES (?,?,?)')
        .bind(teamId, tag, new Date().toISOString()).run();
    }
  }
}

// ============================================================================
// Request body reader with size cap
// ============================================================================

async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') || '0');
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { throw new HttpError(400, 'Invalid JSON'); }
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ============================================================================
// Router / entrypoint
// ============================================================================

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  // Public (no auth) endpoints.
  if (method === 'POST' && path === '/api/teams') return createTeam(request, env);
  if (method === 'POST' && path === '/api/teams/join') return joinTeam(request, env);
  if (method === 'GET' && path === '/api/health') return json({ ok: true });

  // Everything else requires a valid device token.
  const me = await authenticate(request, env);
  if (!me) return err(401, 'Authentication required');

  if (method === 'GET' && path === '/api/state') return json(await getState(env, me));
  if (method === 'PUT' && path === '/api/assignments') return setAssignment(request, env, me);
  if (method === 'PUT' && path.startsWith('/api/members/')) return updateMember(request, env, me, decodeURIComponent(path.slice('/api/members/'.length)));
  if (method === 'POST' && path === '/api/votes') return castVote(request, env, me);
  if (method === 'POST' && path === '/api/practices/lock') return lockPractice(request, env, me);
  if (method === 'POST' && path === '/api/practices/new-vote') return newVote(request, env, me);
  if (method === 'POST' && path === '/api/songs') return addSong(request, env, me);
  const pdfMatch = path.match(/^\/api\/songs\/([^/]+)\/pdf$/);
  if (pdfMatch) {
    const sid = decodeURIComponent(pdfMatch[1]);
    if (method === 'POST') return uploadSongPdf(request, env, me, sid, url);
    if (method === 'GET') return getSongPdf(env, me, sid);
  }
  if (method === 'DELETE' && path.startsWith('/api/songs/')) return deleteSong(env, me, decodeURIComponent(path.slice('/api/songs/'.length)));
  if (method === 'POST' && path === '/api/push/subscribe') return subscribePush(request, env, me);

  return err(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Reject cross-origin requests from origins not on the allow-list.
    if (origin && !cors['Access-Control-Allow-Origin']) return err(403, 'Origin not allowed', cors);

    try {
      const res = await handle(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof HttpError ? e.message : 'Internal error';
      return err(status, message, cors);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};

// ---- Exports for unit testing (pure/security-critical helpers) -------------
export {
  sha256Hex, randomToken, randomInvite, uid, b64url, b64urlToBytes,
  sanitizeName, sanitizePositions, isMonth, isDate, isPositionId, isTypeId,
  tallyMajority, importVapidKey, vapidJwt,
};
