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
