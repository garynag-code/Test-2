# Mission Hero

> **Big Goals. Small Wins. Awesome Kids.**

A family app that turns real-world responsibility and character growth into an
adventure. Children see a game. Parents see a calm, controlled, auditable
system. The two are the same data, viewed from different ends.

---

## The one rule everything else follows

> **The client never creates value.**

Every XP point, Reward Point, Character Star, badge and wheel outcome is decided
by the server, inside a database transaction, exactly once. A child with the dev
tools open can change what the page _looks_ like; they cannot change what they
have earned.

This is enforced in four places, deliberately overlapping:

1. **Schema** — three append-only ledgers, with `CHECK (amount > 0)` on XP and
   Character Stars so lifetime XP cannot fall and stars cannot be spent.
2. **Idempotency** — every award carries a key derived from the row that caused
   it, unique per child, so a double-tapped _Approve_ pays once.
3. **Transactions** — status guard, row lock, ledger writes, streak, achievements
   and audit all commit together or not at all.
4. **Authorization** — `familyId` comes only from a signed session cookie, never
   from a request, and "not yours" returns 404 rather than 403.

## Quick start

```bash
cp .env.example .env          # then set AUTH_SECRET and DATABASE_URL
npm install
npm run db:migrate            # creates the schema and its invariants
npm run db:seed               # the Adventure Family demo
npm run dev                   # http://localhost:3000
```

The seed prints what you need to log in:

| Who          | How                                                         |
| ------------ | ----------------------------------------------------------- |
| Mom          | `mom@adventure.family` / `MissionHero123!`                  |
| Dad          | `dad@adventure.family` / `MissionHero123!`                  |
| Josh & Sarah | open `/kids`, enter family code **ADVENTUR**, tap an avatar |

## Try the three journeys

1. **Mission → approval → reward.** As Josh, tap **DONE!** on _Read for 20
   minutes_ and add a note. As Mom, open **Approvals**, add encouragement and
   approve. Josh's XP and points move — by the amount the server decided.
2. **Character check-in.** As Josh, open **Character**, tap _I was kind today_
   and write what happened. As Mom, confirm it. Exactly one Kindness star, and
   the badge ladder advances.
3. **Reward wheel.** Josh starts with 120 points and the wheel needs 100. Spin
   it, then reload mid-celebration: the result is already committed, so it
   cannot be re-rolled.
4. **The daily loop.** Check in as Josh (once — reopening the app won't pay
   again), redeem ice cream from the store, then decline it as Mom and watch
   every point come back.
5. **Learning and discovery.** Recite a verse from memory (the text hides the
   moment you start), and take on a bonus challenge from **Quests** — no
   hunting required, unlike the secret missions hidden around the app.

## Commands

| Command                                                     | What it does                                         |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `npm run dev`                                               | Development server                                   |
| `npm run build`                                             | Production build (runs `prisma generate` first)      |
| `npm run lint`                                              | ESLint, including the layering and `no-danger` rules |
| `npm run typecheck`                                         | TypeScript, `strict`                                 |
| `npm run test`                                              | Unit + integration (integration needs PostgreSQL)    |
| `npm run test:unit`                                         | Pure domain rules only — milliseconds, no database   |
| `npm run test:integration`                                  | Services against a real database                     |
| `npm run test:e2e`                                          | Playwright, the three vertical slices                |
| `npm run db:migrate` / `db:seed` / `db:reset` / `db:studio` | Database                                             |

## Architecture

The full set lives in [`docs/`](./docs/README.md):

| #   | Document                                                         |
| --- | ---------------------------------------------------------------- |
| 01  | [Architecture proposal & ADRs](./docs/01-architecture.md)        |
| 02  | [Data model and ERD](./docs/02-data-model.md)                    |
| 03  | [Security & child-safety model](./docs/03-security-model.md)     |
| 04  | [User journeys](./docs/04-user-journeys.md)                      |
| 05  | [Folder structure](./docs/05-folder-structure.md)                |
| 06  | [Business rules BR-1 … BR-61](./docs/06-business-rules.md)       |
| 07  | [MVP sprint plan](./docs/07-mvp-sprint-plan.md)                  |
| 08  | [Test strategy](./docs/08-test-strategy.md)                      |
| 09  | [Wireframes](./docs/09-wireframes.md)                            |
| 10  | [Internal architecture review](./docs/10-architecture-review.md) |

