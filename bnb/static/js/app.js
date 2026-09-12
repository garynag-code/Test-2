/* Perch — application shell.
 *
 * Plain ES modules, no build step and no framework.  A booking manager for a
 * four-room guesthouse should be something one person can still read, fix and
 * deploy in five years' time.
 */

import { api, ApiError } from './api.js';
import { addDays, interpolate, isoOf, makeFormatters, nightsBetween, toLocalDate } from './format.js';
import { renderGrid } from './grid.js';
import { enqueue, flush, newKey, pending } from './queue.js';
import {
  configure, currentEmail, isEnabled, signIn, signOut, signUp, token,
} from './session.js';

const state = {
  boot: null,
  fmt: null,
  strings: {},
  view: 'calendar',
  start: null,
  days: 21,
};

const $ = (selector) => document.querySelector(selector);
const show = (selector, visible) => { $(selector).hidden = !visible; };
const t = (key, values) => interpolate(state.strings[key] ?? key, values);

/* A polite live region: the owner is told what happened without losing their
   place, and without a modal they have to dismiss one-handed. */
function announce(message, tone = 'ok') {
  const region = $('#status');
  region.className = `notice ${tone}`;
  region.textContent = message;
  region.hidden = !message;
}

function setBusy(isBusy) {
  $('#main').setAttribute('aria-busy', String(isBusy));
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

/* Entry point. Works out whether this instance has a login at all, and only
   then decides what to put on screen. */
async function start() {
  const chosen = localStorage.getItem('perch.locale') || undefined;
  const config = await api.authConfig();
  configure(config);

  // Strings for the sign-in screen arrive with the config, since there is no
  // property to take a language from until someone has signed in.
  state.strings = config.i18n.strings;
  document.documentElement.lang = config.i18n.locale;
  document.documentElement.dir = config.i18n.dir;

  if (!isEnabled() || await token()) {
    await boot();
    return;
  }
  showSignIn();
}

function showSignIn() {
  show('#signin-screen', true);
  show('#app-screen', false);
  show('#app-header', false);
  show('#tabs', false);

  $('#signin-title').textContent = t('auth.title');
  $('#signin-intro').textContent = t('auth.intro');
  $('#s-email-label').textContent = t('auth.email');
  $('#s-password-label').textContent = t('auth.password');
  $('#signin-submit').textContent = t('auth.signin');
  $('#signin-switch').textContent = t('auth.switch_signup');
  $('#signin-error').textContent = '';
  $('#s-email').focus();
}

function showApp() {
  show('#signin-screen', false);
  show('#app-screen', true);
  show('#app-header', true);
  show('#tabs', true);
}

async function boot() {
  const chosen = localStorage.getItem('perch.locale') || undefined;
  state.boot = await api.bootstrap(chosen);
  const { i18n, property } = state.boot;

  state.strings = i18n.strings;
  state.fmt = makeFormatters(i18n.locale, property.currency);
  state.start = state.boot.today;

  document.documentElement.lang = i18n.locale;
  document.documentElement.dir = i18n.dir;      // one attribute flips the layout
  document.title = `${t('app.name')} — ${property.name}`;

  $('#property-name').textContent = property.name;
  $('#property-meta').textContent = `${property.timezone} · ${property.currency}`;

  buildLanguagePicker(i18n);
  buildTabs();
  bindGlobalEvents();
  showApp();

  const signout = $('#signout');
  signout.hidden = !isEnabled();
  if (isEnabled()) {
    signout.textContent = t('auth.signout');
    signout.title = currentEmail() || '';
  }

  await render();
  registerServiceWorker();
  void flushQueue({ quiet: true });
}

function buildLanguagePicker(i18n) {
  const select = $('#language');
  select.replaceChildren(...Object.entries(i18n.languages).map(([code, label]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    option.selected = code === i18n.locale;
    return option;
  }));
  select.setAttribute('aria-label', t('common.language'));
  select.addEventListener('change', async () => {
    localStorage.setItem('perch.locale', select.value);
    await boot();                              // cheapest correct re-render
  });
}

const TABS = [
  { id: 'calendar', key: 'nav.calendar' },
  { id: 'list', key: 'nav.agenda' },
  { id: 'today', key: 'nav.today' },
  { id: 'conflicts', key: 'nav.conflicts' },
  { id: 'channels', key: 'nav.channels' },
  { id: 'insights', key: 'nav.insights' },
];

function buildTabs() {
  const nav = $('#tabs');
  nav.replaceChildren(...TABS.map((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `tab-${tab.id}`;
    button.role = 'tab';
    button.setAttribute('aria-selected', String(state.view === tab.id));
    button.setAttribute('aria-controls', 'main');
    button.tabIndex = state.view === tab.id ? 0 : -1;
    button.textContent = t(tab.key);
    if (tab.id === 'conflicts' && state.boot.conflicts > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(state.boot.conflicts);
      // The count is meaningful, so it must be spoken, not just seen.
      badge.setAttribute('aria-label', `${state.boot.conflicts} ${t('nav.conflicts')}`);
      button.appendChild(badge);
    }
    button.addEventListener('click', () => select(tab.id));
    return button;
  }));

  // Tablist keyboard convention: arrows move between tabs, not Tab.
  nav.addEventListener('keydown', (event) => {
    const order = TABS.map((tab) => tab.id);
    const index = order.indexOf(state.view);
    const rtl = document.documentElement.dir === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    select(order[(index + step + order.length) % order.length]);
    $(`#tab-${state.view}`).focus();
  });
}

function select(view) {
  state.view = view;
  for (const tab of TABS) {
    const button = $(`#tab-${tab.id}`);
    button.setAttribute('aria-selected', String(tab.id === view));
    button.tabIndex = tab.id === view ? 0 : -1;
  }
  void render();
}

function bindGlobalEvents() {
  $('#sync').addEventListener('click', runSync);
  $('#signout').addEventListener('click', () => {
    signOut();
    showSignIn();
  });
  window.addEventListener('online', () => {
    document.body.classList.remove('is-offline');
    void flushQueue();
  });
  window.addEventListener('offline', () => document.body.classList.add('is-offline'));
  document.body.classList.toggle('is-offline', !navigator.onLine);
  $('#offline-banner').textContent = t('common.offline');
}

// --------------------------------------------------------------------------
// Views
// --------------------------------------------------------------------------

async function render() {
  const main = $('#main');
  main.setAttribute('aria-labelledby', `tab-${state.view}`);
  setBusy(true);
  try {
    const views = {
      calendar: renderCalendar,
      list: renderList,
      today: renderToday,
      conflicts: renderConflicts,
      channels: renderChannels,
      insights: renderInsights,
    };
    await views[state.view](main);
  } catch (error) {
    main.replaceChildren(errorCard(error));
  } finally {
    setBusy(false);
  }
}

function errorCard(error) {
  if (error instanceof ApiError && error.status === 401 && isEnabled()) {
    // The session lapsed while the app was open.
    signOut();
    showSignIn();
    return document.createElement('span');
  }
  const card = document.createElement('div');
  card.className = 'notice danger';
  card.setAttribute('role', 'alert');
  card.textContent = error instanceof ApiError && error.status === 0
    ? t('common.offline')
    : `${t('common.error')} ${error.message || ''}`.trim();
  return card;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

// ---- calendar ------------------------------------------------------------

async function renderCalendar(main) {
  const end = addDays(state.start, state.days);
  const data = await api.calendar(state.start, end);

  const controls = el('div', { className: 'row card' }, [
    el('button', { type: 'button', className: 'ghost', textContent: t('cal.prev'),
      onclick: () => { state.start = addDays(state.start, -7); void render(); } }),
    el('button', { type: 'button', className: 'ghost', textContent: t('cal.jump_today'),
      onclick: () => { state.start = state.boot.today; void render(); } }),
    el('button', { type: 'button', className: 'ghost', textContent: t('cal.next'),
      onclick: () => { state.start = addDays(state.start, 7); void render(); } }),
    el('span', { className: 'muted',
      textContent: `${state.fmt.shortDate(state.start)} – ${state.fmt.shortDate(addDays(end, -1))}` }),
    el('button', { type: 'button', className: 'primary', textContent: t('book.new'),
      style: 'margin-inline-start:auto', onclick: () => openBookingForm() }),
  ]);

  const scroll = el('div', { className: 'grid-scroll' });
  const legend = el('div', { className: 'legend' }, ['open', 'sold', 'held', 'closed'].map((key) => {
    const swatch = el('span', { className: 'swatch' });
    swatch.dataset.state = key;              // .dataset is read-only, so not via el()
    return el('span', {}, [swatch, t(`cal.${key}`)]);
  }));

  main.replaceChildren(controls, scroll, legend, el('p', {
    className: 'muted', textContent: t('view.list_hint') }));

  renderGrid({
    mount: scroll,
    data,
    start: state.start,
    end,
    today: state.boot.today,
    fmt: state.fmt,
    t,
    onSelect: ({ room, iso, cell }) => {
      if (cell?.booking_id) openBookingDetail(cell.booking_id);
      else openBookingForm({ roomId: room.id, checkin: iso, checkout: addDays(iso, 1) });
    },
  });
}

// ---- list ----------------------------------------------------------------

async function renderList(main) {
  const end = addDays(state.start, 60);
  const { stays } = await api.agenda(state.start, end);
  const list = el('ul', { className: 'stays' });

  if (!stays.length) {
    main.replaceChildren(el('p', { className: 'muted', textContent: t('today.none') }));
    return;
  }

  for (const stay of stays) {
    const count = nightsBetween(stay.checkin, stay.checkout);
    list.append(el('li', {}, [
      el('span', { className: 'who', textContent: stay.guest_name || t('cal.closed') }),
      el('span', { className: 'when',
        textContent: `${state.fmt.fullDate(stay.checkin)} → ${state.fmt.fullDate(stay.checkout)} · ${t('book.nights', { count })}` }),
      el('span', { className: 'where',
        textContent: `${stay.room_name}${stay.channel_name ? ` · ${stay.channel_name}` : ''}` }),
      el('button', { type: 'button', className: 'ghost', textContent: t('book.cancel'),
        onclick: () => cancelStay(stay.id) }),
    ]));
  }

  main.replaceChildren(
    el('h2', { textContent: t('nav.agenda') }),
    el('p', { className: 'muted', textContent: t('view.list_hint') }),
    list);
}

// ---- today ---------------------------------------------------------------

async function renderToday(main) {
  const sheet = await api.day(state.boot.today);
  const section = (titleKey, rows) => {
    const body = rows.length
      ? el('ul', { className: 'stays' }, rows.map((row) => el('li', {}, [
          el('span', { className: 'who', textContent: row.guest_name || '—' }),
          el('span', { className: 'where', textContent: row.room_name }),
          el('span', { className: 'when',
            textContent: `${row.guests}p${row.notes ? ` · ${row.notes}` : ''}` }),
        ])))
      : el('p', { className: 'muted', textContent: t('today.none') });
    return el('section', { className: 'card' }, [el('h3', { textContent: t(titleKey) }), body]);
  };

  const turnovers = sheet.turnovers.length
    ? el('div', { className: 'notice warn' }, [
        `${t('today.turnovers')}: ${sheet.turnovers.length}`])
    : null;

  main.replaceChildren(
    el('h2', { textContent: state.fmt.fullDate(sheet.date) }),
    turnovers,
    section('today.arrivals', sheet.arrivals),
    section('today.departures', sheet.departures),
    section('today.staying', sheet.staying));
}

// ---- conflicts -----------------------------------------------------------

async function renderConflicts(main) {
  const { conflicts } = await api.conflicts();
  if (!conflicts.length) {
    main.replaceChildren(
      el('h2', { textContent: t('conflicts.title') }),
      el('div', { className: 'notice ok', textContent: t('conflicts.none') }));
    return;
  }

  const cards = conflicts.map((conflict) => {
    const nights = conflict.nights.split(',').map((iso) => state.fmt.shortDate(iso)).join(', ');
    const side = (labelKey, guest, checkin, checkout, channel) =>
      el('div', {}, [
        el('strong', { textContent: t(labelKey) }),
        el('div', { textContent: guest || '—' }),
        el('div', { className: 'muted',
          textContent: `${state.fmt.fullDate(checkin)} → ${state.fmt.fullDate(checkout)}` }),
        el('div', { className: 'muted', textContent: channel || '' }),
      ]);

    return el('section', { className: 'card' }, [
      el('h3', { textContent: `${conflict.room_name} · ${t('conflicts.nights')}: ${nights}` }),
      el('div', { className: 'row', style: 'gap:24px;align-items:flex-start' }, [
        side('conflicts.incumbent', conflict.incumbent_guest,
             conflict.incumbent_checkin, conflict.incumbent_checkout, conflict.incumbent_channel),
        side('conflicts.challenger', conflict.challenger_guest,
             conflict.challenger_checkin, conflict.challenger_checkout, conflict.challenger_channel),
      ]),
      el('div', { className: 'row' }, [
        el('button', { type: 'button', className: 'primary', textContent: t('conflicts.move'),
          onclick: () => moveChallenger(conflict) }),
        el('button', { type: 'button', className: 'ghost', textContent: t('conflicts.keep'),
          onclick: () => resolveConflict(conflict.id, 'kept as is') }),
      ]),
    ]);
  });

  main.replaceChildren(el('h2', { textContent: t('conflicts.title') }), ...cards);
}

async function moveChallenger(conflict) {
  const rooms = state.boot.rooms.filter((room) => room.id !== conflict.room_id);
  if (!rooms.length) return announce(t('common.error'), 'danger');

  for (const room of rooms) {
    try {
      await api.moveBooking(conflict.challenger_id, { room_id: room.id });
      await api.resolveConflict(conflict.id, `moved to ${room.name}`);
      announce(`${t('conflicts.resolved')} → ${room.name}`);
      state.boot = await api.bootstrap(localStorage.getItem('perch.locale') || undefined);
      buildTabs();
      return render();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      // That room is taken over those nights too; try the next one.
    }
  }
  announce(t('book.clash', { nights: conflict.nights }), 'danger');
}

async function resolveConflict(id, resolution) {
  await api.resolveConflict(id, resolution);
  announce(t('conflicts.resolved'));
  state.boot = await api.bootstrap(localStorage.getItem('perch.locale') || undefined);
  buildTabs();
  await render();
}

// ---- channels ------------------------------------------------------------

async function renderChannels(main) {
  const { channels } = await api.channels();
  const cards = channels.map((channel) => {
    const health = channel.health;
    const statusKey = health.errored ? 'error'
      : health.stale ? 'stale'
      : health.verified ? 'ok' : 'pending';
    const tone = { ok: 'ok', stale: 'danger', error: 'danger', pending: 'warn' }[statusKey];
    const seen = state.fmt.ago(channel.last_success_at) || t('channels.never');

    const exportUrl = `${location.origin}/ical/${channel.export_token}.ics`;
    return el('section', { className: 'card' }, [
      el('div', { className: 'row' }, [
        el('h3', { textContent: channel.name, style: 'margin:0' }),
        el('span', { className: `pill ${tone}`, textContent: t(`channels.status.${statusKey}`) }),
        el('span', { className: 'muted', textContent: t('channels.last_seen', { when: seen }) }),
      ]),
      health.stale || health.errored
        ? el('div', { className: 'notice danger', textContent: t('channels.closed_warning') })
        : null,
      el('div', { className: 'stack' }, [
        el('label', { textContent: t('channels.export_url'), htmlFor: `x-${channel.id}` }),
        el('div', { className: 'row' }, [
          el('input', { id: `x-${channel.id}`, readOnly: true, value: exportUrl,
            style: 'flex:1 1 240px' }),
          el('button', { type: 'button', className: 'ghost', textContent: t('channels.copy'),
            onclick: async () => {
              try { await navigator.clipboard.writeText(exportUrl); announce(t('channels.copied')); }
              catch { $(`#x-${channel.id}`).select(); }
            } }),
        ]),
      ]),
      el('button', { type: 'button', className: 'ghost', textContent: t('channels.sync_now'),
        onclick: () => syncOne(channel.id) }),
    ]);
  });

  main.replaceChildren(el('h2', { textContent: t('channels.title') }), ...cards);
}

async function syncOne(id) {
  setBusy(true);
  try {
    const result = await api.syncChannel(id);
    announce(result.detail || t('channels.status.ok'), result.conflicts ? 'warn' : 'ok');
    await render();
  } catch (error) {
    announce(error.message || t('common.error'), 'danger');
  } finally {
    setBusy(false);
  }
}

async function runSync() {
  setBusy(true);
  try {
    const result = await api.syncAll();
    const conflicts = result.channels.reduce((sum, row) => sum + row.conflicts, 0);
    const closed = result.guards.reduce((sum, row) => sum + row.closed, 0);
    announce(
      `${result.channels.length} · ${conflicts} ${t('nav.conflicts')}${closed ? ` · ${closed} ${t('cal.closed')}` : ''}`,
      conflicts || closed ? 'warn' : 'ok');
    state.boot = await api.bootstrap(localStorage.getItem('perch.locale') || undefined);
    buildTabs();
    await render();
  } catch (error) {
    announce(error.status === 0 ? t('common.offline') : t('common.error'), 'danger');
  } finally {
    setBusy(false);
  }
}

// ---- insights ------------------------------------------------------------

async function renderInsights(main) {
  const end = addDays(state.start, 30);
  const stats = await api.insights(state.start, end);
  const tile = (labelKey, value) => el('div', { className: 'stat' }, [
    el('div', { className: 'value', textContent: value }),
    el('div', { className: 'label', textContent: t(labelKey) }),
  ]);

  const table = el('table', { className: 'plain' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', textContent: t('insights.by_channel') }),
      el('th', { scope: 'col', textContent: t('insights.bookings') }),
      el('th', { scope: 'col', textContent: t('insights.revenue') }),
    ])),
    el('tbody', {}, stats.by_channel.map((row) => el('tr', {}, [
      el('th', { scope: 'row', textContent: row.channel }),
      el('td', { textContent: String(row.bookings) }),
      el('td', { textContent: state.fmt.money(row.revenue_cents) }),
    ]))),
  ]);

  main.replaceChildren(
    el('h2', { textContent: `${state.fmt.shortDate(stats.start)} – ${state.fmt.shortDate(addDays(stats.end, -1))}` }),
    el('div', { className: 'stats' }, [
      tile('insights.occupancy', state.fmt.percent(stats.occupancy)),
      tile('insights.adr', state.fmt.money(stats.adr_cents)),
      tile('insights.revpar', state.fmt.money(stats.revpar_cents)),
      tile('insights.revenue', state.fmt.money(stats.revenue_cents)),
    ]),
    el('div', { className: 'card' }, [table]));
}

