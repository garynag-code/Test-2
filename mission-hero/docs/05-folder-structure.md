# Mission Hero — Folder Structure

```
mission-hero/
├─ docs/                          # this architecture set
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts                     # Adventure Family demo data (§45)
├─ e2e/                           # Playwright critical-path specs
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx            # landing, role chooser
│  │  ├─ (parent)/
│  │  │  ├─ layout.tsx                   # requireParent() shell
│  │  │  ├─ parent/page.tsx              # dashboard
│  │  │  ├─ parent/approvals/            # task + character + memory queues
│  │  │  ├─ parent/children/
│  │  │  ├─ parent/tasks/
│  │  │  ├─ parent/rewards/
│  │  │  ├─ parent/wheel/
│  │  │  ├─ parent/character/
│  │  │  ├─ parent/memory/
│  │  │  ├─ parent/missions/
│  │  │  ├─ parent/progress/
│  │  │  ├─ parent/settings/
│  │  │  └─ parent/audit/
│  │  ├─ (kid)/
│  │  │  ├─ layout.tsx                   # requireChild() shell + theme
│  │  │  ├─ kids/page.tsx                # profile picker / family code
│  │  │  ├─ kids/home/
│  │  │  ├─ kids/missions/
│  │  │  ├─ kids/character/
│  │  │  ├─ kids/check-in/
│  │  │  ├─ kids/memory/
│  │  │  ├─ kids/wheel/
│  │  │  ├─ kids/rewards/
│  │  │  ├─ kids/map/                    # adventure map
│  │  │  └─ kids/me/                     # character profile, badges, collectibles
│  │  ├─ (auth)/parent/login, /parent/register
│  │  └─ api/
│  │     ├─ health/route.ts
│  │     └─ media/[id]/route.ts          # authenticated, family-scoped evidence
│  │
│  ├─ domain/                     # PURE. no imports from outside domain/.
│  │  ├─ levels.ts                # xp → level, progress to next
│  │  ├─ streaks.ts               # streak arithmetic on plain dates
│  │  ├─ recurrence.ts            # schedule → occurrence dates
│  │  ├─ wheel.ts                 # weighted draw (takes an RNG function)
│  │  ├─ badges.ts                # tier thresholds
│  │  ├─ achievements.ts          # rule predicates
│  │  ├─ idempotency.ts           # canonical key builders
│  │  ├─ copy.ts                  # child-facing encouragement strings + banned list
│  │  └─ constants.ts
│  │
│  ├─ features/
│  │  ├─ auth/          { service, repo, schemas, components }
│  │  ├─ families/
│  │  ├─ children/
│  │  ├─ tasks/
│  │  ├─ approvals/
│  │  ├─ ledger/        # the only writer of the three ledgers
│  │  ├─ character/
│  │  ├─ rewards/
│  │  ├─ reward-wheel/
│  │  ├─ check-ins/
│  │  ├─ memory/
│  │  ├─ secret-missions/
│  │  ├─ streaks/
│  │  ├─ achievements/
│  │  ├─ collectibles/
│  │  ├─ notifications/
│  │  └─ audit/
│  │
│  ├─ server/
│  │  ├─ db/prisma.ts             # singleton client
│  │  ├─ auth/                    # session cookies, guards, actor resolution
│  │  ├─ action.ts                # createAction(): guard + zod + audit wrapper
│  │  └─ errors.ts                # AppError taxonomy → HTTP/UI mapping
│  │
│  ├─ components/
│  │  ├─ ui/                      # shadcn-style primitives (button, card, sheet…)
│  │  ├─ kid/                     # MissionCard, XpChip, LevelRing, Confetti…
│  │  └─ parent/                  # ApprovalRow, StatCard, DataTable…
│  │
│  ├─ hooks/  lib/  types/  styles/
│  └─ test/                       # factories, db harness, matchers
├─ vitest.config.ts               # projects: unit (node) · integration (pg) · dom
├─ playwright.config.ts
└─ .env.example
```

## Anatomy of a feature module

```
features/approvals/
├─ schemas.ts     # zod: exactly the fields a client may send
├─ types.ts       # DTOs returned to the UI (never Prisma models)
├─ repo.ts        # prisma access; every fn takes (db, …) so it composes in a tx
├─ service.ts     # business rules, transactions, idempotency, audit
├─ actions.ts     # 'use server'  — guard → parse → service → revalidate
└─ components/    # UI that consumes types.ts
```

Rules:

- `actions.ts` files are the *only* files with `'use server'`.
- `repo.ts` is the *only* place `@prisma/client` is imported (plus `server/db`).
- `service.ts` never touches cookies, headers or `revalidatePath` — it takes an `Actor`
  and returns data, which makes it trivially testable.
- `types.ts` DTOs are hand-written so a Prisma model change cannot silently widen what
  the client receives (e.g. `pinHash` can never leak into a profile-picker payload).
