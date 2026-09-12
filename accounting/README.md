# Local Accounting Platform

Local-first South African SMME accounting platform. Milestones M0 (foundation) and M1 (general
ledger) are implemented: entities, fiscal years and periods, chart of accounts, journals, posting,
reversal, period locking, trial balance and a minimal UI that exercises the whole path.

See `CLAUDE.md` for the permanent engineering rules, `BUILD_STATE.md` for current status and
`DECISIONS.md` for decisions the specification left open.

## Prerequisites
- .NET 10 SDK
- PostgreSQL 16 or later
- Node.js 20 or later

## Database

    createuser accounting --pwprompt
    createdb accounting_dev --owner accounting
    createdb accounting_test --owner accounting

The application never reads a password from a committed file. Supply the connection string through
the environment:

    export ConnectionStrings__AccountingDb="Host=localhost;Port=5432;Database=accounting_dev;Username=accounting;Password=…"

## First administrator

Set these before the first run; the initialiser creates the account and assigns SystemAdmin and
FirmAdmin, then does nothing on later runs.

    export Bootstrap__AdministratorEmail="admin@example.com"
    export Bootstrap__AdministratorPassword="…"          # at least 12 characters

## Run

    dotnet run --project src/Accounting.Api          # migrates on start, serves http://localhost:5080
    npm install --prefix src/Accounting.Web
    npm run dev --prefix src/Accounting.Web          # http://localhost:5173, proxies to the API

Sign in with the bootstrap administrator, create an entity, capture a balanced journal, post it and
read the trial balance. Reversing the journal returns the trial balance to zero while both journals
remain on file.

## Tests

    dotnet test

Domain and application tests run in isolation. Integration tests run against real PostgreSQL,
because several invariants are enforced by database triggers and constraints. They use
`accounting_test`, overridable with `ACCOUNTING_TEST_DB`.

## Migrations

    dotnet ef migrations add <Name> -p src/Accounting.Infrastructure -s src/Accounting.Api -o Persistence/Migrations
    dotnet ef database update   -p src/Accounting.Infrastructure -s src/Accounting.Api

## API

REST under `/api/v1`; sign-in endpoints (`/login`, `/register`) come from ASP.NET Core Identity.
Accounting failures return stable codes (`GL.UNBALANCED`, `GL.PERIOD_NOT_OPEN`,
`GL.NON_POSTING_ACCOUNT`, `GL.JOURNAL_IMMUTABLE`, …) with human-readable messages.

## Scope note

This software assists with bookkeeping and presentation. It does not certify that any set of
financial statements complies with IFRS for SMEs or with South African tax law; that depends on
facts, accounting judgment, disclosure and practitioner review.
