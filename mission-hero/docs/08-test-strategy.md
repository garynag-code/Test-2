# Mission Hero — Test Strategy

## 1. Shape of the pyramid

| Tier                    | Runner                           | Speed   | What it proves                                                                                                             |
| ----------------------- | -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Domain unit**         | Vitest (node)                    | ms      | Pure rules: level curve, recurrence expansion, streak arithmetic, weighted draw, badge tiers, idempotency keys, copy guard |
| **Service integration** | Vitest + real PostgreSQL         | ~100ms  | Transactions, constraints, idempotency, authorization, race conditions. **This is where the money tests live.**            |
| **Component**           | Vitest + jsdom + Testing Library | ms      | Accessibility affordances, states (loading/empty/error), reduced motion                                                    |
| **E2E**                 | Playwright                       | seconds | The three vertical slices, exactly as §47–49 describe them                                                                 |

The integration tier is deliberately the heaviest. The risky logic in this product is
"did exactly one ledger row get written under concurrency", which a mocked database
cannot tell you. Integration tests therefore run against a **real PostgreSQL** with the
real migrations applied.

## 2. Database harness

- A dedicated `mission_hero_test` database.
- Migrations applied once per run (`prisma migrate deploy`).
- Each test runs inside a transaction that is rolled back, **except** tests that
  deliberately exercise concurrency, which truncate instead.
- Factories (`src/test/factories.ts`) build a realistic family in one call:
  `const { family, parent, child, task } = await seedFamilyFixture()`.
- No mocking of Prisma. Ever. A mock cannot fail a unique constraint.

## 3. The §46 critical test list, mapped

| #   | Test                                                | Tier               | Rule                    |
| --- | --------------------------------------------------- | ------------------ | ----------------------- |
| 1   | Parent creates family                               | integration        | BR-55                   |
| 2   | Parent creates child                                | integration        | —                       |
| 3   | Parent creates daily task                           | integration        | BR-8                    |
| 4   | Task recurs correctly                               | unit + integration | BR-18…24                |
| 5   | Child submits completion                            | integration        | BR-9                    |
| 6   | No points before approval                           | integration        | **BR-10**               |
| 7   | Parent approves                                     | integration        | BR-11                   |
| 8   | XP awarded once                                     | integration        | BR-6                    |
| 9   | Reward points awarded once                          | integration        | BR-6                    |
| 10  | Duplicate approval does not duplicate points        | integration        | **BR-12**               |
| 11  | Rejected task awards nothing                        | integration        | BR-13                   |
| 12  | Child cannot approve their own task                 | integration        | **BR-11**               |
| 13  | Child cannot change point values                    | integration        | BR-1, schema allow-list |
| 14  | Daily check-in rewards once                         | integration        | **BR-25**               |
| 15  | Character submission awards nothing before approval | integration        | BR-28                   |
| 16  | Character approval awards exactly one star          | integration        | **BR-29**               |
| 17  | Memory challenge awards once                        | integration        | BR-49                   |
| 18  | Wheel locked below threshold                        | integration        | BR-44                   |
| 19  | Wheel unlocked above threshold                      | integration        | BR-44                   |
| 20  | Wheel result persisted                              | integration        | **BR-45**               |
| 21  | Reward points correctly deducted                    | integration        | BR-47                   |
| 22  | Unauthorised family access blocked                  | integration        | **BR-56/58**            |
| 23  | Child cannot access another child                   | integration        | **BR-57**               |
| 24  | Parent cannot access another family                 | integration        | **BR-56**               |
| 25  | Secret mission completion works                     | integration        | BR-53                   |
| 26  | Streak increments correctly                         | unit + integration | BR-38                   |
| 27  | Reward redemption works atomically                  | integration        | **BR-41**               |

## 4. Adversarial tests (beyond the brief's list)

These encode the threat model from `03-security-model.md`:

- **Forged family id** — a parent posts another family's `childId`; expect not-found.
- **Forged amounts** — extra keys (`xpValue: 9999`) in an approval payload are stripped
  by Zod and ignored.
- **Child session on a parent route** — expect redirect/401, never a partial render.
- **Concurrent approvals** — two `approve()` calls in parallel on one completion produce
  exactly one XP row (asserted by count, not by absence of error).
- **Concurrent redemptions of the last item** — one succeeds, one fails, inventory ≥ 0.
- **Concurrent spins** — `spinsPerDay = 1` and two parallel spins produce one `RewardSpin`.
- **Negative balance attempt** — redeeming beyond the balance throws and writes nothing.
- **Replay a spin** — re-fetching the spin returns the persisted segment, unchanged.
- **PIN brute force** — the 6th attempt is locked out even with the right PIN.
- **XP monotonicity** — a property test: any sequence of awards and redemptions leaves
  lifetime XP non-decreasing.

## 5. Property-based checks

A small amount of randomised testing where the input space is large:

- Recurrence expansion over random ranges never emits a date outside `[start, end]`,
  never emits duplicates, and is stable across repeated calls.
- The weighted wheel draw over 100k trials lands within tolerance of the configured
  weights (a statistical test with a fixed seed, so it cannot flake).
- Ledger sums equal the balance for any random interleaving of awards and debits.

## 6. Accessibility testing

- `axe-core` assertion on each major route in the component tier.
- Keyboard-only walkthrough of the child daily loop in Playwright (tab order, focus
  visibility, Enter activates DONE).
- `prefers-reduced-motion: reduce` snapshot: confetti and wheel spin must degrade to a
  static reveal, not simply run faster.
- Contrast is checked in CI against the theme tokens rather than by eyeballing.

## 7. Copy guard

`src/domain/copy.ts` holds all child-facing encouragement strings. A unit test asserts
no string matches the banned-phrase regex (BR-60), so an enthusiastic future
contributor cannot ship "You failed!" to a nine-year-old.

## 8. What is deliberately _not_ mocked

Prisma, the database, `crypto.randomInt`, and time (time is injected as a `Clock`
interface so tests pass a fixed clock rather than monkey-patching `Date`).

## 9. CI gate

```
lint → typecheck → unit → integration (with postgres service) → build → e2e
```

Any red step blocks the merge. Flaky-by-design tests (statistical, concurrency) use
fixed seeds and explicit synchronisation so a red result always means a real defect.
