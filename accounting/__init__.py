"""SA Accounting — an auditable double-entry accounting engine.

Phase 1 focuses on the **cashbook**: importing bank statements (CSV/PDF),
auto-allocating each line to a general-ledger account (rules + learned
memory), applying South African VAT (15%), and producing a trial balance,
profit & loss, and an IFRS-for-SMEs financial-statement set.

The package is deliberately layered so later phases (accounts receivable,
sales invoices, creditors, stock) post to the *same* general ledger:

    money        -- exact money type (Decimal, stored as integer cents)
    db           -- SQLite connection + schema/migrations
    models       -- domain dataclasses
    accounts     -- chart of accounts + industry templates
    ledger       -- the double-entry general-ledger engine (the heart)
    vat          -- South African VAT logic (15% standard rate)
    allocation   -- rules engine + learned memory (pluggable AI later)
    importers    -- bank-statement parsers (CSV now, PDF optional)
    cashbook     -- ties import -> allocation -> ledger posting
    reports      -- trial balance, P&L, balance sheet, IFRS statements
"""

__version__ = "0.1.0"

from .money import Money  # noqa: E402

__all__ = ["Money", "__version__"]
