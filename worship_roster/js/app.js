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

// Build stamp — shown in the header so you can confirm the phone loaded the
// latest version (rather than an old cached one). Bump on notable changes.
const APP_VERSION = 'v6 · 2026-07-29';

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

// Extra worship-leader slots, added on demand (a service can have several
// leaders). The primary is POSITIONS 'lead'; these are the co-leaders.
const CO_LEAD_SLOTS = ['lead2', 'lead3', 'lead4', 'lead5'];

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

// Platform detection (for install / notification guidance).
const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /android/i.test(navigator.userAgent);
const IS_STANDALONE = (window.navigator.standalone === true) ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

let state = CLOUD ? emptyState() : load();
let activeTab = 'home';

function emptyState() {
  // Placeholder until the first cloud sync populates real data.
  return { version: 1, currentUserId: null, members: [], sundays: buildSundays(),
    practices: buildPractices(), reminders: [], songs: {}, library: [], devotionals: [],
    myLog: [], myFlags: [], notifyEnabled: false, cloud: true };
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
    songs: {},                 // keyed by service date -> [ {id,title,key,link} ]
    library: [],               // future songs to learn
    devotionals: [],           // shared devotionals
    myLog: [],                 // personal prayer/word logs
    myFlags: [],               // devotion reads + ministry check-ins
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
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
}
/** ISO date `n` days before the given ISO date. */
function daysAgoFrom(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() - n);
  return toISO(d);
}
/** Full month + year label for an ISO date, e.g. "July 2026". */
function monthName(iso) {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Weekly targets used to score "Your Spiritual Journey".
const KPI = { prayerWeekTarget: 60, wordWeekTarget: 90, devotionTarget: 3 };
const MINISTRY_MARKERS = [
  { id: 'songlist', label: 'Posted the song list on time' },
  { id: 'prep', label: 'On time for worship prep on Sunday' },
  { id: 'practice', label: 'Attended practice' },
  { id: 'contributes', label: 'Contributed to the team' },
];

// Personal Sunday-preparation checklist shown on the Home landing page. Ticks
// are private to each device and reset every ministry week (keyed by Sunday).
const PREP_CHECKLIST = [
  { title: 'During the Week', items: [
    { id: 'w1', label: 'Spend personal time in prayer and Scripture' },
    { id: 'w2', label: 'Keep your heart free from offence and unresolved conflict' },
    { id: 'w3', label: 'Pray for the congregation and the Sunday service' },
    { id: 'w4', label: 'Listen to and learn all assigned songs' },
    { id: 'w5', label: 'Practise your chords, lyrics, harmonies and parts' },
    { id: 'w6', label: 'Understand the biblical message of each song' },
    { id: 'w7', label: 'Confirm keys, arrangements, transitions and responsibilities' },
    { id: 'w8', label: 'Communicate any challenges to the worship leader early' },
  ] },
  { title: 'Before Sunday', items: [
    { id: 'b1', label: 'Prepare your clothing and equipment' },
    { id: 'b2', label: 'Charge devices and check instruments' },
    { id: 'b3', label: 'Rest properly and avoid unnecessary distractions' },
    { id: 'b4', label: 'Arrive spiritually prepared, not only musically prepared' },
  ] },
  { title: 'On Sunday', items: [
    { id: 's1', label: 'Arrive early and on time' },
    { id: 's2', label: 'Set up and sound-check quickly' },
    { id: 's3', label: 'Participate fully in team prayer' },
    { id: 's4', label: 'Honour the worship leader and follow direction' },
    { id: 's5', label: 'Stay sensitive to the Holy Spirit' },
    { id: 's6', label: 'Focus on Jesus, not performance' },
    { id: 's7', label: 'Help the congregation worship rather than drawing attention to yourself' },
  ] },
];
const PREP_QUOTE = 'Worship begins long before the first song is played.';
const PREP_TOTAL = PREP_CHECKLIST.reduce((n, s) => n + s.items.length, 0);

const PREP_ITEM_IDS = new Set(PREP_CHECKLIST.flatMap((s) => s.items.map((i) => i.id)));

/** localStorage key for a week's personal prep ticks (per signed-in member). */
function prepKey(sunday) {
  const who = CLOUD ? ((currentUser() && currentUser().id) || 'me') : (state.currentUserId || 'me');
  return `worship-roster-prep:${who}:${sunday || currentServiceSunday()}`;
}
function getPrepChecks(sunday) {
  try { return new Set(JSON.parse(localStorage.getItem(prepKey(sunday)) || '[]')); }
  catch (_) { return new Set(); }
}
function togglePrep(id, sunday) {
  const set = getPrepChecks(sunday);
  set.has(id) ? set.delete(id) : set.add(id);
  try { localStorage.setItem(prepKey(sunday), JSON.stringify([...set])); }
  catch (_) { toast('Could not save — storage may be full.'); }
}
/** How many valid prep items are ticked for a given service Sunday. */
function prepDoneFor(sunday) {
  return [...getPrepChecks(sunday)].filter((id) => PREP_ITEM_IDS.has(id)).length;
}

function ratingFor(score) {
  if (score >= 85) return { label: 'On fire 🔥', color: 'var(--ok)', bg: 'var(--ok-soft)' };
  if (score >= 65) return { label: 'Strong 💪', color: 'var(--brand-dark)', bg: 'var(--brand-soft)' };
  if (score >= 40) return { label: 'Growing 🌱', color: 'var(--warn)', bg: 'var(--warn-soft)' };
  return { label: 'Getting started', color: 'var(--muted)', bg: '#f3f4f6' };
}

/** The Sunday that anchors the current ministry week (upcoming, or today). */
function currentServiceSunday() {
  return seasonSundays().find((d) => d >= todayISO()) || (seasonSundays().slice(-1)[0] || todayISO());
}

/** Compute both KPI scores for the signed-in member.
 * Defaults to the current ministry week; pass { sunday, since, until } to score
 * a specific past week (used by the weekly/monthly review). */
function computeKpis(opts) {
  const sunday = (opts && opts.sunday) || currentServiceSunday();
  const since = (opts && opts.since) || daysAgoISO(6);
  const until = (opts && opts.until) || null;
  const log = (state.myLog || []).filter((e) => e.date >= since && (!until || e.date <= until));
  const prayerMin = log.filter((e) => e.kind === 'prayer').reduce((a, e) => a + (e.minutes || 0), 0);
  const wordMin = log.filter((e) => e.kind === 'word').reduce((a, e) => a + (e.minutes || 0), 0);

  const devs = state.devotionals || [];
  const flags = new Set(state.myFlags || []);
  const readCount = devs.filter((d) => flags.has('read:' + d.id)).length;
  const devTarget = Math.max(1, Math.min(devs.length || KPI.devotionTarget, KPI.devotionTarget));

  const prayerPct = Math.min(1, prayerMin / KPI.prayerWeekTarget);
  const wordPct = Math.min(1, wordMin / KPI.wordWeekTarget);
  const devPct = Math.min(1, readCount / devTarget);
  const spiritual = Math.round(((prayerPct + wordPct + devPct) / 3) * 100);

  const ministryChecks = MINISTRY_MARKERS.map((m) => ({ ...m, on: flags.has(`ministry:${sunday}:${m.id}`) }));
  const checkedCount = ministryChecks.filter((c) => c.on).length;
  const ministry = Math.round(((checkedCount + spiritual / 100) / (MINISTRY_MARKERS.length + 1)) * 100);

  return { prayerMin, wordMin, readCount, devTarget, prayerPct, wordPct, devPct, spiritual, ministryChecks, checkedCount, ministry, sunday };
}

/* -------------------------------------------------------------------------- *
 * Weekly (Monday) & month-end review + coaching
 * -------------------------------------------------------------------------- */

function isMonday() { return new Date().getDay() === 1; }
function isLastDayOfMonth() {
  const d = new Date();
  const t = new Date(d); t.setDate(d.getDate() + 1);
  return t.getMonth() !== d.getMonth();
}
/** The most recent service Sunday on or before today (the week just finished). */
function mostRecentSunday() {
  const past = seasonSundays().filter((d) => d <= todayISO());
  return past.length ? past[past.length - 1] : (seasonSundays()[0] || todayISO());
}
/** All service Sundays that fall in the same calendar month as `iso`. */
function sundaysInMonthOf(iso) {
  const ym = iso.slice(0, 7);
  return seasonSundays().filter((d) => d.slice(0, 7) === ym);
}

/** A full review for one service week: preparation + spiritual + ministry,
 * an overall rating, per-dimension percentages, and targeted coaching notes. */
function reviewFor(sunday) {
  const k = computeKpis({ sunday, since: daysAgoFrom(sunday, 6), until: sunday });
  const prepDone = prepDoneFor(sunday);
  const prepPct = PREP_TOTAL ? prepDone / PREP_TOTAL : 0;
  const ministryPct = MINISTRY_MARKERS.length ? k.checkedCount / MINISTRY_MARKERS.length : 0;
  const overall = Math.round((prepPct * 100 + k.spiritual + k.ministry) / 3);
  const empty = prepDone === 0 && k.prayerMin === 0 && k.wordMin === 0 && k.readCount === 0 && k.checkedCount === 0;
  const pcts = { prepPct, prayerPct: k.prayerPct, wordPct: k.wordPct, devPct: k.devPct,
    ministryPct, spiritual: k.spiritual, ministry: k.ministry };
  return {
    sunday, prepDone, prepTotal: PREP_TOTAL, prepPct,
    spiritual: k.spiritual, ministry: k.ministry, overall, pcts,
    prayerMin: k.prayerMin, wordMin: k.wordMin, readCount: k.readCount, devTarget: k.devTarget,
    checkedCount: k.checkedCount, ministryTotal: MINISTRY_MARKERS.length,
    rating: ratingFor(overall), empty, notes: coachingNotes(pcts),
  };
}

/** Aggregate the weekly reviews across a month into one month-end summary. */
function monthlyReview(anchorISO) {
  const reviews = sundaysInMonthOf(anchorISO).map(reviewFor);
  const mean = (sel) => reviews.length ? reviews.reduce((a, r) => a + sel(r), 0) / reviews.length : 0;
  const prepAvg = Math.round(mean((r) => r.prepPct * 100));
  const spiritualAvg = Math.round(mean((r) => r.spiritual));
  const ministryAvg = Math.round(mean((r) => r.ministry));
  const overall = Math.round((prepAvg + spiritualAvg + ministryAvg) / 3);
  const activeWeeks = reviews.filter((r) => !r.empty).length;
  const empty = activeWeeks === 0;
  // Average each dimension's percentage so the coaching notes stay accurate.
  const pcts = {
    prepPct: mean((r) => r.pcts.prepPct),
    prayerPct: mean((r) => r.pcts.prayerPct),
    wordPct: mean((r) => r.pcts.wordPct),
    devPct: mean((r) => r.pcts.devPct),
    ministryPct: mean((r) => r.pcts.ministryPct),
    spiritual: spiritualAvg, ministry: ministryAvg,
  };
  const notes = coachingNotes(pcts);
  if (!empty) {
    notes.unshift(activeWeeks === reviews.length
      ? { icon: '🗓️', text: `Consistent all month — you engaged in all ${reviews.length} weeks. Consistency is the mark of a faithful worshipper.` }
      : { icon: '🗓️', text: `You were active in ${activeWeeks} of ${reviews.length} weeks this month. Aim for every week — steady rhythm beats occasional effort.` });
  }
  return {
    month: monthName(anchorISO), weeks: reviews.length, activeWeeks,
    prepAvg, spiritualAvg, ministryAvg, overall, rating: ratingFor(overall), empty, notes,
  };
}

/** Turn per-dimension percentages (0..1) into a short list of specific,
 * encouraging coaching notes. Works for both a single week and a month. */
function coachingNotes(p) {
  const notes = [];
  // Preparation
  if (p.prepPct >= 0.85) notes.push({ icon: '✅', text: 'Outstanding preparation — you worked through almost the whole checklist. Keep this rhythm.' });
  else if (p.prepPct >= 0.4) notes.push({ icon: '📝', text: 'Solid start on preparation. Complete the “During the Week” items early so Sunday feels effortless.' });
  else if (p.prepPct > 0) notes.push({ icon: '📝', text: 'Preparation was light. Block midweek time to learn songs, keys and parts before Sunday.' });
  else notes.push({ icon: '📝', text: 'No preparation recorded. Start early next week: prayer, learning the songs, and confirming your parts.' });
  // Spiritual journey
  if (p.prayerPct <= 0) notes.push({ icon: '🙏', text: 'No prayer logged. Even 10 minutes a day in the Spirit builds strength for ministry.' });
  else if (p.prayerPct < 1) notes.push({ icon: '🙏', text: 'Grow your prayer in the Spirit — you’re close to the goal; a little more each day gets you there.' });
  if (p.wordPct <= 0) notes.push({ icon: '📖', text: 'No time in the Word logged. Let Scripture shape your worship — start with 15 minutes.' });
  else if (p.wordPct < 1) notes.push({ icon: '📖', text: 'Add a little more time in the Word to reach your goal.' });
  if (p.devPct <= 0) notes.push({ icon: '🕮', text: 'Read the team devotions — they keep the whole team spiritually aligned.' });
  // Ministry excellence
  if (p.ministryPct <= 0) notes.push({ icon: '⭐', text: 'Mark your ministry commitments — arriving on time, joining team prayer and contributing all count.' });
  else if (p.ministryPct >= 1) notes.push({ icon: '⭐', text: 'Excellent — punctual, prayerful and contributing. Keep modelling this for the team.' });
  // Encouragement when everything is strong
  if (p.prepPct >= 0.7 && p.spiritual >= 65 && p.ministry >= 65) {
    notes.push({ icon: '🔥', text: 'You’re thriving across preparation, spirit and ministry — a real blessing to the team. Press on!' });
  }
  return notes.slice(0, 5);
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
  async addSong(mKey, title, key, link) {
    if (!state.songs[mKey]) state.songs[mKey] = [];
    state.songs[mKey].push({ id: uid('s'), title, key, link: link || '' }); save();
  },
  async editSong(id, fields) {
    for (const mk of Object.keys(state.songs)) {
      const s = (state.songs[mk] || []).find((x) => x.id === id);
      if (s) Object.assign(s, fields);
    }
    save();
  },
  async deleteSong(mKey, id) { state.songs[mKey] = (state.songs[mKey] || []).filter((x) => x.id !== id); save(); },
  async addLib(fields) { (state.library = state.library || []).unshift(Object.assign({ id: uid('l') }, fields)); save(); },
  async updateLib(id, fields) { const l = (state.library || []).find((x) => x.id === id); if (l) Object.assign(l, fields); save(); },
  async deleteLib(id) { state.library = (state.library || []).filter((x) => x.id !== id); save(); },
  async addDev(fields) { (state.devotionals = state.devotionals || []).unshift(Object.assign({ id: uid('d'), author: (currentUser() || {}).name || '', date: todayISO(), reads: 0 }, fields)); save(); },
  async updateDev(id, fields) { const d = (state.devotionals || []).find((x) => x.id === id); if (d) Object.assign(d, fields); save(); },
  async deleteDev(id) { state.devotionals = (state.devotionals || []).filter((x) => x.id !== id); save(); },
  async log(kind, minutes) { (state.myLog = state.myLog || []).push({ date: todayISO(), kind, minutes }); save(); },
  async flag(key, on) {
    state.myFlags = state.myFlags || [];
    if (on === false) state.myFlags = state.myFlags.filter((k) => k !== key);
    else if (!state.myFlags.includes(key)) state.myFlags.push(key);
    // Reflect a devotion read in the local read count.
    if (key.startsWith('read:')) { const d = (state.devotionals || []).find((x) => 'read:' + x.id === key); if (d) d.reads = on === false ? Math.max(0, (d.reads || 1) - 1) : 1; }
    save();
  },
};

const cloudStore = {
  async assign(date, pos, mid) { await guard(() => RosterAPI.setAssignment(date, pos, mid || null)); },
  async vote(mKey, typeId, date) { await guard(() => RosterAPI.vote(mKey, typeId, date)); },
  async lock(mKey, typeId) { const ok = await guard(() => RosterAPI.lock(mKey, typeId)); return ok; },
  async newVote(mKey, typeId) { await guard(() => RosterAPI.newVote(mKey, typeId)); },
  async addSong(mKey, title, key, link) { await guard(() => RosterAPI.addSong(mKey, title, key, link)); },
  async editSong(id, fields) { await guard(() => RosterAPI.editSong(id, fields)); },
  async deleteSong(mKey, id) { await guard(() => RosterAPI.deleteSong(id)); },
  async addLib(fields) { await guard(() => RosterAPI.addLibrarySong(fields)); },
  async updateLib(id, fields) { await guard(() => RosterAPI.updateLibrarySong(id, fields)); },
  async deleteLib(id) { await guard(() => RosterAPI.deleteLibrarySong(id)); },
  async addDev(fields) { await guard(() => RosterAPI.addDevotional(fields)); },
  async updateDev(id, fields) { await guard(() => RosterAPI.updateDevotional(id, fields)); },
  async deleteDev(id) { await guard(() => RosterAPI.deleteDevotional(id)); },
  async log(kind, minutes) { await guard(() => RosterAPI.logActivity(kind, minutes)); },
  async flag(key, on) { await guard(() => RosterAPI.setFlag(key, on)); },
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
    members: (s.members || []).map((m) => ({ id: m.id, name: m.name, isLeader: m.isLeader, title: m.title || '', positions: m.positions || [] })),
    sundays: buildSundays(),
    practices: buildPractices(),
    reminders: [],
    songs: {},
    library: (s.library || []).map((l) => ({ id: l.id, title: l.title, artist: l.artist || '', lyrics: l.lyrics || '', chords: l.chords || '', link: l.link || '' })),
    devotionals: (s.devotionals || []).map((d) => ({ id: d.id, title: d.title, author: d.author || '', link: d.link || '', scripture: d.scripture || '', application: d.application || '', prayer: d.prayer || '', date: d.date || '', reads: d.reads || 0 })),
    myLog: (s.myLog || []).map((x) => ({ date: x.date, kind: x.kind, minutes: x.minutes })),
    myFlags: (s.myFlags || []).slice(),
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
    (st.songs[so.month] = st.songs[so.month] || []).push({
      id: so.id, title: so.title, key: so.key || '', link: so.link || '',
      hasPdf: !!so.hasPdf, pdfName: so.pdfName || null,
    });
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
  document.getElementById('season-label').textContent = `Season: ${SEASON.label}  ·  ${APP_VERSION}`;
  syncUserSelect();
  document.querySelectorAll('.tabbar__btn').forEach((b) => {
    b.setAttribute('aria-current', b.dataset.tab === activeTab ? 'true' : 'false');
  });
  const map = { home, roster, voting, songs, library, devotions, journey, growth, reminders, team };
  view.innerHTML = '';
  (map[activeTab] || home)();
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

// -- Tab: Home (landing) --------------------------------------------------

function home() {
  const sunday = currentServiceSunday();
  view.appendChild(el(`<h2 class="section-title">🏠 This Week</h2>`));
  view.appendChild(el(`<p class="section-sub">${esc(BRAND)} — the worship set and your preparation for the upcoming service.</p>`));

  // Surface the review at the times the user asked for it: Mondays (weekly)
  // and the last day of the month (month-end).
  if (isMonday()) view.appendChild(homeReviewBanner('weekly'));
  if (isLastDayOfMonth()) view.appendChild(homeReviewBanner('monthly'));

  // ---- Current week's music set ----
  const setCard = el(`<div class="card"></div>`);
  setCard.appendChild(el(`
    <div class="card__head">
      <span class="card__title">🎵 ${fmtLong(sunday)}</span>
      <span class="badge">This Sunday</span>
    </div>`));

  const lineup = homeLineup(sunday);
  if (lineup) setCard.appendChild(lineup);

  const list = songsFor(sunday);
  setCard.appendChild(el(`<div class="card__meta" style="margin:12px 0 4px;font-weight:600">🎸 Song list (${list.length})</div>`));
  if (!list.length) {
    setCard.appendChild(el(`<div class="card__meta">No songs posted yet for this service.</div>`));
  } else {
    for (const song of list) setCard.appendChild(songItemEl(sunday, song));
  }
  const goSongs = el(`<button class="btn btn--sm btn--ghost btn--block" style="margin-top:10px">Open full song list →</button>`);
  goSongs.addEventListener('click', () => { activeTab = 'songs'; render(); });
  setCard.appendChild(goSongs);
  view.appendChild(setCard);

  // ---- Sunday preparation checklist (personal, resets weekly) ----
  const checks = getPrepChecks();
  const doneCount = () => PREP_CHECKLIST.reduce((n, s) => n + s.items.filter((i) => getPrepChecks().has(i.id)).length, 0);
  const prep = el(`<div class="card"></div>`);
  const head = el(`<div class="card__head"><span class="card__title">✅ Sunday Preparation Checklist</span></div>`);
  const badge = el(`<span class="badge ${checks.size >= PREP_TOTAL ? 'badge--ok' : 'badge--muted'}">${doneCount()}/${PREP_TOTAL}</span>`);
  head.appendChild(badge);
  prep.appendChild(head);
  prep.appendChild(el(`<p class="card__meta" style="margin:-4px 0 6px">Your personal checklist — ticks stay on this device and reset each week.</p>`));

  const refreshBadge = () => {
    const d = doneCount();
    badge.textContent = `${d}/${PREP_TOTAL}`;
    badge.classList.toggle('badge--ok', d === PREP_TOTAL);
    badge.classList.toggle('badge--muted', d !== PREP_TOTAL);
  };

  for (const section of PREP_CHECKLIST) {
    prep.appendChild(el(`<div class="section-title" style="font-size:.92rem;margin:14px 2px 4px">${esc(section.title)}</div>`));
    for (const item of section.items) {
      const on = checks.has(item.id);
      const row = el(`<div class="check-row ${on ? 'is-on' : ''}"><span class="check-row__box">${on ? '✓' : ''}</span><span class="check-row__label">${esc(item.label)}</span></div>`);
      row.addEventListener('click', () => {
        togglePrep(item.id);
        const nowOn = getPrepChecks().has(item.id);
        row.classList.toggle('is-on', nowOn);
        row.querySelector('.check-row__box').textContent = nowOn ? '✓' : '';
        refreshBadge();
      });
      prep.appendChild(row);
    }
  }
  prep.appendChild(el(`<blockquote style="margin:16px 2px 2px;padding:10px 14px;border-left:3px solid var(--brand);background:var(--brand-soft);border-radius:8px;font-style:italic;color:var(--brand-dark)">“${esc(PREP_QUOTE)}”</blockquote>`));
  view.appendChild(prep);
}

/** Compact "who's playing this Sunday" summary for the Home page. */
function homeLineup(sunday) {
  const s = (state.sundays || []).find((x) => x.date === sunday);
  const a = (s && s.assignments) || {};
  const rows = [];
  const leaders = ['lead', ...CO_LEAD_SLOTS].map((id) => a[id]).filter(Boolean).map(memberName);
  if (leaders.length) rows.push(['🎤 Worship lead', leaders.join(', ')]);
  for (const pos of POSITIONS) {
    if (pos.id === 'lead') continue;
    if (a[pos.id]) rows.push([`${pos.icon} ${pos.name}`, memberName(a[pos.id])]);
  }
  if (!rows.length) return null;
  const wrap = el(`<div style="margin:6px 0 2px"></div>`);
  for (const [k, v] of rows) {
    wrap.appendChild(el(`<div class="member" style="padding:6px 0"><span class="member__pos">${esc(k)}</span><span class="member__name">${esc(v)}</span></div>`));
  }
  return wrap;
}

// -- Tab: Roster ----------------------------------------------------------

function roster() {
  view.appendChild(el(`<h2 class="section-title">📅 Sunday Roster</h2>`));
  view.appendChild(el(`<p class="section-sub">Assign musicians to positions for each service. ${state.sundays.length} Sundays in the season.</p>`));

  const upcoming = state.sundays.filter((s) => s.date >= todayISO());
  const list = upcoming.length ? upcoming : state.sundays;

  const required = POSITIONS.filter((p) => !p.optional);
  for (const sunday of list) {
    const card = el(`<div class="card"></div>`);
    const filled = required.filter((p) => sunday.assignments[p.id]).length;
    card.appendChild(el(`
      <div class="card__head">
        <span class="card__title">${fmtLong(sunday.date)}</span>
        <span class="badge ${filled === required.length ? 'badge--ok' : 'badge--muted'}">${filled}/${required.length} set</span>
      </div>`));

    for (const pos of POSITIONS) {
      card.appendChild(assignRow(sunday, pos.id, pos.icon, pos.name));
      // Right after the primary Lead Worshipper, list any co-leaders plus an
      // "add another" slot, so a service can have as many worship leaders as needed.
      if (pos.id === 'lead') {
        const usedCoLeads = CO_LEAD_SLOTS.filter((id) => sunday.assignments[id]);
        for (const id of usedCoLeads) {
          card.appendChild(assignRow(sunday, id, '🎤', 'Co-Lead Worshipper'));
        }
        const nextFree = CO_LEAD_SLOTS.find((id) => !sunday.assignments[id]);
        if (nextFree) card.appendChild(assignRow(sunday, nextFree, '➕', 'Add co-leader', true));
      }
    }
    view.appendChild(card);
  }
}

/** Build one roster assignment row (position label + member dropdown). */
function assignRow(sunday, posId, icon, name, isAdd) {
  const row = el(`<div class="assign-row"></div>`);
  row.appendChild(el(`<div class="assign-row__pos"><span class="pos-icon">${icon}</span>${esc(name)}${isAdd ? '' : ''}</div>`));
  const sel = el(`<select data-date="${sunday.date}" data-pos="${posId}"></select>`);
  // Anyone can fill any position; members who list it as a preference sort first.
  const preferred = state.members.filter((m) => m.positions.includes(posId));
  const others = state.members.filter((m) => !m.positions.includes(posId));
  const pool = [...preferred, ...others];
  const placeholder = isAdd ? '＋ add a worship leader…' : '— unassigned —';
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    pool.map((m) => `<option value="${m.id}" ${sunday.assignments[posId] === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  sel.addEventListener('change', async () => {
    await store.assign(sunday.date, posId, sel.value || null);
    render();
  });
  row.appendChild(sel);
  return row;
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
        controls.appendChild(el(`<span class="card__meta">An admin locks the date once the majority is in.</span>`));
      }
      card.appendChild(controls);
      view.appendChild(card);
    }
  }
}

// -- Tab: Songs & Chords --------------------------------------------------

function songs() {
  view.appendChild(el(`<h2 class="section-title">🎸 Song List & Chords</h2>`));
  view.appendChild(el(`<p class="section-sub">The song list for each Sunday service — add chords (search or attach a PDF) and a listening link. Anyone can add.</p>`));

  const upcoming = seasonSundays().filter((d) => d >= todayISO());
  const list = upcoming.length ? upcoming : seasonSundays();
  for (const sunday of list) {
    const songsList = songsFor(sunday);
    const card = el(`<div class="card"></div>`);
    card.appendChild(el(`
      <div class="card__head">
        <span class="card__title">${fmtLong(sunday)}</span>
        <span class="badge badge--muted">${songsList.length} song${songsList.length === 1 ? '' : 's'}</span>
      </div>`));

    if (!songsList.length) card.appendChild(el(`<div class="card__meta">No songs posted yet.</div>`));
    for (const song of songsList) card.appendChild(songItemEl(sunday, song));

    // Any team member can add a song to this service.
    const add = el(`<button class="btn btn--sm btn--ghost btn--block" style="margin-top:8px">＋ Add song</button>`);
    add.addEventListener('click', () => addSongModal(sunday));
    card.appendChild(add);
    view.appendChild(card);
  }
}

/** Build one song row (title/key + Listen/PDF/chords/attach/remind/edit/delete). */
function songItemEl(weekKey, song) {
  const item = el(`<div class="song-item"></div>`);
  item.appendChild(el(`
    <div>
      <div class="song-item__title">${esc(song.title)}</div>
      <div class="song-item__key">Key: ${esc(song.key || '—')}</div>
    </div>`));
  const actions = el(`<div class="song-actions"></div>`);
  const hasPdf = CLOUD ? song.hasPdf : !!song.pdfData;

  if (song.link) {
    const listen = el(`<button class="btn btn--sm">▶️ Listen</button>`);
    listen.addEventListener('click', () => openExternal(song.link));
    actions.appendChild(listen);
  }
  if (hasPdf) {
    const pdf = el(`<button class="btn btn--sm btn--primary">📄 Chord PDF</button>`);
    pdf.addEventListener('click', () => openSongPdf(song));
    actions.appendChild(pdf);
  }
  const chords = el(`<a class="btn btn--sm" target="_blank" rel="noopener noreferrer" href="${chordsUrl(song)}">🔎 Find chords</a>`);
  actions.appendChild(chords);
  const attach = el(`<button class="btn btn--sm">${hasPdf ? '🔁 Replace PDF' : '📎 Attach PDF'}</button>`);
  attach.addEventListener('click', () => pickSongPdf(weekKey, song));
  actions.appendChild(attach);
  const remind = el(`<button class="btn btn--sm">🔔 Remind</button>`);
  remind.addEventListener('click', () => remindSongPractice(weekKey, song));
  actions.appendChild(remind);
  const edit = el(`<button class="btn btn--sm">✏️ Edit</button>`);
  edit.addEventListener('click', () => editSongModal(song));
  actions.appendChild(edit);
  const del = el(`<button class="btn btn--sm btn--danger">✕</button>`);
  del.addEventListener('click', async () => { await store.deleteSong(weekKey, song.id); render(); });
  actions.appendChild(del);
  item.appendChild(actions);
  return item;
}

function addSongModal(mKey) {
  const body = el(`
    <div>
      <label class="field" for="song-title">Song title</label>
      <input id="song-title" type="text" placeholder="e.g. Great Are You Lord" />
      <label class="field" for="song-key">Key (optional)</label>
      <input id="song-key" type="text" placeholder="e.g. G" />
      <label class="field" for="song-link">Listening link (YouTube etc., optional)</label>
      <input id="song-link" type="url" inputmode="url" placeholder="https://youtu.be/…" />
    </div>`);
  openModal('Add a song', body, () => {
    const title = body.querySelector('#song-title').value.trim();
    const key = body.querySelector('#song-key').value.trim();
    const link = normalizeLink(body.querySelector('#song-link').value);
    if (!title) { toast('Enter a song title.'); return false; }
    store.addSong(mKey, title, key, link).then(() => { render(); toast('Song added.'); });
    return true;  // close the modal immediately; the store call resolves async
  });
}

/** Trim a URL and only keep it if it's an http(s) link. */
function normalizeLink(v) {
  let t = (v || '').trim();
  if (!t) return '';
  // Reject other schemes (javascript:, data:, etc.), but auto-add https:// when
  // the user typed a bare link like "youtu.be/abc" so it isn't silently dropped.
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return '';
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(t) ? t : '';
}

/** Open an external (http/https) URL safely in a new tab. */
function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) { toast('Invalid link.'); return; }
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); a.remove();
}

/** Edit an existing song's title/key/listening link. */
function editSongModal(song) {
  const body = el(`
    <div>
      <label class="field" for="es-title">Song title</label>
      <input id="es-title" type="text" value="${esc(song.title)}" />
      <label class="field" for="es-key">Key (optional)</label>
      <input id="es-key" type="text" value="${esc(song.key || '')}" />
      <label class="field" for="es-link">Listening link (YouTube etc., optional)</label>
      <input id="es-link" type="url" inputmode="url" value="${esc(song.link || '')}" placeholder="https://youtu.be/…" />
    </div>`);
  openModal('Edit song', body, () => {
    const title = body.querySelector('#es-title').value.trim();
    if (!title) { toast('Enter a song title.'); return false; }
    const fields = { title, key: body.querySelector('#es-key').value.trim(), link: normalizeLink(body.querySelector('#es-link').value) };
    store.editSong(song.id, fields).then(() => { render(); toast('Song updated.'); });
    return true;
  });
}

const MAX_PDF_BYTES = 800 * 1024;

/** Let the user pick a PDF and attach it to a song. */
function pickSongPdf(mKey, song) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('Please choose a PDF file.'); return; }
    if (file.size > MAX_PDF_BYTES) { toast('PDF is too big — keep it under 800 KB (1–2 page charts are fine).'); return; }
    toast('Uploading PDF…');
    if (CLOUD) {
      const ok = await guard(() => RosterAPI.uploadSongPdf(song.id, file));
      render();
      if (ok) toast('Chord PDF attached.');
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const s = (state.songs[mKey] || []).find((x) => x.id === song.id);
        if (s) { s.pdfData = reader.result; s.pdfName = file.name; save(); render(); toast('Chord PDF attached.'); }
      };
      reader.readAsDataURL(file);
    }
  });
  document.body.appendChild(input);
  input.click();
}

/** Open a song's attached PDF in a new tab. */
async function openSongPdf(song) {
  try {
    let url;
    if (CLOUD) url = await RosterAPI.songPdfBlobUrl(song.id);
    else url = song.pdfData;
    if (!url) { toast('No PDF attached.'); return; }
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    if (CLOUD) setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast(e.message || 'Could not open the PDF.');
  }
}

// -- Tab: Library (future songs to learn) ---------------------------------

function library() {
  const lib = state.library || [];
  view.appendChild(el(`<h2 class="section-title">📚 Song Library</h2>`));
  view.appendChild(el(`<p class="section-sub">Future songs to learn — lyrics, chords and a listening link, all in one place. Anyone can add or edit. ${lib.length} song${lib.length === 1 ? '' : 's'}.</p>`));

  const add = el(`<button class="btn btn--primary btn--block" style="margin-bottom:12px">＋ Add song to library</button>`);
  add.addEventListener('click', () => libraryModal(null));
  view.appendChild(add);

  if (!lib.length) {
    view.appendChild(el(`<div class="empty"><div class="empty__icon">🎼</div><p>No songs yet — add one to start building your list.</p></div>`));
    return;
  }
  for (const song of lib) {
    const card = el(`<div class="card"></div>`);
    card.appendChild(el(`<div class="card__title">${esc(song.title)}</div>`));
    if (song.artist) card.appendChild(el(`<div class="card__meta">${esc(song.artist)}</div>`));
    const actions = el(`<div class="btn-row" style="margin-top:10px"></div>`);
    if (song.link) {
      const l = el(`<button class="btn btn--sm">▶️ Listen</button>`);
      l.addEventListener('click', () => openExternal(song.link));
      actions.appendChild(l);
    }
    if (song.lyrics || song.chords) {
      const v = el(`<button class="btn btn--sm btn--primary">📖 Lyrics & chords</button>`);
      v.addEventListener('click', () => libraryViewModal(song));
      actions.appendChild(v);
    }
    const e = el(`<button class="btn btn--sm">✏️ Edit</button>`);
    e.addEventListener('click', () => libraryModal(song));
    actions.appendChild(e);
    const d = el(`<button class="btn btn--sm btn--danger">✕</button>`);
    d.addEventListener('click', () => confirmModal('Remove from library?', `Delete “${song.title}” from the library?`, async () => { await store.deleteLib(song.id); render(); }));
    actions.appendChild(d);
    card.appendChild(actions);
    view.appendChild(card);
  }
}

/** Read-only view of a library song's chords and lyrics. */
function libraryViewModal(song) {
  const body = el(`<div></div>`);
  if (song.link) {
    const l = el(`<button class="btn btn--sm btn--block" style="margin-bottom:10px">▶️ Listen to this song</button>`);
    l.addEventListener('click', () => openExternal(song.link));
    body.appendChild(l);
  }
  if (song.chords) {
    body.appendChild(el(`<label class="field">Chords</label>`));
    body.appendChild(el(`<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;background:#f3f4f6;border-radius:8px;padding:10px;overflow-x:auto;margin:0 0 10px">${esc(song.chords)}</pre>`));
  }
  if (song.lyrics) {
    body.appendChild(el(`<label class="field">Lyrics</label>`));
    body.appendChild(el(`<div style="white-space:pre-wrap;line-height:1.55">${esc(song.lyrics)}</div>`));
  }
  openModal(song.title, body, () => true, null, 'Close');
}

/** Add or edit a library song (title, artist, listening link, chords, lyrics). */
function libraryModal(existing) {
  const s = existing || { title: '', artist: '', lyrics: '', chords: '', link: '' };
  const body = el(`
    <div>
      <label class="field" for="lib-title">Song title</label>
      <input id="lib-title" type="text" value="${esc(s.title)}" placeholder="e.g. Goodness of God" />
      <label class="field" for="lib-artist">Artist (optional)</label>
      <input id="lib-artist" type="text" value="${esc(s.artist || '')}" placeholder="e.g. Bethel Music" />
      <label class="field" for="lib-link">Listening link (YouTube etc., optional)</label>
      <input id="lib-link" type="url" inputmode="url" value="${esc(s.link || '')}" placeholder="https://youtu.be/…" />
      <label class="field" for="lib-chords">Chords (optional)</label>
      <textarea id="lib-chords" rows="5" placeholder="Paste chords here…">${esc(s.chords || '')}</textarea>
      <label class="field" for="lib-lyrics">Lyrics (optional)</label>
      <textarea id="lib-lyrics" rows="6" placeholder="Paste lyrics here…">${esc(s.lyrics || '')}</textarea>
    </div>`);
  openModal(existing ? 'Edit library song' : 'Add to library', body, () => {
    const title = body.querySelector('#lib-title').value.trim();
    if (!title) { toast('Enter a song title.'); return false; }
    const fields = {
      title,
      artist: body.querySelector('#lib-artist').value.trim(),
      link: normalizeLink(body.querySelector('#lib-link').value),
      chords: body.querySelector('#lib-chords').value,
      lyrics: body.querySelector('#lib-lyrics').value,
    };
    (existing ? store.updateLib(existing.id, fields) : store.addLib(fields))
      .then(() => { render(); toast(existing ? 'Library song updated.' : 'Added to library.'); });
    return true;
  });
}

// -- Tab: Devotions -------------------------------------------------------

function devotions() {
  const list = state.devotionals || [];
  view.appendChild(el(`<h2 class="section-title">🙏 Devotions</h2>`));
  view.appendChild(el(`<p class="section-sub">Devotionals for the team — scripture, a practical life application and a prayer, with an optional video or blog link. Anyone can share one. ${list.length} devotional${list.length === 1 ? '' : 's'}.</p>`));

  const add = el(`<button class="btn btn--primary btn--block" style="margin-bottom:12px">＋ Share a devotional</button>`);
  add.addEventListener('click', () => devotionalModal(null));
  view.appendChild(add);

  if (!list.length) {
    view.appendChild(el(`<div class="empty"><div class="empty__icon">📖</div><p>No devotionals yet — be the first to share one.</p></div>`));
    return;
  }
  for (const d of list) {
    const card = el(`<div class="card"></div>`);
    card.appendChild(el(`<div class="card__title">${esc(d.title)}</div>`));
    const meta = [d.author, d.date].filter(Boolean).join(' · ');
    if (meta) card.appendChild(el(`<div class="card__meta">${esc(meta)}</div>`));
    if (d.scripture) card.appendChild(el(`<div class="card__meta" style="margin-top:6px">📖 ${esc(d.scripture.split('\n')[0])}</div>`));
    const readByMe = new Set(state.myFlags || []).has('read:' + d.id);
    card.appendChild(el(`<div style="margin-top:6px">${readByMe ? '<span class="badge badge--ok">✓ You’ve read this</span> ' : ''}<span class="card__meta">${d.reads || 0} read</span></div>`));
    const actions = el(`<div class="btn-row" style="margin-top:10px"></div>`);
    const read = el(`<button class="btn btn--sm btn--primary">📖 Read</button>`);
    read.addEventListener('click', () => devotionalViewModal(d));
    actions.appendChild(read);
    if (d.link) {
      const w = el(`<button class="btn btn--sm">▶️ Watch/Read</button>`);
      w.addEventListener('click', () => openExternal(d.link));
      actions.appendChild(w);
    }
    const e = el(`<button class="btn btn--sm">✏️ Edit</button>`);
    e.addEventListener('click', () => devotionalModal(d));
    actions.appendChild(e);
    const del = el(`<button class="btn btn--sm btn--danger">✕</button>`);
    del.addEventListener('click', () => confirmModal('Remove devotional?', `Delete “${d.title}”?`, async () => { await store.deleteDev(d.id); render(); }));
    actions.appendChild(del);
    card.appendChild(actions);
    view.appendChild(card);
  }
}

/** Read-only view of a full devotional, with a "mark as read" confirmation. */
function devotionalViewModal(d) {
  const body = el(`<div></div>`);
  const meta = [d.author, d.date].filter(Boolean).join(' · ');
  if (meta) body.appendChild(el(`<div class="card__meta" style="margin-bottom:10px">${esc(meta)}</div>`));

  // Read confirmation ("Done" after reading).
  const readKey = 'read:' + d.id;
  const readWrap = el(`<div style="margin-bottom:12px"></div>`);
  const drawRead = () => {
    readWrap.innerHTML = '';
    const isRead = new Set(state.myFlags || []).has(readKey);
    const btn = el(`<button class="btn btn--sm btn--block ${isRead ? '' : 'btn--primary'}">${isRead ? '✓ You’ve read this — tap to undo' : '✓ Mark as read (Done)'}</button>`);
    btn.addEventListener('click', async () => { await store.flag(readKey, !isRead); drawRead(); render(); });
    readWrap.appendChild(btn);
  };
  drawRead();
  body.appendChild(readWrap);
  if (d.link) {
    const w = el(`<button class="btn btn--sm btn--block" style="margin-bottom:12px">▶️ Watch / read online</button>`);
    w.addEventListener('click', () => openExternal(d.link));
    body.appendChild(w);
  }
  const section = (label, text) => {
    if (!text) return;
    body.appendChild(el(`<label class="field">${label}</label>`));
    body.appendChild(el(`<div style="white-space:pre-wrap;line-height:1.55;margin-bottom:8px">${esc(text)}</div>`));
  };
  section('Scripture', d.scripture);
  section('Practical life application', d.application);
  section('Prayer', d.prayer);
  openModal(d.title, body, () => true, null, 'Close');
}

/** Add or edit a devotional. */
function devotionalModal(existing) {
  const d = existing || { title: '', link: '', scripture: '', application: '', prayer: '' };
  const body = el(`
    <div>
      <label class="field" for="dv-title">Title</label>
      <input id="dv-title" type="text" value="${esc(d.title)}" placeholder="e.g. Walking in Faith" />
      <label class="field" for="dv-link">Video or blog link (optional)</label>
      <input id="dv-link" type="url" inputmode="url" value="${esc(d.link || '')}" placeholder="https://…" />
      <label class="field" for="dv-scripture">Scripture(s)</label>
      <textarea id="dv-scripture" rows="3" placeholder="e.g. Proverbs 3:5–6 — Trust in the Lord…">${esc(d.scripture || '')}</textarea>
      <label class="field" for="dv-application">Practical life application</label>
      <textarea id="dv-application" rows="5" placeholder="How do we live this out this week?">${esc(d.application || '')}</textarea>
      <label class="field" for="dv-prayer">Prayer</label>
      <textarea id="dv-prayer" rows="4" placeholder="A short prayer…">${esc(d.prayer || '')}</textarea>
    </div>`);
  openModal(existing ? 'Edit devotional' : 'Share a devotional', body, () => {
    const title = body.querySelector('#dv-title').value.trim();
    if (!title) { toast('Enter a title.'); return false; }
    const fields = {
      title,
      link: normalizeLink(body.querySelector('#dv-link').value),
      scripture: body.querySelector('#dv-scripture').value,
      application: body.querySelector('#dv-application').value,
      prayer: body.querySelector('#dv-prayer').value,
    };
    (existing ? store.updateDev(existing.id, fields) : store.addDev(fields))
      .then(() => { render(); toast(existing ? 'Devotional updated.' : 'Devotional shared.'); });
    return true;
  });
}

// -- Tab: My Journey (personal dashboard) ---------------------------------

function meter(label, valText, pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct * 100)));
  const color = p >= 85 ? 'var(--ok)' : p >= 50 ? 'var(--brand)' : 'var(--warn)';
  return el(`
    <div class="meter">
      <div class="meter__top"><span>${label}</span><span class="meter__val">${esc(valText)}</span></div>
      <div class="meter__bar"><span style="width:${p}%;background:${color}"></span></div>
    </div>`);
}

