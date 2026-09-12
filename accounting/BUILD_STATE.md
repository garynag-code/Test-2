# Build state

**Milestone:** M2 — Banking/VAT. Accounting engine complete; cashbook UI and further parsers remain.

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

- **M2 bank import** — `bank_accounts`, `bank_import_batches`, `bank_transactions`;
  `IBankStatementParser` with an FNB CSV implementation read from real export shape;
  `IBankImportService` with preview and commit, file-hash re-import detection and occurrence-counting
  duplicate detection. Imported lines are held unallocated and never reach the ledger until posted.

- **M2 allocation** — `allocation_rules` with exact/contains/starts-with/wildcard matching, sequence
  precedence, money-in/out restriction and confidence that falls on override; `IBankAllocationService`
  turns a bank line into a posted journal through `IPostingService`, splitting VAT out of the gross,
  supporting multi-account splits, and enforcing the section 12.3 no-VAT reason.

- **M2 reconciliation** — `bank_reconciliations` and `bank_reconciliation_lines`. The view is
  recomputed from posted data: ledger balance, unallocated bank lines, and ledger entries explained as
  not yet presented. Finalisation is refused unless the unexplained difference is exactly zero
  (INV-008, REC-AC-001), and the figures are frozen on the record when it is.

## Tests
`dotnet test` — 150 passing (19 domain, 13 application, 17 parser, 101 integration against real
PostgreSQL).
Covers INV-001 to INV-006, GL-AC-001 to GL-AC-003, SEC-AC-001, VAT-AC-001 and VAT-AC-002,
BNK-AC-001, BNK-AC-002, AUT-AC-001, AUT-AC-002 and REC-AC-001, period locking, reversal, rate-change handling, trial balance derivation,
VAT control reconciliation, statement parsing and audit events.

## Blockers
None.

## Next action
Finish **M2 — Banking**:
1. **Cashbook UI** over the whole path: import a statement, review the preview with its duplicate
   flags, accept or override rule suggestions, allocate with VAT, and reconcile. Nothing built since
   the ledger has been exercised by a person rather than by tests — the UI is how that gap closes.
2. Nedbank, Absa and Standard Bank CSV parsers behind the same `IBankStatementParser`.
3. FNB PDF parsing, treating a broken statement-balance chain as blocking (BNK-AC-003).

Do not start M3 financial-statement mapping until the M2 exit criteria in specification section 29 pass.

Do not start M3 financial-statement mapping until the M2 exit criteria in specification section 29 pass.

Do not start M3 financial-statement mapping until the M2 exit criteria in specification section 29 pass.

## Bank statement format notes (from real FNB samples)

### FNB CSV ("Account Transaction History") — implemented
- Six preamble lines (title, blank, `Name:`, `Account:`, `Balance:`, blank) before the
  `Date, Amount, Balance, Description` header. Fields carry leading spaces; rows end with a trailing comma.
- Dates are `dd MM yyyy` **with** the year, unlike the PDF.
- Amounts are signed, money out negative. Balance is the running balance.
- Rows are newest first, and not strictly ordered within a day.
- A file can legitimately contain identical rows (same date, amount and description) — two real
  purchases. Duplicate detection counts occurrences rather than matching on distinctness; collapsing
  them would understate the bank.

### FNB PDF — not yet implemented
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
