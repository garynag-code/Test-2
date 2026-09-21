# Mission Hero — Security & Child-Safety Model

## 1. Threat model

The realistic adversaries, in order of likelihood:

1. **A motivated 11-year-old with the browser dev tools open.** Wants more XP, a free
   wheel spin, or to approve their own reading task. This is the *primary* threat and
   the one the architecture is shaped around.
2. **A sibling.** Wants to act as the other child — spend their points, submit on their
   behalf, or read their reflections.
3. **An unauthenticated internet user** enumerating UUIDs to read another family's data.
4. **A logged-in parent of family A** trying (accidentally or otherwise) to touch family B.
5. **Automated abuse** — credential stuffing on the parent login, PIN brute force.

## 2. The actor model

Every request resolves to exactly one of:

```ts
type Actor =
  | { type: 'parent'; userId: string; familyId: string; role: FamilyRole; freshAt: Date }
  | { type: 'child';  childId: string; familyId: string }
  | { type: 'system' }          // seeds, jobs — never reachable from HTTP
```

`familyId` comes **only** from the signed session cookie. It is never read from a form
field, query string, route param or JSON body. Any schema that accidentally accepts a
`familyId` is a bug; Zod schemas for mutations are written with explicit allow-lists so
an extra key is stripped rather than honoured (mass-assignment defence).

Guards, all in `src/server/auth/guards.ts`:

| Guard | Fails when |
| --- | --- |
| `requireParent()` | no parent session, or no active `FamilyMember` row |
| `requireFreshParent()` | parent session older than `parentGateTimeoutMinutes` |
| `requireChild()` | no child session, or child is archived |
| `requireOwner()` | parent's role is not `OWNER` (family deletion, transferring ownership) |
| `assertChildInFamily(childId, actor)` | `child.familyId !== actor.familyId` |
| `assertSelfChild(childId, actor)` | child actor is acting for a different child |

## 3. Defence against IDOR (the #3/#4 threats)

Rule: **a repository never looks up a row by id alone.** Every read is filtered by the
tenant key from the session in the same query:

```ts
// WRONG — leaks across families if the id is guessed
prisma.taskCompletion.findUnique({ where: { id } })

// RIGHT — a wrong family yields null, which the caller turns into a 404
prisma.taskCompletion.findFirst({
  where: { id, child: { familyId: actor.familyId } },
})
```

A missing row and a forbidden row both return **404**, never 403. Telling an attacker
"that exists but isn't yours" is itself a leak of the id space.

This is enforced by convention *and* by a lint rule: `findUnique` on any
family-scoped model is banned outside `src/server/db`; the repositories expose
`findForFamily`-style helpers instead.

## 4. Defence against privilege escalation (the #1 threat)

- There is no route, action or flag that turns a `ChildActor` into a `ParentActor`.
  The child JWT has a different `typ` claim and a different cookie name; the parent
  verifier rejects it outright.
- `/parent/**` is additionally gated in `middleware.ts`, so a child cannot even load the
  parent shell to inspect its client bundle for endpoints.
- Approval services take the actor as their first argument and hard-fail on
  `actor.type !== 'parent'`. The test suite asserts this directly
  (`child cannot approve their own task`).
- Point values live on the `Task` row. The approval action's Zod schema accepts only
  `{ completionId, encouragementMessage? }` — there is literally no field through which
  a client could suggest an amount. Manual bonus awards are a *separate*, parent-only
  action that requires a `reason` and writes an `AuditLog` entry.

## 5. Child session hardening

- PIN is 4–6 digits, bcrypt-hashed (cost 12), never logged, never returned.
- 5 consecutive failures ⇒ `pinLockedUntil = now + 15 min`, tracked on the row so the
  lockout survives a cookie wipe. A parent can clear it.
- The comparison is constant-time via bcrypt; the "unknown profile" and "wrong PIN"
  paths take the same amount of work.
- The device-binding cookie (`mh_device`) carries only `familyId` and grants **no**
  authority: with it alone you can see a list of nicknames and avatars — which is why
  child profiles store nicknames, not legal names (§40).
- Child JWT TTL is short (12h) and does not silently renew across days.

## 6. CSRF

Next.js Server Actions are POST-only with an origin check, which covers the common case.
On top of that:

- Session cookies are `SameSite=Lax`, `httpOnly`, `Secure` in production, `__Host-`
  prefixed where the deployment allows it.
- Any `/api/*` route handler that mutates requires a `X-Mission-Hero-CSRF` header
  matched against a per-session token — belt and braces for the future native client.
- `GET` never mutates. There is no "click this link to approve" pattern anywhere.

## 7. XSS