function journey() {
  const me = currentUser();
  const k = computeKpis();
  view.appendChild(el(`<h2 class="section-title">📈 My Journey</h2>`));
  view.appendChild(el(`<p class="section-sub">${esc(me ? me.name : 'You')} — your personal growth this week. Only you see your own dashboard; logging is on your honour before God.</p>`));

  // Your Spiritual Journey
  const sj = el(`<div class="card"></div>`);
  const r1 = ratingFor(k.spiritual);
  sj.appendChild(el(`<div class="card__title">Your Spiritual Journey</div>`));
  sj.appendChild(el(`<div class="card__meta">Last 7 days</div>`));
  sj.appendChild(el(`<div class="kpi__score"><span class="kpi__num" style="color:${r1.color}">${k.spiritual}</span><span class="kpi__of">/ 100</span><span class="kpi__rating" style="color:${r1.color};background:${r1.bg}">${r1.label}</span></div>`));
  sj.appendChild(meter('🙏 Prayer (in the Spirit)', `${k.prayerMin} / ${KPI.prayerWeekTarget} min`, k.prayerPct));
  sj.appendChild(meter('📖 The Word', `${k.wordMin} / ${KPI.wordWeekTarget} min`, k.wordPct));
  sj.appendChild(meter('🙏 Devotions read', `${k.readCount} / ${k.devTarget}`, k.devPct));
  view.appendChild(sj);

  // Quick log
  const logCard = el(`<div class="card"></div>`);
  logCard.appendChild(el(`<div class="card__title">Log today</div>`));
  logCard.appendChild(el(`<div class="card__meta" style="margin:2px 0 8px">Prayer in the Spirit</div>`));
  const prayerRow = el(`<div class="btn-row"></div>`);
  [10, 20, 30].forEach((min) => {
    const btn = el(`<button class="btn btn--sm">🙏 ${min} min</button>`);
    btn.addEventListener('click', async () => { await store.log('prayer', min); render(); toast(`Logged ${min} min of prayer.`); });
    prayerRow.appendChild(btn);
  });
  logCard.appendChild(prayerRow);
  logCard.appendChild(el(`<div class="card__meta" style="margin:12px 0 8px">Listening to / reading the Word</div>`));
  const wordRow = el(`<div class="btn-row"></div>`);
  [15, 30, 45].forEach((min) => {
    const btn = el(`<button class="btn btn--sm">📖 ${min} min</button>`);
    btn.addEventListener('click', async () => { await store.log('word', min); render(); toast(`Logged ${min} min in the Word.`); });
    wordRow.appendChild(btn);
  });
  logCard.appendChild(wordRow);
  const custom = el(`<button class="btn btn--sm btn--ghost btn--block" style="margin-top:10px">＋ Log a custom amount</button>`);
  custom.addEventListener('click', logCustomModal);
  logCard.appendChild(custom);
  view.appendChild(logCard);

  // Excellence in Ministry
  const em = el(`<div class="card"></div>`);
  const r2 = ratingFor(k.ministry);
  em.appendChild(el(`<div class="card__title">Excellence in Ministry</div>`));
  em.appendChild(el(`<div class="card__meta">Week of ${fmtLong(k.sunday)} — tick what applies</div>`));
  em.appendChild(el(`<div class="kpi__score"><span class="kpi__num" style="color:${r2.color}">${k.ministry}</span><span class="kpi__of">/ 100</span><span class="kpi__rating" style="color:${r2.color};background:${r2.bg}">${r2.label}</span></div>`));
  for (const c of k.ministryChecks) {
    const row = el(`<div class="check-row ${c.on ? 'is-on' : ''}"><span class="check-row__box">${c.on ? '✓' : ''}</span><span class="check-row__label">${esc(c.label)}</span></div>`);
    row.style.cursor = 'pointer';
    row.addEventListener('click', async () => { await store.flag(`ministry:${k.sunday}:${c.id}`, !c.on); render(); });
    em.appendChild(row);
  }
  const spiritOn = k.spiritual >= 60;
  em.appendChild(el(`<div class="check-row ${spiritOn ? 'is-on' : ''}"><span class="check-row__box">${spiritOn ? '✓' : ''}</span><span class="check-row__label">Growing spiritually <span class="card__meta">(from your Spiritual Journey score)</span></span></div>`));
  view.appendChild(em);
}