// --------------------------------------------------------------------------
// Booking form
// --------------------------------------------------------------------------

function openBookingForm(prefill = {}) {
  const dialog = $('#booking-dialog');
  const form = $('#booking-form');
  form.reset();

  const roomSelect = form.elements.room_id;
  roomSelect.replaceChildren(...state.boot.rooms.map((room) =>
    el('option', { value: String(room.id), textContent: room.name,
      selected: room.id === prefill.roomId })));

  form.elements.checkin.value = prefill.checkin || state.boot.today;
  form.elements.checkout.value = prefill.checkout || addDays(state.boot.today, 1);
  $('#form-error').textContent = '';

  dialog.showModal();
  form.elements.guest_name.focus();
}

function openBookingDetail(bookingId) {
  // v1 keeps this to the action an owner actually needs from the grid.
  if (confirm(t('book.cancel') + '?')) void cancelStay(bookingId);
}

async function cancelStay(bookingId) {
  try {
    await api.cancelBooking(bookingId, 'cancelled by owner');
    announce(t('conflicts.resolved'));
    await render();
  } catch (error) {
    announce(error.message || t('common.error'), 'danger');
  }
}

function wireBookingForm() {
  const form = $('#booking-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      room_id: Number(data.room_id),
      checkin: data.checkin,
      checkout: data.checkout,
      guest_name: data.guest_name || null,
      guest_email: data.guest_email || null,
      guest_phone: data.guest_phone || null,
      guests: Number(data.guests || 1),
      amount_cents: data.amount ? Math.round(Number(data.amount) * 100) : null,
      notes: data.notes || null,
    };

    if (nightsBetween(payload.checkin, payload.checkout) < 1) {
      $('#form-error').textContent = t('common.error');
      return;
    }

    // Minted here, before the network is involved, so a retry from the offline
    // queue is recognised as the same booking rather than a second one.
    const key = newKey();
    try {
      await api.createBooking(payload, key);
      announce(t('book.saved'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const nights = (error.body.clashing_nights || [])
          .map((iso) => state.fmt.shortDate(iso)).join(', ');
        $('#form-error').textContent = t('book.clash', { nights });
        return;                                  // keep the form open to edit
      }
      if (error instanceof ApiError && error.status === 0) {
        enqueue({ kind: 'booking', payload, key });
        announce(t('book.queued'), 'warn');
      } else {
        $('#form-error').textContent = error.message || t('common.error');
        return;
      }
    }
    $('#booking-dialog').close();
    await render();
  });

  $('#booking-cancel').addEventListener('click', () => $('#booking-dialog').close());
}