- React escapes by default and the codebase contains **no** `dangerouslySetInnerHTML`.
  This is enforced by an ESLint rule (`react/no-danger: error`).
- All child-authored text (stories, notes, goals, gratitude, memory recitations) is
  stored raw and rendered as text. Length-capped by Zod (stories ≤ 2000 chars).
- A strict `Content-Security-Policy` is set in `middleware.ts` with a per-request nonce;
  `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`.
- Uploaded media is served from an authenticated route with
  `Content-Disposition: attachment` semantics and a fixed, validated MIME allow-list —
  never rendered inline from a user-controlled type.

## 8. Race conditions & double-submit

Covered structurally rather than by hoping:

| Race | Defence |
| --- | --- |
| Two parents approve the same completion simultaneously | `SELECT … FOR UPDATE` on the completion + status guard inside the tx |
| Double-tap on **Approve** | idempotency key unique index; second call returns the first result |
| Two children redeem the last reward | `FOR UPDATE` on the `Reward` row before decrementing inventory |
| Spin spam to farm rewards | eligibility + cooldown + spins-per-period re-checked inside the tx; points debited in the same tx |
| Reopening the app to farm check-in XP | unique `(childId, localDate)` |
| Concurrent streak updates | streak row locked in the same tx as the award |

## 9. Rate limiting

A small token-bucket keyed by `(ip, route)` and `(actorId, route)`:

| Route | Limit |
| --- | --- |
| Parent login | 10 / 15 min / IP, 5 / 15 min / email |
| Child PIN verify | 5 / 15 min / childId (then row-level lockout) |
| Family code redeem | 10 / hour / IP |
| Wheel spin | 30 / hour / child (well above legitimate use; catches scripts) |
| Any mutation | 120 / min / actor |

## 10. Secrets & configuration

All secrets come from environment variables, validated at boot by a Zod schema
(`src/lib/env.ts`) so the app refuses to start misconfigured rather than failing at
2 a.m. `AUTH_SECRET` must be ≥ 32 bytes. `.env.example` is committed; `.env` is not.
No secret is ever imported into a file under `src/components` or `app/**` client code —
enforced by keeping them behind `server-only`.

## 11. Child privacy (§40) as hard constraints

| Rule | How it is enforced |
| --- | --- |
| No child email | `ChildProfile` has no email column |
| No child phone | no column |
| No full legal name | `nickname` only; the UI labels it "What should we call you?" |
| No full DOB | `birthMonth` + `birthYear` only, both optional |
| No public anything | there are no public routes that render child data; no share links, no leaderboards across families |
| No chat / DM | not modelled; parent encouragement is a field on an approval, not a message thread |
| No location | not collected |
| Media is opt-in | `FamilySetting.mediaUploadsEnabled` defaults to **false**; evidence types degrade to `NOTE`/`PARENT_CONFIRM` |
| Data export & deletion | family owner can export (JSON) and delete; deletion hard-deletes child rows and media, retaining only an anonymised audit stub |

Analytics: no third-party analytics or ad SDKs on any child-facing route. Product
telemetry, if added, is aggregate and server-side only.

## 12. Anti-manipulation (§42) as design constraints

The brief's ethical rules are treated as security rules because they protect the user
just as much:

- **No loot boxes, no paid randomness.** The wheel costs *earned* points, is configured
  by the parent, and its odds are visible to the parent. There is no purchase path.
- **No casino styling.** No coins raining, no slot-machine sounds, no "near miss"
  animation. The wheel decelerates smoothly to a server-decided result; near-miss
  framing is explicitly not implemented.
- **No artificial scarcity timers** designed to create anxiety. Cooldowns exist to stop
  farming, and are shown as a plain "Next spin available tomorrow", not a countdown
  pressure device.
- **No punitive streaks.** A broken streak renders "New streak starts today." The word
  "lost" does not appear in the copy. There is a lint-level copy check in the test suite
  asserting banned phrases are absent from the child-facing string tables.
- **No cross-family comparison.** Ranking children against each other is not modelled.

## 13. Auditability

Every state change a parent could later question is recorded in `AuditLog` with actor,
before/after JSON and a reason where one is required. Manual point adjustments *require*
a reason at the schema level. The audit log is append-only: there is no update or delete
path in the repository, and the service exposes only `record()` and `listForFamily()`.

## 14. Security checklist applied to every new mutation

1. Does it call a guard as its first statement?
2. Is the input parsed by an explicit Zod schema with no `familyId`/`childId` the caller
   could forge?
3. Does every query filter on `actor.familyId`?
4. If it moves value — is it inside `$transaction`, with a row lock and an idempotency key?
5. Does it write an `AuditLog` row?
6. Is there a test asserting the *unauthorised* case returns 404/throws?