// -- Tab: Growth (weekly & month-end review + coaching) -------------------

function growth() {
  const me = currentUser();
  view.appendChild(el(`<h2 class="section-title">📊 Your Review</h2>`));
  view.appendChild(el(`<p class="section-sub">${esc(me ? me.name : 'You')} — coaching on your meeting preparation, spiritual journey and ministry excellence. Private to you.</p>`));

  // Weekly review — the week that just finished (surfaced every Monday).
  const wSunday = mostRecentSunday();
  const wr = reviewFor(wSunday);
  view.appendChild(reviewCard({
    icon: '🗓️', title: 'Weekly Review',
    subtitle: `Week ending ${fmtLong(wSunday)}`,
    highlight: isMonday(),
    overall: wr.overall, rating: wr.rating, empty: wr.empty, notes: wr.notes,
    prepPct: wr.prepPct, prepLabel: `${wr.prepDone} / ${wr.prepTotal} prep items`,
    spiritual: wr.spiritual, ministry: wr.ministry,
  }));

  // Month-end review — month-to-date, emphasised on the last day of the month.
  const mr = monthlyReview(todayISO());
  view.appendChild(reviewCard({
    icon: '📆', title: isLastDayOfMonth() ? 'Month-End Review' : 'This Month So Far',
    subtitle: `${mr.month} · active in ${mr.activeWeeks}/${mr.weeks} weeks`,
    highlight: isLastDayOfMonth(),
    overall: mr.overall, rating: mr.rating, empty: mr.empty, notes: mr.notes,
    prepPct: mr.prepAvg / 100, prepLabel: `${mr.prepAvg}% average`,
    spiritual: mr.spiritualAvg, ministry: mr.ministryAvg,
  }));

  const go = el(`<button class="btn btn--sm btn--ghost btn--block">Log prayer / Word or tick ministry in My Journey →</button>`);
  go.addEventListener('click', () => { activeTab = 'journey'; render(); });
  view.appendChild(go);
}

