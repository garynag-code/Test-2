# Build state

**Milestone:** M1 — General Ledger. Complete.

## Completed
- **M0 Foundation** — solution scaffold, PostgreSQL schema and migrations, ASP.NET Core Identity
  with the six specification roles, entity-scoped access grants, entity / fiscal year / period
  provisioning, append-only audit trail, database initialiser that migrates and seeds roles and the
  bootstrap administrator.
- **M1 General Ledger** — chart of accounts (Appendix A starter chart), VAT code and effective-dated
  rate seed data, draft journals, `PostingService` (post, validate, reverse), period lock enforcement
  with an authorised reopen workflow, trial balance and account-activity enquiry, REST API for the
  full slice, minimal React UI (sign in → journal entry → post → trial balance → reverse).

## Tests
`dotnet test` — 66 passing (19 domain, 6 application, 41 integration against real PostgreSQL).
Covers INV-001 to INV-005, INV-007 groundwork, GL-AC-001 to GL-AC-003, SEC-AC-001, VAT-AC-002
seed distinction, period locking, reversal, trial balance derivation and audit events.

## Blockers
None.

## Next action
Begin **M2 — Banking/VAT**, in the specification's build order (section 29.1 step 5 onwards):
1. VAT calculation service (`IVatCalculationService`) with inclusive/exclusive entry, transaction-date
   rate resolution and a `tax_lines` table; prove VAT-AC-001 (R1,150 inclusive at 15% → R1,000 + R150).
2. Bank accounts and the FNB CSV vertical path: parse → duplicate detection → allocation → post
   through `IPostingService` → reconcile.
3. Generalise `IBankStatementParser` to Nedbank, Absa and Standard Bank; PDF parsing after CSV is stable.

Do not start M3 financial-statement mapping until the M2 exit criteria in specification section 29 pass.
