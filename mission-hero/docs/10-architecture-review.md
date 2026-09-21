# Mission Hero — Internal Architecture Review

A self-review of the proposal in `01`–`09` against the five lenses the brief names,
carried out *before* implementation. Findings that changed the design are marked
**[changed]**.

## 1. Security

| Question | Finding |
| --- | --- |
| Can a child forge a value award? | No. Amounts live on server-owned rows; mutation schemas have no amount field. **[changed]** — the first draft let the approval action accept an `xpOverride`; removed, replaced with a separate audited "award bonus" action. |
| Can a child reach parent routes? | No. Separate cookie, separate JWT type, middleware gate, guard in every layout and action. |
| Can family A read family B? | Only if a repository looks a row up by id alone. **[changed]** — added the "no bare `findUnique` on family-scoped models" rule and made the repositories expose family-scoped finders. |
| Is the wheel cheatable? | No. Draw and persist happen server-side before the response; the client is told only where to stop. |
| Brute force? | Rate limits + row-level PIN lockout that survives cookie clearing. |
| Residual risk | Media storage. v1 keeps evidence behind an authenticated route with a MIME allow-list; a misconfigured object store in production would be the weakest link. Called out in Sprint 8. |

## 2. Scalability

- Derived balances cost a `SUM` per read. At family scale (tens of rows per child per
  week) this is trivial; at 10k families it is still an index-only scan on
  `(childId)`. The snapshot cache is designed but deliberately **not** built — it would
  be premature, and it introduces exactly the mutable-total failure mode ADR-002 exists
  to avoid.
- Lazy occurrence materialisation bounds writes to "occurrences a family actually
  looked at" rather than "every task × every day forever". **[changed]** — the first
  draft materialised a rolling 90-day window in a nightly job; that is a scheduled job
  we would have to operate, so it became lazy-on-read with a unique constraint.
- The heaviest query is the parent dashboard. It is a handful of grouped aggregates per
  family, all covered by `(familyId, …)` indexes, and it is a Server Component so it
  costs one round trip rather than six.
- Nothing in the design requires a background worker for the MVP, which removes an
  entire class of operational failure from v1.

## 3. Child safety

- Data minimisation is structural: there is no column for a child's email, phone, legal
  name or full date of birth, so no future feature can accidentally start collecting
  them without a migration that a reviewer would see.
- Nothing is public. There is no route that renders child data without a session, no
  share link, no cross-family comparison, no chat.
- Media is off by default.
- **[changed]** — the first draft placed hidden objects using `Math.random()` per render,
  which means a child could refresh until one appears. Now placement is a deterministic
  per-child-per-day hash, so refreshing achieves nothing; this is both an anti-farming
  and an anti-compulsion measure.
- **[changed]** — character traits were originally going to display a percentage
  completion toward the next badge for *every* trait, which reads as a report card for
  the weak ones. Now low totals get growth copy and no percentage.
- The banned-phrase test (BR-60) makes the tone commitment enforceable rather than
  cultural.

## 4. Data integrity

- Three independent ledgers with `CHECK` constraints mean the product's two strongest
  promises — lifetime XP never falls, Character Stars are never spent — are guaranteed by
  PostgreSQL, not by developer discipline.
- Idempotency keys are derived from the causing row's id, so the key is a *fact*, not a
  client-supplied token that could be omitted.
- Every value-moving path is `$transaction` + row lock + status guard. The three
  concurrency tests (double approve, last-item redemption, parallel spin) are the ones
  that would catch a regression here.
- **[changed]** — redemptions originally debited on *fulfilment*, which let a child queue
  unlimited pending redemptions. Now the debit happens at request time with an explicit,
  keyed refund if the parent rejects (BR-43).
- Audit rows are append-only with before/after snapshots, so a disputed balance can be
  reconstructed.

## 5. Maintainability

- Four layers with an explicit import matrix; Prisma confined to repositories; business
  rules numbered (BR-n) and cited from code and tests.
- `src/domain` is dependency-free and holds the rules most likely to need tuning (level
  curve, badge tiers, streak logic), so a product change is a one-file edit with fast
  tests.
- DTOs are hand-written, so widening a Prisma model cannot silently leak a `pinHash`.
- **[changed]** — services originally read cookies directly; they now receive an `Actor`,
  which is what makes the entire §46 authorization test list expressible without
  spinning up HTTP.
- Risk accepted: Server Actions couple the transport to Next.js. Mitigated by keeping
  all logic in services, so an `/api` or native-facing layer is a thin re-wrapping.

## Verdict

The design is sound to build against. The highest residual risks, in order:

1. **Media handling in production** (Sprint 8) — the one place a privacy mistake would be
   serious and externally visible.
2. **Timezone correctness** — "one per calendar day" is only as good as the family's
   timezone handling; mitigated by making the family timezone explicit everywhere and
   unit-testing date boundaries, including DST transitions.
3. **Scope pressure** — the feature list is large enough that the discipline of §55
   ("do not build on top of failing critical tests") is the main safeguard, which is why
   the sprint plan is vertical and the CI gate is non-negotiable.