/** Render one review (weekly or monthly) as a card with meters + coaching. */
function reviewCard(o) {
  const card = el(`<div class="card"></div>`);
  if (o.highlight) card.style.borderColor = 'var(--brand)';
  const head = el(`<div class="card__head"></div>`);
  head.appendChild(el(`<span class="card__title">${o.icon} ${esc(o.title)}</span>`));
  head.appendChild(el(`<span class="kpi__rating" style="color:${o.rating.color};background:${o.rating.bg}">${o.rating.label}</span>`));
  card.appendChild(head);
  card.appendChild(el(`<div class="card__meta" style="margin:-2px 0 8px">${esc(o.subtitle)}</div>`));

  if (o.empty) {
    card.appendChild(bigReminder());
  } else {
    card.appendChild(el(`<div class="kpi__score"><span class="kpi__num" style="color:${o.rating.color}">${o.overall}</span><span class="kpi__of">/ 100 overall</span></div>`));
  }
  card.appendChild(meter('📝 Meeting preparation', o.prepLabel, o.prepPct));
  card.appendChild(meter('📈 Spiritual journey', `${o.spiritual} / 100`, o.spiritual / 100));
  card.appendChild(meter('⭐ Ministry excellence', `${o.ministry} / 100`, o.ministry / 100));

  card.appendChild(el(`<div class="card__meta" style="margin:12px 0 2px;font-weight:700">Coaching notes</div>`));
  for (const n of o.notes) {
    card.appendChild(el(`<div class="reminder"><span class="reminder__dot">${n.icon}</span><div class="reminder__body"><div class="reminder__title" style="font-weight:500">${esc(n.text)}</div></div></div>`));
  }
  return card;
}

