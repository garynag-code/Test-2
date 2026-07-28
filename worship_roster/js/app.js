/* ============================================================================
 * Worship Team Roster — client-side application
 *
 * A mobile-friendly, zero-backend app that manages a worship team roster,
 * schedules monthly practices by majority vote, tracks song lists + chords,
 * and drives a reminder system. State persists in localStorage so the whole
 * thing can be hosted as static files (e.g. GitHub Pages) and used from a phone.
 *
 * Sections:
 *   1. Constants & season configuration
 *   2. State + persistence
 *   3. Seed / first-run data
 *   4. Domain helpers (dates, Sundays, voting, reminders, chords)
 *   5. Rendering (one function per tab)
 *   6. Event wiring & bootstrap
 * ========================================================================== */

'use strict';

/* -------------------------------------------------------------------------- *
 * 1. Constants & season configuration
 * -------------------------------------------------------------------------- */

// The roster season, per the brief: July 2 – December 31, 2026.
const SEASON = {
  start: '2026-07-02',
  end:   '2026-12-31',
  label: '2 Jul – 31 Dec 2026',
};

// Fixed positions on the team. `single: true` means one person fills it.
const POSITIONS = [
  { id: 'lead',    name: 'Lead Worshipper', icon: '🎤' },
  { id: 'bass',    name: 'Bass',            icon: '🎸' },
  { id: 'drums',   name: 'Drums',           icon: '🥁' },
  { id: 'guitar',  name: 'Guitar',          icon: '🎸' },
  { id: 'keys',    name: 'Keyboard',        icon: '🎹' },
  { id: 'bv1',     name: 'Backup Singer 1', icon: '🎙️' },
  { id: 'bv2',     name: 'Backup Singer 2', icon: '🎙️' },
  { id: 'bv3',     name: 'Backup Singer 3', icon: '🎙️' },
];

// The two monthly practice types decided by vote.
const PRACTICE_TYPES = [
  { id: 'weekday',     name: 'Weekday practice',      hint: 'One mandatory mid-week rehearsal', weekdayOnly: true },
  { id: 'afterchurch', name: 'After-church practice', hint: 'Rehearsal straight after a Sunday service', sundayOnly: true },
];

// Organisation branding (single source of truth; change here to re-brand).
const BRAND = 'Ecclesia Glocal Church';
const TAGLINE = 'Forming Christ, Driving Change';

const STORAGE_KEY = 'worship-roster-v1';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* -------------------------------------------------------------------------- *
 * 2. State + persistence
 * -------------------------------------------------------------------------- */

// Cloud mode is on when config supplies an API base AND the API client loaded.
const CFG = window.ROSTER_CONFIG || {};
const CLOUD = !!(CFG.apiBase && window.RosterAPI && window.RosterAPI.configured());

let state = CLOUD ? emptyState() : load();
let activeTab = 'roster';

function emptyState() {
  // Placeholder until the first cloud sync populates real data.
  return { version: 1, currentUserId: null, members: [], sundays: buildSundays(),
    practices: buildPractices(), reminders: [], songs: {}, notifyEnabled: false, cloud: true };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* corrupt storage — fall through to seed */ }
  return seed();
}

function save() {
  if (CLOUD) return;  // in cloud mode the server is the source of truth
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    toast('Could not save — storage may be full.');
  }
}

/* -------------------------------------------------------------------------- *
 * 3. Seed / first-run data
 * -------------------------------------------------------------------------- */

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function seed() {
  const members = [
    { id: uid('m'), name: 'Naomi (Leader)', isLeader: true,  positions: ['lead'] },
    { id: uid('m'), name: 'David',          isLeader: false, positions: ['bass'] },
    { id: uid('m'), name: 'Peter',          isLeader: false, positions: ['drums'] },
    { id: uid('m'), name: 'Grace',          isLeader: false, positions: ['guitar'] },
    { id: uid('m'), name: 'Sam',            isLeader: false, positions: ['keys'] },
    { id: uid('m'), name: 'Ruth',           isLeader: false, positions: ['bv1', 'lead'] },
    { id: uid('m'), name: 'Esther',         isLeader: false, positions: ['bv2'] },
    { id: uid('m'), name: 'Joy',            isLeader: false, positions: ['bv3'] },
  ];

  const s = {
    version: 1,
    currentUserId: members[0].id,
    members,
    sundays: buildSundays(),   // roster rows for each Sunday in season
    practices: buildPractices(),
    reminders: [],
    songs: {},                 // keyed by "YYYY-MM" -> [ {id,title,key} ]
    notifyEnabled: false,
  };
  s.reminders = buildSeasonReminders(s);
  return s;
}

/* -------------------------------------------------------------------------- *
 * 4. Domain helpers
 * -------------------------------------------------------------------------- */

