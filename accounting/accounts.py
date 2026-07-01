"""Chart of accounts, VAT control accounts, and industry templates.

The base chart follows a conventional numbering scheme and is deliberately
close to what a small South African business would recognise:

    1000-1999  Assets            4000-4999  Income
    2000-2999  Liabilities       5000-5999  Cost of sales
    3000-3999  Equity            6000-8999  Operating expenses

Industry templates (hospitality, retail, construction) *add* sector-specific
accounts on top of the base chart. The general engine never hard-codes an
account code; everything is looked up from the chart, so the templates are the
only place sector opinion lives.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Iterable, List, Tuple

from .models import Account, AccountType

# ---------------------------------------------------------------------------
# VAT control account — a single control account carries input and output VAT.
# ---------------------------------------------------------------------------
VAT_CONTROL_CODE = "2100"

# (code, name, type, subtype, is_bank, vat_applicable)
_A = AccountType

BASE_ACCOUNTS: List[Tuple] = [
    # -- Assets ------------------------------------------------------------
    ("1000", "Bank — Current Account", _A.ASSET, "CURRENT_ASSET", True, False),
    ("1100", "Petty Cash", _A.ASSET, "CURRENT_ASSET", True, False),
    ("1200", "Accounts Receivable (Trade Debtors)", _A.ASSET, "CURRENT_ASSET", False, False),
    ("1300", "Inventory / Stock on Hand", _A.ASSET, "CURRENT_ASSET", False, False),
    ("1500", "Property, Plant & Equipment", _A.ASSET, "NON_CURRENT_ASSET", False, True),
    ("1550", "Accumulated Depreciation", _A.ASSET, "NON_CURRENT_ASSET", False, False),
    # -- Liabilities -------------------------------------------------------
    (VAT_CONTROL_CODE, "VAT Control Account", _A.LIABILITY, "CURRENT_LIABILITY", False, False),
    ("2200", "Accounts Payable (Trade Creditors)", _A.LIABILITY, "CURRENT_LIABILITY", False, False),
    ("2300", "PAYE / Payroll Liabilities", _A.LIABILITY, "CURRENT_LIABILITY", False, False),
    ("2500", "Loans", _A.LIABILITY, "NON_CURRENT_LIABILITY", False, False),
    # -- Equity ------------------------------------------------------------
    ("3000", "Owner's Capital / Share Capital", _A.EQUITY, "EQUITY", False, False),
    ("3100", "Retained Earnings", _A.EQUITY, "EQUITY", False, False),
    ("3200", "Drawings", _A.EQUITY, "EQUITY", False, False),
    # -- Income ------------------------------------------------------------
    ("4000", "Sales / Revenue", _A.INCOME, "REVENUE", False, True),
    ("4100", "Other Income", _A.INCOME, "OTHER_INCOME", False, True),
    ("4200", "Interest Received", _A.INCOME, "OTHER_INCOME", False, False),
    # -- Cost of sales -----------------------------------------------------
    ("5000", "Cost of Sales", _A.EXPENSE, "COST_OF_SALES", False, True),
    ("5100", "Purchases", _A.EXPENSE, "COST_OF_SALES", False, True),
    # -- Operating expenses ------------------------------------------------
    ("6000", "Accounting & Audit Fees", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6050", "Bank Charges", _A.EXPENSE, "OPERATING_EXPENSE", False, False),
    ("6100", "Salaries & Wages", _A.EXPENSE, "OPERATING_EXPENSE", False, False),
    ("6150", "Fuel & Oil", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6200", "Motor Vehicle Expenses", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6250", "Insurance", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6300", "Rent Paid", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6350", "Repairs & Maintenance", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6400", "Telephone & Internet", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6450", "Electricity & Water", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6500", "Stationery & Printing", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6550", "Marketing & Advertising", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6600", "Travel & Accommodation", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6650", "Consulting & Professional Fees", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ("6700", "Depreciation", _A.EXPENSE, "OPERATING_EXPENSE", False, False),
    ("6750", "Interest Paid", _A.EXPENSE, "OPERATING_EXPENSE", False, False),
    ("8000", "Sundry Expenses (Suspense)", _A.EXPENSE, "OPERATING_EXPENSE", False, False),
]

# Sector-specific accounts layered on top of the base chart.
INDUSTRY_ACCOUNTS: Dict[str, List[Tuple]] = {
    "hospitality": [
        ("4010", "Food & Beverage Sales", _A.INCOME, "REVENUE", False, True),
        ("4020", "Accommodation Revenue", _A.INCOME, "REVENUE", False, True),
        ("5010", "Food & Beverage Cost", _A.EXPENSE, "COST_OF_SALES", False, True),
        ("6820", "Laundry & Cleaning", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
        ("6830", "Kitchen & Consumables", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ],
    "retail": [
        ("4010", "Merchandise Sales", _A.INCOME, "REVENUE", False, True),
        ("5010", "Cost of Goods Sold", _A.EXPENSE, "COST_OF_SALES", False, True),
        ("6840", "Shop Rent & Occupancy", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
        ("6850", "Point-of-Sale & Card Fees", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
        ("6860", "Stock Shrinkage", _A.EXPENSE, "OPERATING_EXPENSE", False, False),
    ],
    "construction": [
        ("4010", "Contract Revenue", _A.INCOME, "REVENUE", False, True),
        ("5010", "Materials", _A.EXPENSE, "COST_OF_SALES", False, True),
        ("5020", "Subcontractors", _A.EXPENSE, "COST_OF_SALES", False, True),
        ("5030", "Plant & Equipment Hire", _A.EXPENSE, "COST_OF_SALES", False, True),
        ("6870", "Site Establishment", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
        ("6880", "Safety & Compliance", _A.EXPENSE, "OPERATING_EXPENSE", False, True),
    ],
}

INDUSTRIES = ["general"] + sorted(INDUSTRY_ACCOUNTS)


def build_chart(industry: str = "general") -> List[Account]:
    """Return the full chart of accounts for *industry* (base + sector)."""
    rows = list(BASE_ACCOUNTS)
    seen = {r[0] for r in rows}
    for code, *rest in INDUSTRY_ACCOUNTS.get(industry, []):
        if code not in seen:
            rows.append((code, *rest))
            seen.add(code)
    accounts = []
    for code, name, atype, subtype, is_bank, vatable in rows:
        accounts.append(
            Account(
                code=code,
                name=name,
                type=atype,
                subtype=subtype,
                is_bank=is_bank,
                vat_applicable=vatable,
            )
        )
    return accounts


def install_chart(conn, industry: str = "general") -> int:
    """Insert the chart for *industry* into the database (idempotent)."""
    now = datetime.now(timezone.utc).isoformat()
    n = 0
    for acc in build_chart(industry):
        cur = conn.execute(
            """INSERT OR IGNORE INTO account
               (code, name, type, subtype, normal_side, is_bank,
                vat_applicable, active, parent_code, created_at)
               VALUES (?,?,?,?,?,?,?,1,?,?)""",
            (
                acc.code, acc.name, acc.type.value, acc.subtype,
                acc.normal_side, int(acc.is_bank), int(acc.vat_applicable),
                acc.parent_code, now,
            ),
        )
        n += cur.rowcount
    conn.commit()
    return n


def install_tax_codes(conn) -> None:
    """Seed the South African VAT codes and wire them to the control account."""
    codes: Iterable[Tuple] = [
        # code, name, rate_bps
        ("STD", "Standard-rated (15%)", 1500),
        ("ZER", "Zero-rated (0%)", 0),
        ("EXE", "Exempt", 0),
        ("NON", "No VAT / Out of scope", 0),
    ]
    for code, name, rate in codes:
        conn.execute(
            """INSERT OR IGNORE INTO tax_code
               (code, name, rate_bps, input_account, output_account)
               VALUES (?,?,?,?,?)""",
            (code, name, rate, VAT_CONTROL_CODE, VAT_CONTROL_CODE),
        )
    conn.commit()