/** The prominent "you haven't logged anything" reminder. */
function bigReminder() {
  return el(`<div style="border:2px solid var(--warn);background:var(--warn-soft);color:var(--warn);border-radius:12px;padding:14px;margin:6px 0 10px;text-align:center">
    <div style="font-size:1.7rem;line-height:1">⚠️</div>
    <div style="font-weight:800;font-size:1.05rem;margin:4px 0 2px">No inputs recorded</div>
    <div style="font-size:.9rem;color:var(--ink)">Please improve next week — spend time in preparation, prayer and the Word, and mark your ministry. Small, consistent steps grow great worshippers.</div>
  </div>`);
}

/** A tappable Home banner that surfaces the weekly / month-end review. */
function homeReviewBanner(kind) {
  const r = kind === 'weekly' ? reviewFor(mostRecentSunday()) : monthlyReview(todayISO());
  const title = kind === 'weekly' ? '🗓️ Weekly Review is ready' : '📆 Month-End Review is ready';
  const strong = r.empty;
  const card = el(`<div class="card" style="cursor:pointer;border-color:${strong ? 'var(--warn)' : 'var(--brand)'};${strong ? 'background:var(--warn-soft);' : ''}"></div>`);
  card.appendChild(el(`<div class="card__head"><span class="card__title">${title}</span><span class="kpi__rating" style="color:${r.rating.color};background:${r.rating.bg}">${r.rating.label}</span></div>`));
  const msg = strong
    ? 'You haven’t logged anything yet — tap to see how to improve this week.'
    : `Overall ${r.overall}/100. Tap to read your coaching notes.`;
  card.appendChild(el(`<div class="card__meta">${esc(msg)}</div>`));
  card.addEventListener('click', () => { activeTab = 'growth'; render(); });
  return card;
}

