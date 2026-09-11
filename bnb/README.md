# Perch — one calendar for every platform your rooms are sold on

A booking manager for small bed & breakfasts. It keeps a single authoritative
record of what is sold, feeds every platform from it, and refuses to let the
same room-night be sold twice.

Runs on Python 3.9+ and Flask. No build step, no container platform, no
third-party services. A four-room guesthouse should not need a DevOps team.

```bash
pip install -r requirements.txt          # just Flask
python -m bnb --demo                     # then open http://localhost:5000
```

`--demo` seeds a sample property whose Garden Room has been sold twice — once on
Airbnb, once on Booking.com — so you can see the clash being caught.

---

## What it does

| | |
|---|---|
| **One calendar** | Every room, every night, every channel in one grid — and the same data as a plain list, which is easier with a screen reader or on a small phone. |
| **Two-way channel sync** | Import each platform's calendar, publish one back. A sale anywhere closes the night everywhere. |
| **Clash inbox** | When two platforms sell the same night anyway, both stays are shown side by side with one-tap "move to another room". |
| **Day sheet** | Who is arriving, who is leaving, which rooms turn over the same day. |
| **Money** | Occupancy, average nightly rate, earnings per room, and which platform the bookings came from. |
| **Works offline** | The whole app opens with no signal; bookings taken offline sync when the connection returns. |
| **Seven languages** | English, Spanish, Portuguese, French, German, Italian, Arabic — with the layout flipping for right-to-left. |

---

## How double bookings are actually prevented

Everything rests on one table. `room_night` holds one row per **occupied**
room-night, keyed on `(room_id, night)`. The absence of a row means the night is
open. Because that pair is the primary key, two reservations for the same
room-night **cannot both exist** — the second write is refused by the storage
engine, not by a check somewhere in the application that a future refactor might
delete.

Four rules sit on top of it:

1. **Serialised writes.** Every availability change runs inside
   `BEGIN IMMEDIATE`, so two reservations arriving at the same instant are
   ordered rather than interleaved. (There is a test that runs two real threads
   at a barrier and asserts exactly one wins.)
2. **Idempotency.** Platforms retry deliveries. Every inbound reservation carries
   a key; a replay returns the original booking instead of selling the room
   again. The offline queue mints its key the moment the owner presses save, for
   the same reason.
3. **Full reconciliation, not incremental patches.** Every import re-reads a
   channel's complete calendar and diffs it. Incremental sync accumulates silent
   drift — a cancellation whose webhook was dropped leaves a room blocked for a
   stay that no longer exists — and only a full diff reliably catches it.
4. **Fail closed.** Anything that cannot be placed goes to the clash inbox rather
   than being dropped, and anything that cannot be confirmed comes off sale
   rather than staying bookable.

### Two tiers of connection

**iCal** is the free tier and needs no partnership, certification or fee: Airbnb,
Vrbo, Booking.com and most regional OTAs will publish a feed and subscribe to
one. The trade is latency — the far side may only re-read you every few hours.

**API** is the paid tier: reservations arrive by webhook in seconds
(`POST /hooks/<token>`), reached either directly once volume justifies
certification, or from day one through an aggregator.

Because iCal channels are slow, they are treated as untrusted:

- **Stop-sell window.** A platform that re-reads you every three hours cannot be
  trusted with tomorrow's last room, so late arrivals are presented to it as
  busy. This is *not* written to the ledger — the owner can still sell those
  nights on the phone or at the door.
- **Hold the last room.** Optionally, the property's final open room on a night
  is withheld from the platforms and kept for direct booking.
- **A dark channel closes its inventory.** If a feed stops answering we no longer
  know what it has sold, so those nights come off sale and the owner is told.
  An unsold night costs one night's rate; a walked guest costs a relocation, a
  refund, and a review that suppresses bookings for a year. Nights already sold
  are never touched by a closure sweep, and inventory reopens automatically when
  the channel recovers.
- **Never echo a channel's own bookings back to it.** Otherwise the two calendars
  amplify each other into a loop of phantom blocks.

---

## Layout

```
bnb/
  dates.py        stay-date arithmetic — calendar dates, never instants
  db.py           schema; the (room_id, night) primary key lives here
  ledger.py       placing, moving, cancelling, closing; the clash inbox
  icalendar.py    RFC 5545 reader and writer (stdlib only)
  sync.py         channel import/export, reconciliation, the fail-closed guards
  i18n.py         interface strings for seven languages
  web.py          JSON API, the outbound feed, the inbound hook
  sample.py       the demo property
  static/         the progressive web app — plain ES modules, no build step
```

## API

| | |
|---|---|
| `GET /api/bootstrap` | property, rooms, channels, language bundle |
| `GET /api/calendar` `?start&end` | the grid |
| `GET /api/agenda` `?start&end` | the same data as a list |
| `GET /api/day` `?date` | arrivals, departures, turnovers |
| `GET /api/insights` `?start&end` | occupancy, ADR, RevPAR, revenue by channel |
| `GET /api/availability` `?checkin&checkout` | which rooms are free |
| `POST /api/bookings` | create one (honours an `Idempotency-Key` header) |
| `POST /api/bookings/<id>/cancel` · `/move` | release or relocate |
| `GET /api/conflicts` · `POST /api/conflicts/<id>/resolve` | the clash inbox |
| `POST /api/channels/<id>/sync` · `POST /api/sync` | pull the platforms in |
| `GET /ical/<export_token>.ics` | what the platforms subscribe to |
| `POST /hooks/<inbound_token>` | the paid tier's inbound reservations |

A clash returns **409** with the offending nights, so the owner can offer another
room while the guest is still on the phone. A clash arriving over the *webhook*
returns **200**: the far side has already sold it, and an error would make it
retry forever over something only the owner can settle.

The export token is a read URL handed to the platforms; the inbound token
authorises writes and is never sent to the browser.

---

## Accessibility

Built to WCAG 2.2 AA, and tested rather than asserted:

- The calendar is a real `<table>` with `scope="col"` and `scope="row"` headers,
  so a screen reader announces *"Garden Room, Friday 3 April, booked, Jonas"*
  from the table semantics alone.
- A **roving tabindex** gives the grid one tab stop with arrow keys moving
  inside it. Three months across six rooms would otherwise be 500+ tab stops.
- **Colour is never the only signal.** Every state also carries a letter, and
  off-sale nights are striped as well as filled.
- 44px targets, 16px minimum text, visible focus rings everywhere, and
  `prefers-reduced-motion` and `prefers-contrast` honoured.
- The list view is a first-class alternative, not a fallback.

## Global by construction

- Stay dates are stored and compared as **local calendar dates**. A check-in
  stored as a UTC timestamp renders as the previous day for anyone west of
  Greenwich — the most common and most damaging bug in accommodation software.
- Dates, times, numbers and currency are formatted through `Intl` with the
  property's locale, including first-day-of-week and the correct weekend days
  (Friday–Saturday across much of the Middle East).
- Right-to-left is a real layout flip driven by one `dir` attribute: the
  stylesheet uses logical properties throughout, and the grid's arrow keys
  follow reading order rather than screen order.
- Translations fall back key by key, so a half-finished language ships half its
  coverage instead of none. A test asserts none are missing and that no
  translation has dropped a `{placeholder}`.

## Tests

```bash
python -m pytest tests/ -q
```

Covering the storage-level double-booking guarantee, a genuine two-thread race,
idempotent replays, feed reconciliation, the fail-closed guards, UTF-8 line
folding for non-Latin guest names, and the full HTTP surface.