// -- date utilities (all local, no timezone surprises) --------------------

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function fmtLong(iso) {
  const d = parseISO(iso);
  return `${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}`;
}
function fmtShort(iso) {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}`;
}
function todayISO() {
  return toISO(new Date());
}

/** Every Sunday between SEASON.start and SEASON.end (inclusive). */
function seasonSundays() {
  const out = [];
  const end = parseISO(SEASON.end);
  const d = parseISO(SEASON.start);
  // advance to the first Sunday on/after the start date
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d <= end) {
    out.push(toISO(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

/** Each month (as YYYY-MM) touched by the season. */
function seasonMonths() {
  const out = [];
  const end = parseISO(SEASON.end);
  const d = parseISO(SEASON.start);
  d.setDate(1);
  while (d <= end) {
    out.push(monthKey(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/** All candidate dates of a given predicate within a month. */
function datesInMonth(mKey, predicate) {
  const [y, m] = mKey.split('-').map(Number);
  const out = [];
  const start = parseISO(SEASON.start);
  const end = parseISO(SEASON.end);
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (d >= start && d <= end && predicate(d)) out.push(toISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// -- schedule construction ------------------------------------------------

function buildSundays() {
  return seasonSundays().map((date) => ({
    date,
    assignments: {},   // positionId -> memberId
  }));
}

/**
 * One voting block per month per practice type. Candidate dates are generated
 * automatically (Tue/Wed/Thu for weekday, Sundays for after-church); the team
 * then votes and a majority locks the date.
 */
function buildPractices() {
  const out = {};
  for (const mKey of seasonMonths()) {
    out[mKey] = {};
    for (const type of PRACTICE_TYPES) {
      const predicate = type.weekdayOnly
        ? (d) => d.getDay() >= 2 && d.getDay() <= 4      // Tue–Thu
        : (d) => d.getDay() === 0;                        // Sunday
      out[mKey][type.id] = {
        candidates: datesInMonth(mKey, predicate).map((date) => ({ date, votes: [] })),
        lockedDate: null,
      };
    }
  }
  return out;
}

// -- voting logic ---------------------------------------------------------

/** Number of members eligible to vote. */
function voterCount() {
  return state.members.length;
}

/** Strict majority threshold (> half of the team). */
function majorityThreshold() {
  return Math.floor(voterCount() / 2) + 1;
}

/** The candidate with the most votes, and whether it clears a majority. */
function tallyLeader(block) {
  let leader = null;
  for (const c of block.candidates) {
    if (!leader || c.votes.length > leader.votes.length) leader = c;
  }
  const hasMajority = leader && leader.votes.length >= majorityThreshold() && leader.votes.length > 0;
  return { leader, hasMajority };
}

/** Toggle the current user's vote for a candidate date (single choice per block). */
function castVote(block, date) {
  if (block.lockedDate) {
    toast('Date is locked. Call a new vote to change it.');
    return;
  }
  const me = state.currentUserId;
  for (const c of block.candidates) {
    c.votes = c.votes.filter((v) => v !== me);   // one vote per member per block
    if (c.date === date) c.votes.push(me);
  }
  save();
}

/**
 * Lock the majority winner. Enforces the rule that a date, once chosen by the
 * majority, is fixed until a *new* vote is explicitly called.
 */
function lockMajority(mKey, typeId) {
  const block = state.practices[mKey][typeId];
  const { leader, hasMajority } = tallyLeader(block);
  if (!hasMajority) {
    toast(`Need ${majorityThreshold()} of ${voterCount()} votes for a majority.`);
    return false;
  }
  block.lockedDate = leader.date;
  syncPracticeReminders(mKey, typeId);
  save();
  toast(`Locked ${fmtShort(leader.date)} by majority vote.`);
  return true;
}

/** Re-open a locked block for a fresh vote (the only way to change a set date). */
function callNewVote(mKey, typeId) {
  const block = state.practices[mKey][typeId];
  block.lockedDate = null;
  for (const c of block.candidates) c.votes = [];
  // Remove reminders tied to the now-cancelled date.
  state.reminders = state.reminders.filter((r) => !(r.tag === `practice:${mKey}:${typeId}`));
  save();
  toast('New vote opened — previous result cleared.');
}

// -- reminders ------------------------------------------------------------

function addReminder(r) {
  state.reminders.push(Object.assign({ id: uid('r'), done: false }, r));
}

/**
 * Weekly "post the song list" nudge for leaders — due each Wednesday so the
 * list is ready before Sunday. One reminder per Sunday service in the season.
 */
function buildSeasonReminders(s) {
  const reminders = [];
  for (const sundayISO of seasonSundays()) {
    const sunday = parseISO(sundayISO);
    const wed = new Date(sunday);
    wed.setDate(sunday.getDate() - 4); // Wednesday before this Sunday
    reminders.push({
      id: uid('r'),
      type: 'songlist',
      tag: `songlist:${sundayISO}`,
      title: 'Leaders: post the song list',
      detail: `For the service on ${fmtLong(sundayISO)}.`,
      date: toISO(wed),
      audience: 'leaders',
      done: false,
    });
  }
  return reminders;
}

/** Keep practice reminders in sync with a locked practice date. */
function syncPracticeReminders(mKey, typeId) {
  const block = state.practices[mKey][typeId];
  const type = PRACTICE_TYPES.find((t) => t.id === typeId);
  state.reminders = state.reminders.filter((r) => r.tag !== `practice:${mKey}:${typeId}`);
  if (!block.lockedDate) return;
  const practice = parseISO(block.lockedDate);
  const remindOn = new Date(practice);
  remindOn.setDate(practice.getDate() - 2); // two days before
  addReminder({
    type: 'practice',
    tag: `practice:${mKey}:${typeId}`,
    title: `Musicians: rehearse for ${type.name.toLowerCase()}`,
    detail: `Practice on ${fmtLong(block.lockedDate)}. Run the current song list.`,
    date: toISO(remindOn),
    audience: 'musicians',
  });
}

/** Reminder for musicians to practise a specific song's chords. */
function remindSongPractice(mKey, song) {
  const nextService = seasonSundays().find((d) => d >= todayISO()) || SEASON.end;
  const remindOn = parseISO(nextService);
  remindOn.setDate(remindOn.getDate() - 3); // Thursday-ish before Sunday
  addReminder({
    type: 'song',
    tag: `song:${mKey}:${song.id}`,
    title: `Practise "${song.title}"`,
    detail: `Key of ${song.key || '—'}. Chords: ${chordsUrl(song)}`,
    date: toISO(remindOn),
    audience: 'musicians',
  });
  save();
  toast(`Reminder set for "${song.title}".`);
}

function reminderStatus(r) {
  const t = todayISO();
  if (r.done) return 'done';
  if (r.date < t) return 'past';
  if (r.date === t) return 'due';
  return 'upcoming';
}

// -- songs & chords -------------------------------------------------------

/** Build a chord-lookup URL for a song (Ultimate Guitar search). */
function chordsUrl(song) {
  const q = encodeURIComponent(`${song.title} ${song.key ? 'chords' : 'worship chords'}`.trim());
  return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`;
}

