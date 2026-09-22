# Mission Hero — MVP Sprint Plan

Sprints are vertical, not horizontal. Each ends with something a family could actually
use, and with green tests. **No sprint starts while a previous sprint's critical tests
are red** (§55 of the brief).

## Sprint 0 — Foundations _(this deliverable)_

- Architecture docs (this set), reviewed against security / scalability / child safety /
  data integrity / maintainability.
- Repo init: Next.js 15 + React 19 + TypeScript strict + Tailwind + Prisma + Vitest +
  Playwright + ESLint + Prettier.
- Full Prisma schema and first migration.
- `src/domain` pure rules with unit tests: levels, streaks, recurrence, wheel draw,
  badge tiers, idempotency keys, copy guard.
- Session layer: parent session, child session, device binding, guards.
- `createAction()` wrapper: guard → Zod → service → audit.
- Seed: the Adventure Family (§45).

**Exit:** `lint`, `typecheck`, `test:unit` green; `db:reset && db:seed` works.

## Sprint 1 — Vertical Slice 1: task → approval → ledger _(§47)_

- Parent register / login / logout; family + child creation.
- Task creation with schedule; assignment to children.
- Child family-code binding, profile picker, PIN.
- Child home with today's missions; submit completion.
- Parent approval queue; approve / reject / request redo.
- Ledger service (XP, points, stars) with idempotency.
- Streak + achievement evaluation hooks.
- Audit log.
- Celebration screen showing the exact server-awarded values.

**Exit:** the §47 journey passes end to end in Playwright; all §46 tests covering
slice 1 pass, including double-approval, child-cannot-approve and cross-family blocks.

## Sprint 2 — Vertical Slice 2: character system _(§48)_

- Traits (platform defaults cloned per family + custom traits).
- Character check-in UI with animated trait cards and a story.
- Parent character queue: confirm / ask / not-this-time / encouragement.
- Star ledger, trait totals, character badges (Bronze→Diamond), character streak.
- Character profile page with positive framing.

**Exit:** §48 journey green end to end; "approval awards exactly one star" and
"submission awards nothing" pass.

## Sprint 3 — Vertical Slice 3: reward wheel _(§49)_

- Wheel configuration (segments, weights, threshold, cooldown, spins per period).
- Server-side weighted draw, persisted before response.
- Animated wheel landing on the server's segment.
- Point deduction in-transaction; parent notification.

**Exit:** §49 journey green; "locked below threshold", "unlocked above",
"result persisted", "points deducted", "replay does not re-roll" all pass.

## Sprint 4 — Daily loop completeness _(complete)_

- Daily check-in (mood, goal, gratitude) with the once-per-day constraint, and
  a prompt on the child home that disappears once today's is done.
- Reward store: the child-facing catalogue, and the parent side — creating
  rewards, and resolving requests with an automatic refund on a decline.
- Weekly goal widget and progress maths, moved into `src/domain/progress.ts`.
- Notifications: an in-app inbox for both roles, with unread badges.

Two things were pulled in because the loop is not usable without them:

- **Parent screens for children and missions.** Sprint 1 built the services but
  not the forms, which left the seed as the only way to create either. A parent
  can now add a hero and a mission from an empty family.
- **Perfect weeks.** `AchievementSnapshot.perfectWeeks` was hard-coded to 0, so
  the Perfect Week achievement could never unlock. It is now computed from the
  occurrence history, and the snapshot takes an injectable "today" so the rule
  is testable without waiting a week.

**Exit:** lint, typecheck, 100 unit, 184 integration, build and 15 E2E green.

## Sprint 5 — Learning & discovery _(complete)_

- Memory challenges end to end: a parent writes one, the child reads it, chooses
  **Ready to recite** (which hides the text), types it from memory, and the
  parent compares the two side by side. "Nearly there" awards nothing and
  reopens it; approval pays out once per child, ever.
- Secret missions gained the half they were missing: a found mission can now be
  claimed, and a parent can approve or reopen it.
- **Bonus challenges** share the `SecretMission` model with a
  `requiresDiscovery` flag rather than getting a near-duplicate table — the
  fields, the submission and the approval are identical, and the only real
  difference is whether the child has to find it first. They award under the
  `BONUS_CHALLENGE` ledger source so a child's history reads truthfully.

Two gaps closed along the way:

- The memory queue rendered submissions with **no approve button**, so a
  recitation could be seen but never paid out.
- Neither memory nor quests had a decline path, which meant a parent's only
  options were to approve or to leave the item in the queue forever.

**Exit:** lint, typecheck, 100 unit, 202 integration, build and 19 E2E green.

## Sprint 6 — Progression & delight _(complete)_

- Sixteen collectibles and ten pieces of avatar gear, all free, unlocking from
  levels, achievements, stars, streaks, quests and memory — deliberately never
  from spendable points. Evaluated in the same transaction as the award that
  earned them.
