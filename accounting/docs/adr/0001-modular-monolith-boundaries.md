# ADR 0001 — Modular monolith boundaries for the accounting core

Status: Accepted · Date: 2026-09-12 · Milestones: M0, M1

## Context
The specification (section 5.1) requires a modular monolith deployed as one locally hosted
application, with clear module boundaries and a future path to separate services. It also requires
(section 5.4) that only the general ledger may create posted journal lines, and that future
subledgers post through a controlled service rather than writing ledger rows.

## Decision
Four projects, one direction of dependency:

    Accounting.Domain          entities, enumerations, invariant predicates — no infrastructure
    Accounting.Application     use cases and service interfaces; may use EF Core abstractions
    Accounting.Infrastructure  DbContext, migrations, Identity, audit writer, composition root
    Accounting.Api             HTTP surface only; no accounting logic
    Accounting.Web             React/TypeScript UI

Modules are namespaces inside `Accounting.Application` (`GeneralLedger`, `EntitySetup`, and later
`Vat`, `Banking`, `FinancialReporting`, `WorkingPapers`, `Tax`), not separate assemblies. The
boundary that matters for accounting integrity is the posting service, not the project file.

`IPostingService` is the sole writer of posted journal lines. A module that needs to affect the
ledger constructs a `PostRequest`. `PostRequest` carries `SourceModule` and `SourceRecordId`, which
a unique index makes idempotent per source record — this is how banking (M2) and future subledgers
avoid double-posting (INV-007).

## Consequences
- A subledger cannot bypass validation, period locks, authorisation or the audit trail.
- Splitting a module into its own service later means moving a namespace and putting a transport in
  front of the same service interface; the domain rules do not move.
- The application layer depends on EF Core. The domain layer does not, which is where the
  specification's constraint (section 28.2) actually bites.
- Accounting invariants are additionally enforced by database triggers, so the boundary holds even
  for direct SQL access. See DECISIONS.md D-003.

## Alternatives considered
- **Separate assembly per module.** Rejected for M0/M1: it adds build complexity without adding any
  guarantee that the posting-service rule already provides.
- **Repository interfaces over EF Core in the application layer.** Rejected: it would duplicate
  `DbSet` semantics for no testing benefit, since the accounting invariants must be tested against
  real PostgreSQL anyway.
