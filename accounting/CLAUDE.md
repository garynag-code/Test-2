# Local Accounting Platform — project rules

Authoritative requirements live in `Local_Accounting_ERP_Full_Build_Specification_v1.0.pdf`
(supplied to the session, not committed). This file holds only the permanent rules.

## Architecture
- Modular monolith, API-first, local-first. .NET 10 / ASP.NET Core, PostgreSQL 16+, EF Core,
  React + TypeScript + Vite, xUnit.
- Layering: `Accounting.Domain` → `Accounting.Application` → `Accounting.Infrastructure` → `Accounting.Api`.
  Domain must not reference EF Core, ASP.NET or the file system.
- No controller or endpoint contains accounting calculation logic.
- Reporting is read-only. It derives from posted journal lines; it never keeps separate balances.

## Non-negotiable accounting invariants (specification section 9.1)
- INV-001 A posted journal balances exactly. Enforced in `PostingService` **and** by the
  `trg_journals_balanced` database trigger.
- INV-002 No posting to a non-posting (header) account.
- INV-003 The transaction date must fall in a period that accepts the posting. Hard-locked periods
  reject every posting; soft-locked periods accept elevated users only.
- INV-004 Posted journals and lines are never edited or deleted. Correction is by reversal.
  Enforced by `trg_journals_guard_update` / `_delete` and `trg_journal_lines_guard`.
- INV-005 A reversal references the original journal and preserves its evidence links.
- INV-007 (groundwork) A source record posts at most once: unique index on
  `(entity_id, source_module, source_record_id)` plus a service-level duplicate check.

## Rules that survive every milestone
- `IPostingService` is the only path that creates posted journal lines. Future subledgers
  (banking, AR, AP, payroll) build a `PostRequest`; they never insert ledger rows.
- Money is `decimal` in code and `numeric(19,4)` in the database. Rates and quantities are
  `numeric(19,8)`. Binary floating point is never used for money.
- Amounts with more than four decimal places are rejected, not silently rounded.
- Tax rates, thresholds and reporting rules are effective-dated configuration
  (`VatRateHistory`, `source_rule_set_version`), never constants in business logic.
- Entity-level authorisation is enforced in the application services, not only in the API.
  A `UserContext` is always scoped to one entity.
- The audit trail is append-only; every material state change writes an `AuditEvent`.
- All accounting writes run inside an explicit database transaction.
- Every public service method takes a `CancellationToken`.
- Migrations are committed, and each includes a recovery note where it does more than create tables.
- No secrets in source control. Connection strings and the bootstrap administrator come from
  environment variables or user secrets.
- Do not weaken or delete a valid test to make an implementation pass.

## Conventions
- PostgreSQL `snake_case`; C# `PascalCase`. UUID primary keys. Every entity-owned table carries `entity_id`.
- Enumerations are stored as their names, so database triggers and ad-hoc SQL stay readable.
- Use accountants' vocabulary: Journal, JournalLine, Account, AccountingPeriod, TrialBalance,
  TaxCode, BankTransaction, Reconciliation, WorkingPaper, FinancialStatementMapping.

## Local development
See `README.md` in this folder.
