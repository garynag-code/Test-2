# SA Accounting — Cashbook (Phase 1)

An auditable, double-entry accounting engine for South African SMMEs. This
first phase delivers the **cashbook**: import a bank statement (CSV or PDF),
auto-allocate each line to a general-ledger account with South African VAT
(15%), and produce a **trial balance**, **profit & loss**, and an
**IFRS-for-SMEs financial-statement set**.

It is built back-end first and deliberately layered so the later modules you
described — accounts receivable / sales invoices, creditors, stock — post to
the **same general ledger** and inherit the same audit guarantees.

## Why it is auditable

- **True double entry.** Every event is a balanced `JournalEntry`; the ledger
  rejects anything where debits ≠ credits or that touches a missing account.
- **Immutable history.** Posted entries are never edited — corrections are
  *reversals* (`ledger.reverse`), so the trail is complete.
- **Everything ties back to the ledger.** All three reports are derived purely
  from posted journal lines, so the trial balance, P&L and balance sheet are
  always internally consistent (assets = equity + liabilities).
- **Exact money.** Amounts are `Decimal`, stored as integer cents; rounding is
  defined in exactly one place (`accounting.money.Money`).
- **Append-only audit log** of every import, posting and reversal.

## Quick start (CLI)

```bash
# Create a set of books (industry chart + VAT registration)
python -m accounting --db acme.db init --name "Acme Trading" \
    --industry retail --vat-registered

# Tell it which GL account your bank feeds
python -m accounting --db acme.db add-bank --name "FNB Cheque" --gl 1000

# Import a statement — each line gets a suggested allocation
python -m accounting --db acme.db import --bank 1 --file statement.csv
python -m accounting --db acme.db review          # see what's pending

# Confirm the unknowns; auto-post the confident, already-learned ones
python -m accounting --db acme.db allocate --line 7 --account 4000 --tax STD
python -m accounting --db acme.db auto-post --min-confidence 0.9

# Reports
python -m accounting --db acme.db trial-balance
python -m accounting --db acme.db pnl
python -m accounting --db acme.db balance-sheet
python -m accounting --db acme.db statements      # the full IFRS set
```

CSV import needs no third-party packages. PDF import is optional:
`pip install pdfplumber` (or `pip install -e ".[pdf]"`).

## Auto-allocation ("external intelligence")

`accounting.allocation` suggests the ledger account + VAT code for each bank
narrative, most-trusted source first:

1. **Learned rules** — once you confirm "ENGEN → Fuel & Oil", every later
   ENGEN line auto-matches (`learn()` records the vendor key).
2. **Seed rules** — a starter set of well-known SA vendors (fuel stations,
   telcos, municipalities, insurers, bank charges, payroll…).
3. **Enricher (pluggable)** — an optional `Enricher` interface is the seam
   where a live LLM / web vendor-lookup can be added later **without** the
   deterministic, auditable core depending on a network call.
4. **Suspense** — anything still unknown lands in the suspense account at zero
   confidence, visibly awaiting a human.

This keeps every posting explainable: each carries the rule/rationale that
produced it.

## South African VAT

Standard rate 15%, read from the `tax_code` table (not hard-coded). Bank
amounts are VAT-inclusive and split net + VAT:

```
money out (R575 @ 15%):  DR expense 500, DR VAT control 75, CR bank 575
money in  (R11 500 @ 15%): DR bank 11 500, CR revenue 10 000, CR VAT control 1 500
```

Input and output VAT meet in a single **VAT control account**, whose balance is
the amount payable to (or refundable from) SARS. If the entity is not VAT
registered, no split is made.

## Chart of accounts

A conventional base chart (1000s assets, 2000s liabilities, 3000s equity,
4000s income, 5000s cost of sales, 6000s+ expenses) plus industry templates
for **hospitality**, **retail** and **construction** (`accounts.py`). Nothing
in the engine hard-codes an account code except the VAT control account.

## Module map

| Module | Responsibility |
|--------|----------------|
| `money` | Exact money type (Decimal / integer cents) |
| `db` | SQLite schema + connection (FKs on, versioned) |
| `models` | Domain dataclasses (`Account`, `JournalEntry`, `BankTransaction`) |
| `accounts` | Chart of accounts, VAT codes, industry templates |
| `ledger` | Double-entry engine: post, reverse, balances, audit |
| `vat` | SA VAT split logic |
| `allocation` | Rules engine + learned memory (+ enricher seam) |
| `importers/` | CSV (stdlib) and PDF (optional) statement parsers |
| `cashbook` | Import → allocate → VAT → post |
| `reports/` | Trial balance, P&L, balance sheet, IFRS statement set |
| `cli` | Command-line front end |

## Extending to AR / creditors / stock

The ledger, chart, VAT and reports are already shared infrastructure. A later
module (e.g. accounts receivable) only needs to build balanced `JournalEntry`
objects — a sales invoice becomes `DR Accounts Receivable / CR Revenue / CR
VAT control`, a receipt clears the debtor — and it immediately shows up in the
same trial balance and financial statements. Sub-ledgers (debtors, creditors,
stock) would add their own tables but reconcile to their control account in the
GL (1200 Accounts Receivable, 2200 Accounts Payable, 1300 Inventory), which is
why those control accounts already exist in the base chart.
