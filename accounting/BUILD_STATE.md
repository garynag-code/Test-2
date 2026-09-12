# Build state

**Milestone:** M2 — Banking/VAT. VAT engine and FNB CSV import complete; allocation next.

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

## Tests
`dotnet test` — 116 passing (19 domain, 13 application, 17 parser, 67 integration against real
PostgreSQL).
Covers INV-001 to INV-006, GL-AC-001 to GL-AC-003, SEC-AC-001, VAT-AC-001 and VAT-AC-002,
BNK-AC-001 and BNK-AC-002, period locking, reversal, rate-change handling, trial balance derivation,
VAT control reconciliation, statement parsing and audit events.

## Blockers
None.

## Next action
Continue **M2 — Banking**, specification sections 15 and 16:
1. Allocation: allocate a `BankTransaction` to accounts with VAT, split allocations, and post through
   `IPostingService` using `SourceModule = "Banking"` and the transaction id as `SourceRecordId`, so
   INV-007 is enforced by the existing unique index. The no-VAT override reason of section 12.3 is
   enforced here, not in the ledger — see DECISIONS.md D-012.
2. Allocation rules: exact/contains/wildcard conditions with VAT defaults, and the matched rule shown
   on the suggestion (AUT-AC-001); manual override retained and able to reduce confidence (AUT-AC-002).
3. Bank reconciliation, finalisable only at zero unexplained difference (REC-AC-001).
4. Nedbank, Absa and Standard Bank CSV parsers; PDF parsing once the CSV path is stable.

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
