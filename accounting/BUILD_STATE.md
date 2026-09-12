# Build state

**Milestone:** M2 — Banking/VAT. VAT engine complete; banking next.

## Completed
- **M0 Foundation** — solution scaffold, PostgreSQL schema and migrations, ASP.NET Core Identity
  with the six specification roles, entity-scoped access grants, entity / fiscal year / period
  provisioning, append-only audit trail, database initialiser that migrates and seeds roles and the
  bootstrap administrator.
- **M1 General Ledger** — chart of accounts (Appendix A starter chart), VAT code and effective-dated
  rate seed data, draft journals, `PostingService` (post, validate, reverse), period lock enforcement
  with an authorised reopen workflow, trial balance and account-activity enquiry, REST API for the
  full slice, minimal React UI (sign in → journal entry → post → trial balance → reverse).

- **M2 VAT engine** — `tax_lines` table, `IVatCalculationService` (inclusive/exclusive split, rate
  resolved from history by transaction date, recoverable percentage), VAT validated and persisted by
  the posting service, reversals pinned to the original tax point, and `IVatReturnService` giving a
  return-period summary by VAT201 classification with VAT control-account reconciliation.

## Tests
`dotnet test` — 88 passing (19 domain, 13 application, 56 integration against real PostgreSQL).
Covers INV-001 to INV-005, INV-007 groundwork, GL-AC-001 to GL-AC-003, SEC-AC-001,
VAT-AC-001 and VAT-AC-002, period locking, reversal, rate-change handling, trial balance derivation,
VAT control reconciliation and audit events.

## Blockers
None.

## Next action
Continue **M2 — Banking**, specification section 29.1 step 6 onwards:
1. `bank_accounts`, `bank_import_batches`, `bank_transactions`; FNB CSV parser behind
   `IBankStatementParser`; duplicate detection on file hash and transaction level (BNK-AC-001/002).
2. Allocation rules and the cashbook, posting through `IPostingService`. The no-VAT override reason
   of section 12.3 is enforced here, not in the ledger — see DECISIONS.md D-012.
3. Bank reconciliation with zero unexplained difference (REC-AC-001).
4. Nedbank, Absa and Standard Bank parsers; PDF parsing after the CSV path is stable.

Do not start M3 financial-statement mapping until the M2 exit criteria in specification section 29 pass.

## Bank statement format notes (from real FNB samples)
- Transaction dates carry no year; derive it from the statement period and handle a December rollover.
- Credits are marked by a `Cr` suffix on the amount; debits carry no suffix. Balances always carry
  `Cr` or `Dr`.
- Descriptions may contain numbers (an interest rate, a card mask, a beneficiary reference). The
  amount is the numeric token immediately before the balance, not the first number found.
- Fee lines prefixed `#` are VAT-inclusive; the statement header states the VAT total separately.
- A second detail field sits beside the description (masked card and original date, or beneficiary).
  Allocation rules must be able to match on either.
- The turnover summary (credit/debit counts and totals) plus opening and closing balances give an
  arithmetic check the parser must pass before anything may post (BNK-AC-003).