function songsFor(mKey) {
  return state.songs[mKey] || [];
}

/* -------------------------------------------------------------------------- *
 * 4b. Store abstraction (local vs cloud) + cloud sync
 *
 * Every UI mutation goes through `store` so local mode and cloud mode share one
 * path. In local mode it edits localStorage-backed state; in cloud mode it
 * calls the Worker API and re-syncs authoritative state from the server.
 * -------------------------------------------------------------------------- */

const localStore = {
  async assign(date, pos, mid) {
    const s = state.sundays.find((x) => x.date === date);
    if (mid) s.assignments[pos] = mid; else delete s.assignments[pos];
    save();
  },
  async vote(mKey, typeId, date) { castVote(state.practices[mKey][typeId], date); },
  async lock(mKey, typeId) { return lockMajority(mKey, typeId); },
  async newVote(mKey, typeId) { callNewVote(mKey, typeId); },
  async addSong(mKey, title, key) {
    if (!state.songs[mKey]) state.songs[mKey] = [];
    state.songs[mKey].push({ id: uid('s'), title, key }); save();
  },
  async deleteSong(mKey, id) { state.songs[mKey] = (state.songs[mKey] || []).filter((x) => x.id !== id); save(); },
};

const cloudStore = {
  async assign(date, pos, mid) { await guard(() => RosterAPI.setAssignment(date, pos, mid || null)); },
  async vote(mKey, typeId, date) { await guard(() => RosterAPI.vote(mKey, typeId, date)); },
  async lock(mKey, typeId) { const ok = await guard(() => RosterAPI.lock(mKey, typeId)); return ok; },
  async newVote(mKey, typeId) { await guard(() => RosterAPI.newVote(mKey, typeId)); },
  async addSong(mKey, title, key) { await guard(() => RosterAPI.addSong(mKey, title, key)); },
  async deleteSong(mKey, id) { await guard(() => RosterAPI.deleteSong(id)); },
};

/** Run a cloud call, surface errors as a toast, then re-sync server truth. */
async function guard(fn) {
  let ok = true;
  try { await fn(); } catch (e) { ok = false; toast(e.message || 'Something went wrong.'); }
  try { await syncFromCloud(); } catch (_) { /* keep last-known state */ }
  return ok;
}

const store = CLOUD ? cloudStore : localStore;

/** Pull authoritative state from the server and map it to the local shape. */
async function syncFromCloud() {
  const s = await RosterAPI.getState();
  state = cloudMap(s);
}

/** Map the server state payload onto the shape the render functions expect. */
function cloudMap(s) {
  const st = {
    version: 1,
    currentUserId: s.me && s.me.id,
    members: (s.members || []).map((m) => ({ id: m.id, name: m.name, isLeader: m.isLeader, positions: m.positions || [] })),
    sundays: buildSundays(),
    practices: buildPractices(),
    reminders: [],
    songs: {},
    notifyEnabled: localStorage.getItem('worship-roster-notify') === '1',
    team: s.team,
    cloud: true,
  };
  const byDate = {};
  st.sundays.forEach((x) => { byDate[x.date] = x; });
  for (const a of (s.assignments || [])) {
    if (a.member_id && byDate[a.date]) byDate[a.date].assignments[a.position_id] = a.member_id;
  }
  for (const v of (s.votes || [])) {
    const blk = st.practices[v.month] && st.practices[v.month][v.type_id];
    if (!blk) continue;
    const c = blk.candidates.find((x) => x.date === v.date);
    if (c) c.votes.push(v.member_id);
  }
  for (const l of (s.locks || [])) {
    const blk = st.practices[l.month] && st.practices[l.month][l.type_id];
    if (blk) blk.lockedDate = l.locked_date;
  }
  for (const so of (s.songs || [])) {
    (st.songs[so.month] = st.songs[so.month] || []).push({ id: so.id, title: so.title, key: so.key || '' });
  }
  // Derive the reminder list for display (push delivery is handled server-side).
  st.reminders = buildSeasonReminders(st);
  for (const mKey of Object.keys(st.practices)) {
    for (const typeId of Object.keys(st.practices[mKey])) {
      const blk = st.practices[mKey][typeId];
      if (!blk.lockedDate) continue;
      const type = PRACTICE_TYPES.find((t) => t.id === typeId);
      const remindOn = parseISO(blk.lockedDate);
      remindOn.setDate(remindOn.getDate() - 2);
      st.reminders.push({
        id: uid('r'), type: 'practice', tag: `practice:${mKey}:${typeId}`,
        title: `Musicians: rehearse for ${type.name.toLowerCase()}`,
        detail: `Practice on ${fmtLong(blk.lockedDate)}.`, date: toISO(remindOn),
        audience: 'musicians', done: false,
      });
    }
  }
  return st;
}

