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

## Sprint 5 — Learning & discovery

- Memory challenges (create, assign, recite, approve, award-once).
- Secret missions + hidden objects with per-day placement.
- Bonus challenges.

## Sprint 6 — Progression & delight

- Levels + level-up celebration; adventure map.
- Achievements catalogue + custom achievements.
- Digital collectibles, avatar items and slots, themes.

## Sprint 7 — Parent depth

- Progress dashboards, character history, task history.
- Audit viewer, manual adjustments with reasons.
- Settings: media toggles, PIN policy, notifications, feature pauses, archiving.
- Second-parent invite flow.

## Sprint 8 — Production hardening

- Rate limiting, CSP nonces, security headers.
- Accessibility audit (axe on every route, keyboard walk-through, reduced motion).
- Performance pass, error boundaries, empty/loading states everywhere.
- Data export & family deletion.
- Dockerfile, migration strategy, backup/restore runbook, monitoring hooks.

## Definition of done (every sprint)

1. `npm run lint` — clean.
2. `npm run typecheck` — clean, `strict: true`, no `any` in changed files.
3. `npm run test` — unit + integration green.
4. `npm run test:e2e` — critical paths green.
5. New business rules cited in code and covered by a test.
6. New mutations pass the §14 security checklist in `03-security-model.md`.
7. Every new screen has a loading state, an empty state and an error state.
8. Child-facing copy reviewed against the banned-phrase list (BR-60).
