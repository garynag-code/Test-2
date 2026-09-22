# Mission Hero — Operations Runbook

## 1. Running it

### Locally

```bash
cp .env.example .env          # set AUTH_SECRET and DATABASE_URL
npm install
npm run db:migrate            # schema + the invariants Prisma cannot express
npm run db:seed               # the Adventure Family demo
npm run dev
```

### With Docker

```bash
export AUTH_SECRET="$(openssl rand -base64 48)"
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"
docker compose up --build
```

The app container applies `prisma migrate deploy` on start, then serves on
`:3000`. The database is not published to the host — only the app reaches it.

## 2. Configuration

| Variable                | Required   | Notes                                                                          |
| ----------------------- | ---------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`          | yes        | PostgreSQL 16+.                                                                |
| `AUTH_SECRET`           | yes        | ≥ 32 chars. Rotating it signs every session out.                               |
| `APP_URL`               | no         | Used for absolute links.                                                       |
| `TEST_DATABASE_URL`     | tests only | Integration tests truncate it between tests — never point it at anything real. |
| `MEDIA_UPLOADS_ENABLED` | no         | Master switch; families still opt in individually.                             |

`src/lib/env.ts` validates all of it at boot, so a misconfigured deployment
fails immediately and loudly rather than at 2 a.m. during an approval.

## 3. Migrations

- Development: `npm run db:migrate` (creates and applies).
- Production: `npx prisma migrate deploy`, which the container runs on start.
- **Never** `prisma db push` against a real database: it does not record a
  migration and can silently drop columns.

Some invariants cannot be expressed in `schema.prisma` and live as raw SQL
appended to a migration — `CHECK (amount > 0)` on XP and Character Stars, the
partial unique index that makes a memory challenge pay out once per child, and
the one-equipped-item-per-slot index. When adding a migration, re-read
[`docs/02-data-model.md` §10](./02-data-model.md) and check none of them is
being dropped: losing one of those turns a guaranteed property into a hopeful
one, silently.

### Rolling back

Prisma does not generate down-migrations. To reverse a release:

1. Deploy the previous image (the app is backward compatible within a minor).
2. If the schema change must go, write a _new_ forward migration that undoes it.

Additive changes (new nullable column, new table) are safe to deploy ahead of
the code that uses them, which is the preferred shape for anything risky.

## 4. Backup and restore

The ledgers are the product. A backup that loses them loses every child's XP,
points and stars, and none of it can be recomputed.

```bash
# Nightly, retained 30 days. --clean --if-exists makes the dump restorable
# over an existing database.
pg_dump --format=custom --clean --if-exists \
  --file "mission-hero-$(date +%F).dump" "$DATABASE_URL"

# Restore
pg_restore --clean --if-exists --dbname "$DATABASE_URL" mission-hero-2026-09-22.dump
```

Verify a restore quarterly into a scratch database — an untested backup is a
hypothesis, not a backup. After restoring, check:

```sql
-- Balances are derived, so they can be recomputed and compared.
SELECT "childId", SUM(amount) FROM "XpTransaction" GROUP BY "childId";
-- The invariants should still be present.
SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace;
```

A family can also export their own data as JSON from **Settings → Your data**,
which is a user-facing right rather than an operational backup.

## 5. Health and monitoring

`GET /api/health` returns `{"status":"ok","database":"ok"}` and does a real
query, so it fails when the database is unreachable rather than when the
process is merely alive. The container health check uses it.

Worth alerting on:

| Signal                           | Why                                                           |
| -------------------------------- | ------------------------------------------------------------- |
| `/api/health` non-200            | The obvious one.                                              |
| 5xx rate                         | Server actions surface as POSTs to page routes.               |
| p95 approval latency             | The approval transaction is the heaviest write path.          |
| PostgreSQL connection saturation | Prisma's pool is per instance; several instances multiply it. |
| Rows in `AuditLog` per day       | A sudden drop means writes are failing silently somewhere.    |

Nothing logs a child's story text, a PIN, or a password hash. Keep it that way:
those three are the only pieces of genuinely sensitive content in the system.

## 6. Scaling

Two things are per-instance and must change before running more than one:

1. **Rate limiting** (`src/server/rate-limit.ts`) is in-process. Two instances
   mean two sets of buckets, so the effective limit doubles. Move it to Redis
   before scaling out — the module is small and has one call site pattern.
2. **Prisma's connection pool** is per instance. `max_connections` on the
   database has to cover `instances × pool_size`.

Everything else is stateless: sessions are signed cookies, and nothing is held
in memory between requests.

## 7. Security operations

- `AUTH_SECRET` rotation invalidates every parent, child and device session at
  once. It is the lever to pull if a secret is suspected leaked.
- The CSP is built per request in `src/middleware.ts` with a nonce, and the
  nonce is placed on the **request** header as well as the response — Next
  reads it from the request. Getting that wrong blocks every script on the page
  while leaving the site apparently working, so `e2e/security.spec.ts` asserts
  it directly.
- A child PIN lockout is stored on the row (`pinLockedUntil`), so clearing
  cookies does not clear it. A parent lifts it from **Settings → Children** by
  setting a PIN.

## 8. Deleting a family

Family deletion is permanent and cascades across every table. It requires the
owner's password and their family's name typed exactly. There is no soft-delete
and no recovery path other than a database restore — which is worth saying to
anyone who asks for it to be undone.