/* -------------------------------------------------------------------------- *
 * 5. Rendering
 * -------------------------------------------------------------------------- */

const view = document.getElementById('view');

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function memberName(id) {
  const m = state.members.find((x) => x.id === id);
  return m ? m.name : '—';
}
function currentUser() {
  return state.members.find((m) => m.id === state.currentUserId) || state.members[0];
}
function isLeader() {
  const u = currentUser();
  return !!(u && u.isLeader);
}

function render() {
  document.getElementById('season-label').textContent = `Season: ${SEASON.label}`;
  syncUserSelect();
  document.querySelectorAll('.tabbar__btn').forEach((b) => {
    b.setAttribute('aria-current', b.dataset.tab === activeTab ? 'true' : 'false');
  });
  const map = { roster, voting, songs, reminders, team };
  view.innerHTML = '';
  (map[activeTab] || roster)();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}

function syncUserSelect() {
  const sel = document.getElementById('current-user');
  if (CLOUD) {
    // Each device is signed in as one member; no switching.
    const me = currentUser();
    sel.innerHTML = me ? `<option>${esc(me.name)}</option>` : '';
    sel.disabled = true;
    return;
  }
  sel.innerHTML = state.members
    .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
    .join('');
  sel.value = state.currentUserId;
}

// -- Tab: Roster ----------------------------------------------------------