Four layers, with an import matrix that ESLint enforces:

```
app/**            rendering and form wiring only
  ↓
server/auth       resolves the caller to a ParentActor | ChildActor
  ↓
features/*/service business rules, transactions, idempotency, audit
  ↓
features/*/repo   the only place Prisma is imported
```

`src/domain/` sits outside all of it: pure, dependency-free rules — the level
curve, schedule expansion, streak arithmetic, the weighted draw, badge tiers and
the child-facing copy. It is where product tuning happens, and it tests in
milliseconds.

## Stack

Next.js 15 · React 19 · TypeScript (strict) · Tailwind · Prisma · PostgreSQL ·
Zod · Vitest · Playwright.

## Testing

| Tier                | Count | What it proves                                                                                                                 |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| Domain unit         | 130   | Pure rules, including a seeded 60k-trial check that the wheel's odds match its configuration                                   |
| Service integration | 244   | Transactions, constraints, idempotency, authorization and concurrency — against real PostgreSQL, with Prisma never mocked      |
| End-to-end          | 27    | The vertical slices, daily loop, learning, the threat model and accessibility, in a real browser at phone width — see _Status_ |

The integration tier is deliberately the heaviest. The risky question in this
product is "did exactly one ledger row get written under concurrency", and a
mocked database cannot answer it — it cannot fail a unique constraint.

Notable tests, because they encode promises rather than implementation:

- Two parents approving the same mission at the same instant award once.
- Two children redeeming the last item: one succeeds, inventory never goes negative.
- Reopening the app all day cannot farm check-in XP.
- A child cannot approve their own task, read a sibling's profile, or reach a
  parent route.
- Lifetime XP is non-decreasing across any interleaving of awards and spends.
- `src/domain/copy.test.ts` fails the build if shame or loss language reaches the
  child surface.

## Child safety and anti-manipulation

These are treated as engineering constraints, not copy decisions:

- **No column exists** for a child's email, phone or full date of birth. A future
  feature cannot start collecting them without a migration a reviewer would see.
- Media uploads default to **off**, per family.
- Nothing is public: no share links, no cross-family comparison, no chat, no
  leaderboards, no third-party analytics on any child-facing route.
- Hidden objects are placed by a deterministic per-child, per-day hash, so
  refreshing cannot conjure one — an anti-compulsion measure as much as an
  anti-farming one.
- The wheel costs _earned_ points, has parent-visible odds and no purchase path.
  No loot boxes, no near-miss easing, no countdown pressure.
- A broken streak reads "New streak starts today." The word "lost" is on a banned
  list with a test behind it.

## Status

All eight sprints in [the plan](./docs/07-mvp-sprint-plan.md) are complete: the
foundations, the three vertical slices, the daily loop, learning and discovery,
progression and collectibles, parent depth, and production hardening. A parent
can take a brand-new family from nothing through missions, character, rewards,
memory, quests, settings, a second parent, a data export and deletion.

**Green:** `lint`, `typecheck`, **130 unit**, **244 integration**, `build`.
The integration tier runs against real PostgreSQL with Prisma never mocked, and
covers every business rule, authorization boundary and concurrency case.

**Not green:** the end-to-end suite passes per-spec but is not reliably green in
a single full run. Sprint 8 fixed a CSP bug that had been blocking _all_
client-side JavaScript in production builds; the app had therefore been
behaving as if server-rendered only, and the Playwright specs were written
against that. Their assertions now need rewriting around the hydrated
behaviour. Details, and the four other bugs that sprint surfaced, are in
[docs/07 §Sprint 8](./docs/07-mvp-sprint-plan.md).

To try it by hand, see [TESTING.md](./TESTING.md). To run or deploy it, see
[docs/11 — Operations](./docs/11-operations.md).