async function flushQueue({ quiet = false } = {}) {
  if (!pending().length) return;
  const result = await flush((entry) => api.createBooking(entry.payload, entry.key));
  if (!quiet && result.flushed) {
    announce(t('book.saved'));
    await render();
  }
}

let creatingAccount = false;

function wireSignInForm() {
  const form = $('#signin-form');
  const error = $('#signin-error');

  $('#signin-switch').addEventListener('click', () => {
    creatingAccount = !creatingAccount;
    $('#signin-submit').textContent = t(creatingAccount ? 'auth.signup' : 'auth.signin');
    $('#signin-switch').textContent = t(creatingAccount ? 'auth.switch_signin' : 'auth.switch_signup');
    $('#s-password').autocomplete = creatingAccount ? 'new-password' : 'current-password';
    error.textContent = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#signin-submit');
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = t('auth.working');
    error.textContent = '';

    try {
      if (creatingAccount) {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          // Supabase sent a confirmation link; there is no token yet, so
          // say so rather than dropping them on a sign-in screen again.
          error.textContent = t('auth.check_email');
          return;
        }
      } else {
        await signIn(email, password);
      }
      await boot();
    } catch (caught) {
      error.textContent = caught.status >= 400 && caught.status < 500
        ? t('auth.failed')
        : (caught.message || t('common.error'));
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/service-worker.js').catch(() => {
    /* Offline support is an enhancement; the app works without it. */
  });
}

wireBookingForm();
wireSignInForm();
start().catch((error) => {
  document.querySelector('#main').replaceChildren(errorCard(error));
});
