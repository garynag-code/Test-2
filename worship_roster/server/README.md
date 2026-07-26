# Worship Roster — shared backend (Cloudflare Worker + D1 + Web Push)

This optional backend turns the app from per-device into a **shared, live roster
across every phone**, and delivers **Web Push reminders**. It's a single
Cloudflare Worker backed by D1 (managed SQLite). The front-end works fully
without it (local mode); turn this on only when you want sync + push.

## What it provides

- Team-scoped sync of members, Sunday assignments, votes, locked practice dates
  and song lists.
- **Majority-vote locking enforced server-side** — a date locks only with a
  strict majority, and a locked date can't change without a leader calling a new
  vote (the client can't bypass this).
- **Web Push reminders** via a daily cron: the Wednesday song-list nudge for
  leaders and a 2-days-before practice reminder for musicians.

## Security (summary — full detail in ../SECURITY.md)

- Device tokens and invite codes are stored **hashed** (SHA-256), never in clear.
- Every request is authenticated and **scoped to the caller's team**; leader-only
  actions are enforced on the server.
- Strict **CORS allow-list**, request-size cap, input validation, parameterised
  D1 queries, security headers. The VAPID private key is a **Worker secret**,
  never shipped to clients or committed.

## Deploy

Prerequisites: a (free) Cloudflare account and Node 18+.

```bash
cd worship_roster/server
npm install
npx wrangler login

# 1) Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create worship-roster

# 2) Create the tables
npx wrangler d1 execute worship-roster --remote --file=./schema.sql

# 3) Generate VAPID keys for Web Push (any web-push tool works), e.g.:
npx web-push generate-vapid-keys
#   -> put the PUBLIC key in wrangler.toml [vars] VAPID_PUBLIC_KEY
#   -> store the PRIVATE key as a secret (never commit it):
npx wrangler secret put VAPID_PRIVATE_KEY

# 4) Set ALLOWED_ORIGINS in wrangler.toml to your front-end origin(s), e.g.
#    "https://garynag-code.github.io"  (comma-separate multiple; never use *)

# 5) Deploy
npx wrangler deploy
```

`wrangler deploy` prints your Worker URL (e.g.
`https://worship-roster-api.<you>.workers.dev`).

## Point the front-end at it

Edit `worship_roster/js/config.js`:

```js
window.ROSTER_CONFIG = {
  apiBase: "https://worship-roster-api.<you>.workers.dev",
  vapidPublicKey: "<your VAPID public key>",
};
```

Redeploy the static site. On first open each phone sees a **Connect** screen:
the leader taps *Start a new team* (gets an invite code to share), everyone else
taps *Join a team* with that code. Enabling notifications on the Reminders tab
registers that device for push.

## Tests

No cloud account needed — the suite runs the real Worker over in-memory SQLite
and exercises the real front-end API client:

```bash
npm test
```

- `test/unit.mjs` — hashing, validation, majority tally, and a VAPID JWT
  sign+verify round-trip (proves the push auth crypto is correct).
- `test/integration.mjs` — every endpoint end-to-end: auth, CORS blocking,
  one-vote-per-block, majority-lock enforcement, leader-only actions, the
  locked-date rule, and input validation.
- `test/client.mjs` — the actual `js/api.js` browser client driven against the
  real Worker (session persistence, vote→lock, join, error handling).

`test/api-bridge.mjs` is a dev-only HTTP wrapper (real Worker over SQLite) for
manual/browser testing; it is **not** used in production.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/teams` | – | Create team; returns invite code + leader token |
| POST | `/api/teams/join` | – | Join with invite code; returns member token |
| GET | `/api/state` | member | Full shared team state |
| PUT | `/api/assignments` | member | Set a Sunday position assignment |
| POST | `/api/votes` | member | Cast/replace this member's vote for a block |
| POST | `/api/practices/lock` | **leader** | Lock the majority winner |
| POST | `/api/practices/new-vote` | **leader** | Clear a lock and reset votes |
| POST | `/api/songs` | **leader** | Add a song to a month |
| DELETE | `/api/songs/:id` | **leader** | Remove a song |
| POST | `/api/push/subscribe` | member | Register this device for push |