- Adventure map: a second reading of the weekly quest, not a second score.
- Level-up banner and notification; achievements catalogue on the child profile.

## Sprint 7 — Parent depth _(complete)_

- Progress dashboards over twelve weeks, character history, mission history and
  the full ledger, so a disputed balance can be reconstructed.
- Read-only audit viewer; manual bonuses that insist on a reason.
- Settings for media, features, award values, the parent gate, and per-child
  nickname, theme, motion, PIN and archiving.
- Second-parent invites: single-use token, two-week expiry, consumed inside the
  transaction that grants membership.
- Data export as JSON and permanent family deletion.

## Sprint 8 — Production hardening _(complete)_

- Failure-only rate limiting: correct answers never spend a token, so a family
  signing in or binding several devices is never throttled.
- Per-request CSP nonce, HSTS and the rest of the security headers on every
  route.
- Error boundaries, loading skeletons and empty states on both surfaces.
- Axe audits across all twenty routes, a keyboard walk-through, and a reduced-
  motion check that asserts animation is _removed_, not merely sped up.
- Dockerfile, compose file, and an operations runbook
  ([docs/11](./11-operations.md)) covering migrations, backup and restore,
  monitoring, and what has to change before running more than one instance.

### Bugs this sprint surfaced

Worth recording, because each was invisible until something specifically
looked for it:

1. **Every script blocked in production.** Next reads the CSP nonce from the
   _request_ header; setting it only on the response left its scripts
   unnonced, and `'strict-dynamic'` then makes browsers ignore `'self'`. The
   site still rendered and server actions still worked by progressive
   enhancement, so it looked fine. `e2e/security.spec.ts` now asserts a nonce
   is present and no CSP refusals occur.
2. **Contrast failures in eight of nine themes.** Brand and status colours were
   chosen for fills, then used as text on white. Axe caught it; the tokens are
   now split so anything used as text clears 4.5:1.
3. **A same-route redirect that did nothing.** `bindDeviceAction` redirected to
   the page it was already on, which the client router serves from cache — a
   child typed the family code, tapped Go, and nothing happened.
4. **The PIN limiter punished profile switching.** It counted every profile tap,
   so a family sharing a tablet was locked out after five switches.
5. **Mission order was non-deterministic**, so a child's list could reshuffle
   between page loads.

### The end-to-end suite

Fixing (1) is what made the client-side behaviour real for the first time.
Before it, the app was effectively server-rendered-only and the Playwright
specs were unknowingly written against that. Chasing the resulting failures
turned up three more defects, all of which only exist once JavaScript runs:

6. **Setting a cookie and redirecting in one action response races.**
   `selectChildAction` set the child session and redirected to `/kids/home`;
   the router could request that page before the browser had committed the
   `Set-Cookie`, so the guard saw no session and bounced straight back to the
   picker. Navigation now happens from the client once the action has resolved.
7. **`useActionState` forms do not progressively enhance** without a
   `permalink`. Before hydration their submit is an ordinary POST carrying no
   action reference, so the server re-renders the same page and the click
   appears to do nothing. The test helper now waits for React to attach to the
   specific control before clicking it.
8. **Playwright reuses a running dev server.** `next start` reads the build
   once, at boot, so a rebuilt `.next` was silently ignored and several fixes
   looked like they had failed. `reuseExistingServer` is now false, and the
   server's stdout is piped so a server-side error stops reading as "nothing
   happened".

Three more went the same way once the harness stopped lying about what it was
testing:

9. **A picker that only sometimes appeared.** Fixing (3) by redirecting to the
   same route swapped a dead button for an intermittent one: roughly a quarter
   of binds still landed back on the code form, because the client router
   served `/kids` from its cache. Measured at 15 of 20. The profile picker now
   lives on its own route, `/kids/who`, so the redirect crosses a route
   boundary and there is nothing to serve from cache. 20 of 20 after.
10. **Approval rows stayed on screen after being actioned.** The five parent
    queues rendered from a server payload and did not re-fetch, so an approved
    or declined row sat there looking unactioned until a manual reload. Each
    row now hides itself once its action resolves without an error.
11. **Assertions on flash messages rather than outcomes.** Several specs waited
    on a transient confirmation banner or an exact unread count — both true
    only for a moment, and the second one dependent on what earlier tests in
    the file had sent. They now assert the durable result: the row is in the
    list, the balance is what it should be.

The suite is **green: 27 of 27**, twice consecutively, and it is blocking in
CI alongside every other tier.

A note on cost, because it was most of the sprint: (8) alone accounted for
several hours of chasing fixes that had in fact worked. Anything that lets a
harness test a stale build is worth eliminating outright rather than
remembering to avoid, which is why `reuseExistingServer` is false even
locally.