function logCustomModal() {
  const body = el(`
    <div>
      <label class="field" for="lg-kind">What did you do?</label>
      <select id="lg-kind">
        <option value="prayer">🙏 Prayer (in the Spirit)</option>
        <option value="word">📖 The Word</option>
      </select>
      <label class="field" for="lg-min">Minutes</label>
      <input id="lg-min" type="number" inputmode="numeric" min="1" max="600" placeholder="e.g. 25" />
    </div>`);
  openModal('Log today', body, () => {
    const kind = body.querySelector('#lg-kind').value;
    const min = Math.round(Number(body.querySelector('#lg-min').value));
    if (!(min >= 1 && min <= 600)) { toast('Enter minutes between 1 and 600.'); return false; }
    store.log(kind, min).then(() => { render(); toast('Logged.'); });
    return true;
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

  if (IS_IOS && !IS_STANDALONE) {
    // iPhone: notifications only work from a Home-Screen-installed app.
    notifyCard.appendChild(el(`<div class="card__meta">On iPhone, reminders can only pop up after you add this app to your Home Screen and open it from that icon (Apple requirement). It takes a few seconds:</div>`));
    const help = el(`<button class="btn btn--sm btn--primary btn--block" style="margin-top:10px">📲 How to add to Home Screen</button>`);
    help.addEventListener('click', showInstallHelp);
    notifyCard.appendChild(help);
  } else {
    notifyCard.appendChild(el(`<div class="card__meta">Get a pop-up when reminders are due.</div>`));
    const enable = el(`<button class="btn btn--sm btn--primary btn--block" style="margin-top:10px">${state.notifyEnabled ? 'Notifications enabled' : 'Enable notifications'}</button>`);
    enable.disabled = state.notifyEnabled;
    enable.addEventListener('click', requestNotify);
    notifyCard.appendChild(enable);
    // A quiet "add to home screen" helper for everyone not yet installed.
    if (!IS_STANDALONE) {
      const inst = el(`<button class="btn btn--sm btn--block" style="margin-top:8px">📲 Add to Home Screen</button>`);
      inst.addEventListener('click', showInstallHelp);
      notifyCard.appendChild(inst);
    }
  }
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
      inv.appendChild(el(`<div class="card__head"><span class="card__title">Invite code</span><span class="badge">${t.role === 'leader' ? 'Admin' : 'Member'}</span></div>`));
      inv.appendChild(el(`<div class="card__meta">Send teammates the invite link below — it opens the app ready to join "${esc(t.teamName || 'the team')}", with "start a new team" disabled so nobody creates a duplicate.</div>`));
      inv.appendChild(el(`<div style="font-size:1.4rem;font-weight:700;letter-spacing:2px;text-align:center;margin:10px 0">${esc(t.inviteCode)}</div>`));

      // Full join link: current page URL + ?join=CODE (no query/hash carried over).
      const teamName = t.teamName || 'our worship team';
      const inviteLink = location.origin + location.pathname + '?join=' + encodeURIComponent(t.inviteCode);
      // A clean, professional message to share alongside the link.
      const inviteMsg =
        `🎵 ${BRAND} — Worship Team Roster\n\n` +
        `Hi team! Please join our worship roster — schedule, song lists (with chords) and practice reminders, all in one place.\n\n` +
        `👉 Tap to join: ${inviteLink}\n\n` +
        `How to join (2 minutes):\n` +
        `1. Tap the link above.\n` +
        `2. Type your name, then tap “Join team”.\n` +
        `3. Add it to your Home Screen for quick access:\n` +
        `   • iPhone: in Safari, tap Share (□↑) → “Add to Home Screen”.\n` +
        `   • Android: Chrome menu (⋮) → “Add to Home screen”.\n` +
        `4. Open it from that new icon, then Reminders tab → “Enable notifications”.\n\n` +
        `Please join on the phone you’ll actually use — it becomes your personal sign-in (no password needed).`;

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
    const badges =
      (m.isLeader ? '<span class="badge">Admin</span>' : '') +
      (m.title ? ` <span class="badge badge--muted">${esc(m.title)}</span>` : '');
    row.appendChild(el(`
      <div>
        <div class="member__name">${esc(m.name)} ${badges}</div>
        <div class="member__pos">${esc(posNames || 'No position set')}</div>
      </div>`));
    if (!CLOUD) {
      const actions = el(`<div class="btn-row"></div>`);
      const edit = el(`<button class="btn btn--sm">Edit</button>`);
      edit.addEventListener('click', () => memberModal(m));
      actions.appendChild(edit);
      row.appendChild(actions);
    } else if (isLeader()) {
      // Admins can set a member's title (e.g. Pastor) or grant/revoke admin.
      const edit = el(`<button class="btn btn--sm">Edit</button>`);
      edit.addEventListener('click', () => cloudMemberModal(m));
      const actions = el(`<div class="btn-row"></div>`);
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

/** Admin-only editor (cloud mode): set a member's title and admin privileges. */
function cloudMemberModal(m) {
  const me = currentUser();
  const isSelf = me && me.id === m.id;
  const suggestions = ['Pastor', 'Worship Leader', 'Elder', 'Musician', 'Vocalist'];
  const body = el(`
    <div>
      <div class="card__meta" style="margin-bottom:8px">${esc(m.name)}</div>
      <label class="field" for="mem-title">Title (optional)</label>
      <input id="mem-title" type="text" list="title-options" value="${esc(m.title || '')}" placeholder="e.g. Pastor" maxlength="30" />
      <datalist id="title-options">${suggestions.map((s) => `<option value="${s}"></option>`).join('')}</datalist>
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-weight:600">
        <input id="mem-admin" type="checkbox" ${m.isLeader ? 'checked' : ''} ${isSelf ? 'disabled' : ''} style="width:auto" />
        Admin privileges (manage songs, lock dates, edit members)
      </label>
      ${isSelf ? '<div class="card__meta" style="margin-top:4px">You can\'t remove your own admin here.</div>' : ''}
    </div>`);

  openModal('Edit member', body, () => {
    const title = body.querySelector('#mem-title').value.trim();
    const isAdmin = body.querySelector('#mem-admin').checked;
    const fields = { title };
    if (!isSelf) fields.isLeader = isAdmin;
    guard(() => RosterAPI.updateMember(m.id, fields)).then(() => { render(); toast('Member updated.'); });
    return true;
  });
}

/** Platform-specific "add to Home Screen" instructions. */
function showInstallHelp() {
  let steps;
  if (IS_IOS) {
    steps = `
      <ol style="padding-left:18px;margin:0;line-height:1.9">
        <li>Open this page in <b>Safari</b> (not Chrome).</li>
        <li>Tap the <b>Share</b> button <span style="white-space:nowrap">(the □ with an ↑)</span> at the bottom of the screen.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b> (top-right).</li>
        <li>Open the app from its new <b>Home Screen icon</b> — then you can turn on notifications from the Reminders tab.</li>
      </ol>
      <div class="card__meta" style="margin-top:10px">Notifications on iPhone need iOS 16.4 or newer and only work from the installed icon — not a Safari tab.</div>`;
  } else if (IS_ANDROID) {
    steps = `
      <ol style="padding-left:18px;margin:0;line-height:1.9">
        <li>Open this page in <b>Chrome</b>.</li>
        <li>Tap the <b>⋮ menu</b> (top-right).</li>
        <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>) → <b>Add</b>.</li>
        <li>Open it from the new icon, then enable notifications on the Reminders tab.</li>
      </ol>`;
  } else {
    steps = `
      <ol style="padding-left:18px;margin:0;line-height:1.9">
        <li>In your browser's menu, choose <b>Install</b> or <b>Add to Home screen / Apps</b>.</li>
        <li>Open the installed app, then enable notifications on the Reminders tab.</li>
      </ol>`;
  }
  const body = el(`<div>${steps}</div>`);
  // Info-only modal: reuse openModal but with a single "Got it" action.
  openModal('Add to Home Screen', body, () => true, null, 'Got it');
}

/* -------------------------------------------------------------------------- *
 * Modal + toast + notifications
 * -------------------------------------------------------------------------- */

function openModal(title, bodyEl, onSave, extra, okLabel) {
  const backdrop = el(`<div class="modal-backdrop"></div>`);
  const modal = el(`<div class="modal"><h3 class="modal__title">${esc(title)}</h3></div>`);
  modal.appendChild(bodyEl);
  const row = el(`<div class="btn-row" style="margin-top:16px;justify-content:flex-end"></div>`);
  if (extra) {
    const b = el(`<button class="btn btn--sm ${extra.danger ? 'btn--danger' : ''}" style="margin-right:auto">${esc(extra.label)}</button>`);
    b.addEventListener('click', () => { close(); extra.onClick(); });
    row.appendChild(b);
  }
  // Info-only modals (okLabel like "Got it") show just the one button.
  const infoOnly = okLabel && okLabel !== 'Save';
  const ok = el(`<button class="btn btn--sm btn--primary">${esc(okLabel || 'Save')}</button>`);
  ok.addEventListener('click', () => { if (onSave() !== false) close(); });
  if (!infoOnly) {
    const cancel = el(`<button class="btn btn--sm">Cancel</button>`);
    cancel.addEventListener('click', close);
    row.appendChild(cancel);
  }
  row.appendChild(ok);
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
  if (IS_IOS && !IS_STANDALONE) { showInstallHelp(); return; }
  if (!('Notification' in window)) {
    toast(IS_IOS ? 'On iPhone, add the app to your Home Screen first (iOS 16.4+).' : 'Notifications aren\'t available in this browser.');
    return;
  }
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
  document.getElementById('season-label').textContent = `Season: ${SEASON.label}  ·  ${APP_VERSION}`;
  setChromeVisible(false);
  view.innerHTML = '';

  // An invite link carries the team code as ?join=CODE. When present, we only
  // let the person JOIN (creating a new team is greyed out) so invitees can't
  // accidentally start a competing team.
  const invitedCode = (new URLSearchParams(location.search).get('join') || '').trim().toUpperCase();
  const invited = !!invitedCode;

  view.appendChild(el(`
    <div style="text-align:center;margin:8px 0 18px">
      <img src="img/logo.svg" alt="${esc(BRAND)} — ${esc(TAGLINE)}" style="width:82%;max-width:300px;height:auto" />
      <div style="font-size:.95rem;font-weight:600;color:var(--brand);margin-top:12px">🎵 Worship Team Roster</div>
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
  activeTab = 'home';
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
