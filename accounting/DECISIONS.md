# Decisions

Only decisions not already settled by the specification are recorded here.
Material architectural deviations get an ADR in `docs/adr/`.

## D-001 Platform lives in `accounting/` rather than the repository root
The repository already hosts unrelated projects with their own `/src` and `/tests`. The specification's
structure (section 28.1) is reproduced inside `accounting/` to avoid colliding with them.

## D-002 Optimistic concurrency uses an explicit integer `Version` column
The specification requires a concurrency token on editable master and configuration data (section 8.1)
but does not name a mechanism. PostgreSQL's `xmin` would have required a system column exempt from the
project's snake_case mapping, so an explicit `version` integer is incremented in `SaveChangesAsync`.
Posted accounting records need no token: they are immutable.

## D-003 Accounting invariants are enforced by database triggers as well as by services
INV-001 and INV-004 are enforced in `PostingService` and again by PostgreSQL triggers, so no
application defect or ad-hoc SQL statement can leave an unbalanced or edited posted journal.
The cost is that the triggers must be kept in step with the journal schema; the trigger migration
names every column it depends on.

## D-004 A reversal sets `status = Reversed` on the original journal
This is the only mutation permitted on a posted journal, and the update trigger allows exactly that
transition and no other field change. The alternative — deriving reversal status from the existence of
a reversing journal — would make ledger queries more expensive for no accounting benefit. The original
journal's amounts, dates and posting metadata remain untouched, so INV-004 holds.

## D-005 Reversed journals stay in ledger reporting
The trial balance includes journals with status `Posted` **and** `Reversed`, because the reversing
journal carries the offsetting entry. Removing the original would restate history rather than correct it.

## D-006 A month-end year-end follows the month, including leap years
An entity configured with a 28 February year-end gets 29 February in a leap year. Reading the day
literally would leave 29 February outside every accounting period, so no journal could be dated on it
(INV-003). A configured day that is the last day of that month in a common year is treated as month-end.

## D-007 Drafts are stored in `journals` with status `Draft`
Rather than a separate table. Every ledger query filters on posted statuses, and posting a draft
transitions the same record instead of copying it, so the draft's identifier remains valid afterwards.
Drafts carry a `DRAFT-` placeholder number; a journal number is issued only on posting.

## D-008 VAT codes are seeded in M1 but no VAT is calculated yet
The starter chart (Appendix A) assigns default VAT codes per account, so the codes and their
effective-dated rates must exist. VAT calculation, tax lines and VAT reporting are M2 work.

## D-009 Journal numbering uses a per-entity, per-type counter
`GEN-000001`, `REV-000001` and so on, allocated from `journal_number_sequences` inside the posting
transaction. A database sequence would leak numbers on rollback, which reads as missing journals to
a reviewer.

## D-010 Bearer tokens for API clients, cookies for the local browser UI
ASP.NET Core Identity's `MapIdentityApi` provides both. No custom cryptography or token handling
is introduced (specification section 6.2).

## D-011 VAT is recalculated by the posting service, never trusted from the caller
A line carrying a VAT code states its own VAT amount, and the posting service recomputes it from the
code and the tax point and rejects the journal if the two disagree. A subledger, an import or a
future integration therefore cannot post a VAT amount the rate does not support.

## D-012 The no-VAT override reason belongs to allocation, not to the ledger
Specification section 12.3 requires a reason when a transaction is posted without VAT although the
account defaults to a taxable code. Enforcing that on every journal line would break ordinary manual
journals — accruals, depreciation and reclassifications legitimately post to expense accounts with no
VAT — so the rule is enforced at the allocation step, where a transaction's VAT treatment is actually
being decided. `PostLineRequest.NoVatReason` carries the reason through to the tax line.

## D-013 A reversal is pinned to the original journal's tax point
`PostRequest.TaxPointDate` lets a reversal resolve the VAT rate at the original transaction date. Had
the reversal used its own date, a rate change between the two would produce a VAT amount that does not
undo the original, and the VAT control account would not clear.

## D-014 VAT is rounded to the cent, away from zero, and the taxable base takes the remainder
VAT is rounded to two decimals (matching how a vendor invoice states it) and the taxable base is the
gross less that VAT, so the two always add back to the amount actually banked. Banker's rounding would
disagree with supplier invoices on half-cents.

## D-015 The VAT control account carries no VAT code
VAT codes belong on the income or expense line that bears the taxable amount; the control account
holds the VAT itself. The posting service rejects a VAT code on an account whose control type is Vat,
which would otherwise double-count the tax line in the return summary.

## D-016 Duplicate detection counts occurrences rather than matching on distinctness
A real statement contains identical transactions on one day — two purchases of the same amount at the
same merchant. Treating a repeated (date, amount, description) as a duplicate would silently discard
the second and understate the bank. Instead, each incoming line takes an ordinal among identical lines
in its file, and only as many as are already held for that bank account count as duplicates. A file
with three identical charges where two are held imports exactly one. The running balance is included
in the key where the format supplies it, since it distinguishes otherwise identical transactions.

## D-017 Imported bank lines are not accounting records
An import writes `bank_transactions` only. Nothing reaches the ledger until a line is allocated and
posted through `IPostingService`, which keeps the rule that only the posting service creates posted
journal lines (specification section 5.4) and lets a bookkeeper import freely without accounting
consequence. INV-007 is enforced by the existing unique index on
`(entity_id, source_module, source_record_id)` plus a unique index on `bank_transactions.journal_id`.

## D-018 A broken running-balance chain is a warning for CSV and will block auto-posting for PDF
Specification BNK-AC-003 requires that a PDF failing statement-balance validation cannot auto-post.
For CSV the same check runs but reports a warning, because a partial or filtered export legitimately
starts mid-chain. The PDF parser will treat it as blocking when it is built.

## D-019 A stated VAT amount is validated against the gross, not recalculated from the rounded net
A bank charge of R655.00 inclusive is R569.57 plus R85.43 VAT. Recalculating 15% of the rounded
R569.57 gives R85.44, so validating that way would reject a correct allocation over a rounding
artefact, and real bank charges would be unpostable. Where a line states its VAT, the posting service
adds the two back into a gross and checks that the gross splits at the code's rate into exactly that
net and that VAT. This accepts both VAT-exclusive and VAT-inclusive derivations while still rejecting
an amount the rate does not support.

## D-020 Allocation splits are gross; the bank line's sign decides the direction
Each split states a positive amount as it appears on the statement, VAT included, and the splits must
add up to the statement amount exactly. Whether the journal debits or credits the expense follows from
the bank line's own sign, which removes a class of error where a payment is allocated as a receipt.

## D-021 Rule confidence falls on override and rises on use
A rule the user overrides loses 20 points; one they accept gains 1, capped at 100. Below 40 the rule is
remembered but no longer suggested, so a rule that keeps guessing wrong stops interrupting, without the
user having to find and disable it (AUT-AC-002). A rule is never deleted automatically: the history of
what was suggested stays intact.