function roster() {
  view.appendChild(el(`<h2 class="section-title">📅 Sunday Roster</h2>`));
  view.appendChild(el(`<p class="section-sub">Assign musicians to positions for each service. ${state.sundays.length} Sundays in the season.</p>`));

  const upcoming = state.sundays.filter((s) => s.date >= todayISO());
  const list = upcoming.length ? upcoming : state.sundays;

  for (const sunday of list) {
    const card = el(`<div class="card"></div>`);
    const filled = POSITIONS.filter((p) => sunday.assignments[p.id]).length;
    card.appendChild(el(`
      <div class="card__head">
        <span class="card__title">${fmtLong(sunday.date)}</span>
        <span class="badge ${filled === POSITIONS.length ? 'badge--ok' : 'badge--muted'}">${filled}/${POSITIONS.length} set</span>
      </div>`));

    for (const pos of POSITIONS) {
      const row = el(`<div class="assign-row"></div>`);
      row.appendChild(el(`<div class="assign-row__pos"><span class="pos-icon">${pos.icon}</span>${pos.name}</div>`));
      const sel = el(`<select data-date="${sunday.date}" data-pos="${pos.id}"></select>`);
      const eligible = state.members.filter((m) => m.positions.includes(pos.id));
      const pool = eligible.length ? eligible : state.members;
      sel.innerHTML = `<option value="">— unassigned —</option>` +
        pool.map((m) => `<option value="${m.id}" ${sunday.assignments[pos.id] === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
      sel.addEventListener('change', async () => {
        await store.assign(sunday.date, pos.id, sel.value || null);
        render();
      });
      row.appendChild(sel);
      card.appendChild(row);
    }
    view.appendChild(card);
  }
}

// -- Tab: Voting / Practices ---------------------------------------------

function voting() {
  view.appendChild(el(`<h2 class="section-title">🗳️ Practice Scheduling</h2>`));
  view.appendChild(el(`<p class="section-sub">One weekday + one after-church practice per month, chosen by majority vote (${majorityThreshold()} of ${voterCount()} needed). Locked dates need a new vote to change.</p>`));

  for (const mKey of seasonMonths()) {
    const [y, m] = mKey.split('-').map(Number);
    view.appendChild(el(`<h3 class="section-title" style="font-size:.98rem;margin-top:6px">${MONTHS[m - 1]} ${y}</h3>`));

    for (const type of PRACTICE_TYPES) {
      const block = state.practices[mKey][type.id];
      const card = el(`<div class="card"></div>`);
      card.appendChild(el(`
        <div class="card__head">
          <span class="card__title">${type.name}</span>
          ${block.lockedDate
            ? `<span class="badge badge--ok">🔒 ${fmtShort(block.lockedDate)}</span>`
            : `<span class="badge badge--warn">Voting open</span>`}
        </div>`));
      card.appendChild(el(`<div class="card__meta">${type.hint}</div>`));

      const { leader, hasMajority } = tallyLeader(block);

      for (const c of block.candidates) {
        const pct = voterCount() ? Math.round((c.votes.length / voterCount()) * 100) : 0;
        const iVoted = c.votes.includes(state.currentUserId);
        const locked = block.lockedDate === c.date;
        const leading = !block.lockedDate && leader && leader.date === c.date && c.votes.length > 0;
        const opt = el(`
          <div class="vote-option ${locked ? 'is-locked' : leading ? 'is-leading' : ''}">
            <div style="flex:1">
              <div class="vote-option__date">${fmtLong(c.date)}</div>
              <div class="vote-option__bar"><span style="width:${pct}%"></span></div>
            </div>
            <div class="vote-option__right">
              <span class="vote-count">${c.votes.length} vote${c.votes.length === 1 ? '' : 's'}</span>
            </div>
          </div>`);
        if (!block.lockedDate) {
          const btn = el(`<button class="btn btn--sm ${iVoted ? 'btn--primary' : ''}">${iVoted ? '✓ Voted' : 'Vote'}</button>`);
          btn.addEventListener('click', async () => { await store.vote(mKey, type.id, c.date); render(); });
          opt.querySelector('.vote-option__right').appendChild(btn);
        }
        card.appendChild(opt);
      }

      // Controls
      const controls = el(`<div class="btn-row" style="margin-top:10px"></div>`);
      if (block.lockedDate) {
        controls.appendChild(el(`<span class="locked-note" style="flex:1">🔒 Set for ${fmtLong(block.lockedDate)} — fixed until a new vote.</span>`));
        if (isLeader()) {
          const nv = el(`<button class="btn btn--sm btn--danger">Call new vote</button>`);
          nv.addEventListener('click', () => {
            confirmModal('Call a new vote?', 'This clears the locked date and all current votes for this practice.', async () => {
              await store.newVote(mKey, type.id); render();
            });
          });
          controls.appendChild(nv);
        }
      } else if (isLeader()) {
        const lock = el(`<button class="btn btn--sm btn--primary" ${hasMajority ? '' : 'disabled'}>Lock majority${leader && leader.votes.length ? ` (${fmtShort(leader.date)})` : ''}</button>`);
        lock.addEventListener('click', async () => { if (await store.lock(mKey, type.id)) render(); });
        controls.appendChild(lock);
      } else {
        controls.appendChild(el(`<span class="card__meta">A leader locks the date once the majority is in.</span>`));
      }
      card.appendChild(controls);
      view.appendChild(card);
    }
  }
}

// -- Tab: Songs & Chords --------------------------------------------------

function songs() {
  view.appendChild(el(`<h2 class="section-title">🎸 Song List & Chords</h2>`));
  view.appendChild(el(`<p class="section-sub">Leaders post the weekly list; anyone can pull chords or send musicians a practice reminder.</p>`));

  for (const mKey of seasonMonths()) {
    const [y, m] = mKey.split('-').map(Number);
    const list = songsFor(mKey);
    const card = el(`<div class="card"></div>`);
    card.appendChild(el(`
      <div class="card__head">
        <span class="card__title">${MONTHS[m - 1]} ${y}</span>
        <span class="badge badge--muted">${list.length} song${list.length === 1 ? '' : 's'}</span>
      </div>`));

    if (!list.length) {
      card.appendChild(el(`<div class="card__meta">No songs posted yet.</div>`));
    }
    for (const song of list) {
      const item = el(`<div class="song-item"></div>`);
      item.appendChild(el(`
        <div>
          <div class="song-item__title">${esc(song.title)}</div>
          <div class="song-item__key">Key: ${esc(song.key || '—')}</div>
        </div>`));
      const actions = el(`<div class="song-actions"></div>`);
      const chords = el(`<a class="btn btn--sm" target="_blank" rel="noopener noreferrer" href="${chordsUrl(song)}">🎼 Chords</a>`);
      const remind = el(`<button class="btn btn--sm">🔔 Remind</button>`);
      remind.addEventListener('click', () => remindSongPractice(mKey, song));
      actions.appendChild(chords);
      actions.appendChild(remind);
      if (isLeader()) {
        const del = el(`<button class="btn btn--sm btn--danger">✕</button>`);
        del.addEventListener('click', async () => {
          await store.deleteSong(mKey, song.id); render();
        });
        actions.appendChild(del);
      }
      item.appendChild(actions);
      card.appendChild(item);
    }

    if (isLeader()) {
      const add = el(`<button class="btn btn--sm btn--ghost btn--block" style="margin-top:8px">＋ Add song</button>`);
      add.addEventListener('click', () => addSongModal(mKey));
      card.appendChild(add);
    }
    view.appendChild(card);
  }
}

function addSongModal(mKey) {
  const body = el(`
    <div>
      <label class="field" for="song-title">Song title</label>
      <input id="song-title" type="text" placeholder="e.g. Great Are You Lord" />
      <label class="field" for="song-key">Key (optional)</label>
      <input id="song-key" type="text" placeholder="e.g. G" />
    </div>`);
  openModal('Add a song', body, () => {
    const title = body.querySelector('#song-title').value.trim();
    const key = body.querySelector('#song-key').value.trim();
    if (!title) { toast('Enter a song title.'); return false; }
    store.addSong(mKey, title, key).then(() => { render(); toast('Song added.'); });
    return true;  // close the modal immediately; the store call resolves async
  });
}

// -- Tab: Reminders -------------------------------------------------------

function reminders() {
  view.appendChild(el(`<h2 class="section-title">🔔 Reminders</h2>`));

  const notifyCard = el(`<div class="card"></div>`);
  notifyCard.appendChild(el(`
    <div class="card__head">
      <span class="card__title">Device notifications</span>
      <span class="badge ${state.notifyEnabled ? 'badge--ok' : 'badge--muted'}">${state.notifyEnabled ? 'On' : 'Off'}</span>
    </div>`));
  notifyCard.appendChild(el(`<div class="card__meta">Get a pop-up for reminders due today while the app is open.</div>`));
  const enable = el(`<button class="btn btn--sm btn--primary btn--block" style="margin-top:10px">${state.notifyEnabled ? 'Notifications enabled' : 'Enable notifications'}</button>`);
  enable.disabled = state.notifyEnabled;
  enable.addEventListener('click', requestNotify);
  notifyCard.appendChild(enable);
  view.appendChild(notifyCard);

  const groups = [
    ['due', 'Due today', '⏰'],
    ['upcoming', 'Upcoming', '📌'],
    ['past', 'Overdue', '⚠️'],
    ['done', 'Done', '✅'],
  ];
  const sorted = [...state.reminders].sort((a, b) => a.date.localeCompare(b.date));

  for (const [status, label, icon] of groups) {
    const items = sorted.filter((r) => reminderStatus(r) === status);
    if (!items.length) continue;
    const card = el(`<div class="card"></div>`);
    card.appendChild(el(`<div class="card__head"><span class="card__title">${icon} ${label}</span><span class="badge badge--muted">${items.length}</span></div>`));
    for (const r of items.slice(0, status === 'done' ? 8 : 60)) {
      const st = reminderStatus(r);
      const row = el(`<div class="reminder ${st === 'due' ? 'is-due' : ''} ${st === 'past' ? 'is-past' : ''}"></div>`);
      row.appendChild(el(`<div class="reminder__dot">${r.audience === 'leaders' ? '📝' : r.type === 'song' ? '🎵' : '🎸'}</div>`));
      const bodyEl = el(`
        <div class="reminder__body">
          <div class="reminder__title">${esc(r.title)}</div>
          <div class="reminder__when">${fmtLong(r.date)} · ${r.audience === 'leaders' ? 'Leaders' : 'Musicians'}</div>
          <div class="card__meta">${esc(r.detail || '')}</div>
        </div>`);
      row.appendChild(bodyEl);
      const toggle = el(`<button class="btn btn--sm">${r.done ? 'Undo' : 'Done'}</button>`);
      toggle.addEventListener('click', () => { r.done = !r.done; save(); render(); });
      row.appendChild(toggle);
      card.appendChild(row);
    }
    view.appendChild(card);
  }

  if (!state.reminders.length) {
    view.appendChild(el(`<div class="empty"><div class="empty__icon">🔔</div><p>No reminders yet.</p></div>`));
  }
}

// -- Tab: Team ------------------------------------------------------------

function team() {
  view.appendChild(el(`<h2 class="section-title">👥 Team</h2>`));
  view.appendChild(el(`<p class="section-sub">${state.members.length} members. Leaders manage songs, lock practice dates and get the Wednesday song-list nudge.</p>`));

  // In cloud mode, members join with the team's invite code — show it so a
  // leader can share it, rather than adding members manually.
  if (CLOUD) {
    const t = RosterAPI.team();
    if (t && t.inviteCode) {
      const inv = el(`<div class="card"></div>`);
      inv.appendChild(el(`<div class="card__head"><span class="card__title">Invite code</span><span class="badge">${esc(t.role || 'member')}</span></div>`));
      inv.appendChild(el(`<div class="card__meta">Send teammates the invite link below — it opens the app ready to join "${esc(t.teamName || 'the team')}", with "start a new team" disabled so nobody creates a duplicate.</div>`));
      inv.appendChild(el(`<div style="font-size:1.4rem;font-weight:700;letter-spacing:2px;text-align:center;margin:10px 0">${esc(t.inviteCode)}</div>`));

      // Full join link: current page URL + ?join=CODE (no query/hash carried over).
      const teamName = t.teamName || 'our worship team';
      const inviteLink = location.origin + location.pathname + '?join=' + encodeURIComponent(t.inviteCode);
      // A clean, professional message to share alongside the link.
      const inviteMsg =
        `🎵 ${BRAND} — Worship Team\n\n` +
        `You're invited to join ${teamName}. Tap the link below on your phone to join — you'll just enter your name:\n${inviteLink}\n\n` +
        `Once you're in you'll see the schedule, song lists and practice reminders.`;

      inv.appendChild(el(`<div class="card__meta" style="word-break:break-all;background:#f3f4f6;border-radius:8px;padding:8px;margin-bottom:8px">${esc(inviteLink)}</div>`));

      const shareBtn = el(`<button class="btn btn--sm btn--primary btn--block" style="margin-bottom:8px">Share invite</button>`);
      shareBtn.addEventListener('click', async () => {
        try {
          if (navigator.share) {
            await navigator.share({ title: `Join ${teamName}`, text: inviteMsg });
          } else {
            await navigator.clipboard.writeText(inviteMsg); toast('Invite message copied — paste it into WhatsApp, SMS or email.');
          }
        } catch (_) {
          try { await navigator.clipboard.writeText(inviteMsg); toast('Invite message copied.'); }
          catch (e2) { toast('Copy failed — long-press the link above to copy.'); }
        }
      });
      inv.appendChild(shareBtn);

      const copyMsg = el(`<button class="btn btn--sm btn--block" style="margin-bottom:8px">Copy invite message</button>`);
      copyMsg.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(inviteMsg); toast('Invite message copied.'); }
        catch (_) { toast('Copy failed — long-press the link above to copy.'); }
      });
      inv.appendChild(copyMsg);

      const copy = el(`<button class="btn btn--sm btn--block">Copy code only</button>`);
      copy.addEventListener('click', () => {
        navigator.clipboard && navigator.clipboard.writeText(t.inviteCode);
        toast('Invite code copied.');
      });
      inv.appendChild(copy);
      view.appendChild(inv);
    }
  }

  const card = el(`<div class="card"></div>`);
  for (const m of state.members) {
    const row = el(`<div class="member"></div>`);
    const posNames = m.positions.map((p) => (POSITIONS.find((x) => x.id === p) || {}).name).filter(Boolean).join(', ');
    row.appendChild(el(`
      <div>
        <div class="member__name">${esc(m.name)} ${m.isLeader ? '<span class="badge">Leader</span>' : ''}</div>
        <div class="member__pos">${esc(posNames || 'No position set')}</div>
      </div>`));
    if (!CLOUD) {
      const actions = el(`<div class="btn-row"></div>`);
      const edit = el(`<button class="btn btn--sm">Edit</button>`);
      edit.addEventListener('click', () => memberModal(m));
      actions.appendChild(edit);
      row.appendChild(actions);
    }
    card.appendChild(row);
  }
  view.appendChild(card);

  if (!CLOUD) {
    const add = el(`<button class="btn btn--primary btn--block">＋ Add team member</button>`);
    add.addEventListener('click', () => memberModal(null));
    view.appendChild(add);
  } else {
    const out = el(`<button class="btn btn--danger btn--block">Sign out of this team</button>`);
    out.addEventListener('click', () => {
      confirmModal('Sign out?', 'This device will disconnect from the shared team. You can rejoin with the invite code.', () => {
        RosterAPI.clearSession(); location.reload();
      });
    });
    view.appendChild(out);
  }
}

function memberModal(existing) {
  const m = existing || { name: '', isLeader: false, positions: [] };
  const posChecks = POSITIONS.map((p) => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-weight:500">
      <input type="checkbox" value="${p.id}" ${m.positions.includes(p.id) ? 'checked' : ''} style="width:auto" />
      <span>${p.icon} ${p.name}</span>
    </label>`).join('');
  const body = el(`
    <div>
      <label class="field" for="mem-name">Name</label>
      <input id="mem-name" type="text" value="${esc(m.name)}" placeholder="Full name" />
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-weight:600">
        <input id="mem-leader" type="checkbox" ${m.isLeader ? 'checked' : ''} style="width:auto" /> Team leader
      </label>
      <label class="field">Positions</label>
      ${posChecks}
    </div>`);

  const onSave = () => {
    const name = body.querySelector('#mem-name').value.trim();
    if (!name) { toast('Enter a name.'); return false; }
    const positions = [...body.querySelectorAll('input[type=checkbox]:checked')]
      .map((c) => c.value).filter((v) => v !== 'on');
    const isLeaderChecked = body.querySelector('#mem-leader').checked;
    if (existing) {
      existing.name = name; existing.isLeader = isLeaderChecked; existing.positions = positions;
    } else {
      state.members.push({ id: uid('m'), name, isLeader: isLeaderChecked, positions });
    }
    save(); render();
    return true;
  };

  const extra = existing && state.members.length > 1
    ? { label: 'Remove', danger: true, onClick: () => {
        state.members = state.members.filter((x) => x.id !== existing.id);
        // clean up votes & assignments referencing this member
        for (const mKey of Object.keys(state.practices))
          for (const t of Object.keys(state.practices[mKey]))
            for (const c of state.practices[mKey][t].candidates)
              c.votes = c.votes.filter((v) => v !== existing.id);
        for (const s of state.sundays)
          for (const p of Object.keys(s.assignments))
            if (s.assignments[p] === existing.id) delete s.assignments[p];
        if (state.currentUserId === existing.id) state.currentUserId = state.members[0].id;
        save(); render();
      } }
    : null;

  openModal(existing ? 'Edit member' : 'Add member', body, onSave, extra);
}

/* -------------------------------------------------------------------------- *
 * Modal + toast + notifications
 * -------------------------------------------------------------------------- */

function openModal(title, bodyEl, onSave, extra) {
  const backdrop = el(`<div class="modal-backdrop"></div>`);
  const modal = el(`<div class="modal"><h3 class="modal__title">${esc(title)}</h3></div>`);
  modal.appendChild(bodyEl);
  const row = el(`<div class="btn-row" style="margin-top:16px;justify-content:flex-end"></div>`);
  if (extra) {
    const b = el(`<button class="btn btn--sm ${extra.danger ? 'btn--danger' : ''}" style="margin-right:auto">${esc(extra.label)}</button>`);
    b.addEventListener('click', () => { close(); extra.onClick(); });
    row.appendChild(b);
  }
  const cancel = el(`<button class="btn btn--sm">Cancel</button>`);
  const ok = el(`<button class="btn btn--sm btn--primary">Save</button>`);
  cancel.addEventListener('click', close);
  ok.addEventListener('click', () => { if (onSave() !== false) close(); });
  row.appendChild(cancel); row.appendChild(ok);
  modal.appendChild(row);
  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  function close() { backdrop.remove(); }
}

function confirmModal(title, message, onYes) {
  const body = el(`<div><p class="card__meta">${esc(message)}</p></div>`);
  openModal(title, body, () => { onYes(); return true; });
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function requestNotify() {
  if (!('Notification' in window)) { toast('Notifications not supported here.'); return; }
  Notification.requestPermission().then(async (perm) => {
    if (perm === 'granted') {
      state.notifyEnabled = true;
      localStorage.setItem('worship-roster-notify', '1');
      save();
      if (CLOUD) await subscribeCloudPush();
      render();
      fireDueNotifications();
      toast('Notifications enabled.');
    } else {
      toast('Permission denied.');
    }
  });
}

/** Register a Web Push subscription with the server (cloud mode only). */
async function subscribeCloudPush() {
  try {
    if (!CFG.vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(CFG.vapidPublicKey),
    });
    await RosterAPI.subscribePush(sub.toJSON());
  } catch (e) {
    toast('Push setup failed: ' + (e.message || e));
  }
}

function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function fireDueNotifications() {
  if (!state.notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const due = state.reminders.filter((r) => !r.done && reminderStatus(r) === 'due');
  if (due.length) {
    new Notification(`Worship Team: ${due.length} reminder${due.length === 1 ? '' : 's'} due today`, {
      body: due.slice(0, 3).map((r) => '• ' + r.title).join('\n'),
    });
  }
}

/* -------------------------------------------------------------------------- *
 * 6. Event wiring & bootstrap
 * -------------------------------------------------------------------------- */

document.querySelectorAll('.tabbar__btn').forEach((btn) => {
  btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(); });
});

document.getElementById('current-user').addEventListener('change', (e) => {
  if (CLOUD) return;                       // no member switching in cloud mode
  state.currentUserId = e.target.value;
  save(); render();
});

function setChromeVisible(visible) {
  const tabbar = document.querySelector('.tabbar');
  const userSel = document.getElementById('current-user');
  if (tabbar) tabbar.style.display = visible ? '' : 'none';
  if (userSel) userSel.style.visibility = visible ? '' : 'hidden';
}

/** Cloud connect screen: create a new team or join one with an invite code. */
function renderConnect() {
  document.getElementById('season-label').textContent = `Season: ${SEASON.label}`;
  setChromeVisible(false);
  view.innerHTML = '';

  // An invite link carries the team code as ?join=CODE. When present, we only
  // let the person JOIN (creating a new team is greyed out) so invitees can't
  // accidentally start a competing team.
  const invitedCode = (new URLSearchParams(location.search).get('join') || '').trim().toUpperCase();
  const invited = !!invitedCode;

  view.appendChild(el(`
    <div style="text-align:center;margin:8px 0 16px">
      <div style="font-size:1.35rem;font-weight:800;color:var(--brand-dark);letter-spacing:.3px">${esc(BRAND)}</div>
      <div style="font-size:.8rem;color:var(--muted);font-style:italic;margin-top:2px">${esc(TAGLINE)}</div>
      <div style="font-size:.9rem;font-weight:600;color:var(--brand);margin-top:8px">🎵 Worship Team Roster</div>
    </div>`));
  view.appendChild(el(invited
    ? `<p class="section-sub">You've been invited to join the ${esc(BRAND)} worship team. Enter your name below to join.</p>`
    : `<p class="section-sub">Create a shared roster, or join your team with the invite code they gave you. Your phone stays signed in.</p>`));

  // ---- Join ----
  const joinCard = el(`<div class="card"></div>`);
  joinCard.appendChild(el(`<div class="card__title">Join a team</div>`));
  const joinBody = el(`
    <div>
      <label class="field" for="join-code">Invite code</label>
      <input id="join-code" type="text" autocapitalize="characters" placeholder="ABCDE-FGHJ" value="${esc(invitedCode)}" ${invited ? 'readonly' : ''} />
      <label class="field" for="join-name">Your name</label>
      <input id="join-name" type="text" placeholder="e.g. David" />
    </div>`);
  joinCard.appendChild(joinBody);
  const joinBtn = el(`<button class="btn btn--primary btn--block" style="margin-top:12px">Join team</button>`);
  joinBtn.addEventListener('click', async () => {
    const code = joinBody.querySelector('#join-code').value.trim();
    const name = joinBody.querySelector('#join-name').value.trim();
    if (!code || !name) { toast('Enter the invite code and your name.'); return; }
    joinBtn.disabled = true;
    try { await RosterAPI.joinTeam(code, name); await afterConnect(); }
    catch (e) { toast(e.message); joinBtn.disabled = false; }
  });
  joinCard.appendChild(joinBtn);
  view.appendChild(joinCard);
  if (invited) setTimeout(() => { const n = joinBody.querySelector('#join-name'); n && n.focus(); }, 0);

  // ---- Create (greyed out when arriving via an invite link) ----
  const createCard = el(`<div class="card"></div>`);
  if (invited) createCard.style.cssText = 'opacity:.5;pointer-events:none';
  createCard.setAttribute('aria-disabled', invited ? 'true' : 'false');
  createCard.appendChild(el(`<div class="card__title">Start a new team</div>`));
  if (invited) createCard.appendChild(el(`<div class="card__meta">Disabled — you're joining an existing team via your invite link.</div>`));
  const createBody = el(`
    <div>
      <label class="field" for="team-name">Team name</label>
      <input id="team-name" type="text" placeholder="e.g. Grace Worship" ${invited ? 'disabled' : ''} />
      <label class="field" for="leader-name">Your name (team leader)</label>
      <input id="leader-name" type="text" placeholder="e.g. Naomi" ${invited ? 'disabled' : ''} />
    </div>`);
  createCard.appendChild(createBody);
  const createBtn = el(`<button class="btn btn--block" style="margin-top:12px" ${invited ? 'disabled' : ''}>Create team</button>`);
  createBtn.addEventListener('click', async () => {
    const teamName = createBody.querySelector('#team-name').value.trim();
    const leaderName = createBody.querySelector('#leader-name').value.trim();
    if (!teamName || !leaderName) { toast('Enter a team name and your name.'); return; }
    createBtn.disabled = true;
    try {
      const d = await RosterAPI.createTeam(teamName, leaderName);
      await afterConnect();
      toast(`Team created — invite code ${d.inviteCode}`);
    } catch (e) { toast(e.message); createBtn.disabled = false; }
  });
  createCard.appendChild(createBtn);
  view.appendChild(createCard);
}

async function afterConnect() {
  await syncFromCloud();
  setChromeVisible(true);
  activeTab = 'roster';
  render();
}

async function boot() {
  if (CLOUD) {
    if (!RosterAPI.hasSession()) { renderConnect(); return; }
    try { await syncFromCloud(); }
    catch (e) { toast(e.message || 'Could not reach the server.'); renderConnect(); return; }
    setChromeVisible(true);
    render();
    fireDueNotifications();
  } else {
    render();
    fireDueNotifications();
  }
}

boot();

// Register the service worker so the app installs and runs offline on Android.
// Kept here (not inline in HTML) so the page can enforce a strict
// `script-src 'self'` Content-Security-Policy with no inline-script allowance.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline install optional */ });
  });
}
