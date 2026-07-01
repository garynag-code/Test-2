"""CSV bank-statement importer.

SA banks (FNB, ABSA, Standard Bank, Nedbank, Capitec…) all export CSV with
different headers, and some use a single signed ``amount`` column while others
use separate ``debit``/``credit`` columns. This importer sniffs the header and
maps the columns automatically, or accepts an explicit mapping.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List, Optional

from ..models import BankTransaction
from ..money import Money
from .base import ExternalIdFactory, parse_amount, parse_date

# Candidate header names (lowercased) for each logical field.
_ALIASES: Dict[str, List[str]] = {
    "date": ["date", "transaction date", "txn date", "posting date", "value date", "date posted"],
    "description": ["description", "narrative", "details", "reference", "transaction", "memo", "detail"],
    "amount": ["amount", "transaction amount", "value"],
    "debit": ["debit", "debits", "debit amount", "money out", "withdrawal", "dr"],
    "credit": ["credit", "credits", "credit amount", "money in", "deposit", "cr"],
    "reference": ["reference", "ref", "cheque", "extra"],
    "balance": ["balance", "running balance", "closing balance"],
}


def _match_columns(header: List[str]) -> Dict[str, int]:
    lowered = [h.strip().lower() for h in header]
    mapping: Dict[str, int] = {}
    for field, aliases in _ALIASES.items():
        for i, col in enumerate(lowered):
            if col in aliases and field not in mapping:
                mapping[field] = i
                break
    return mapping


def parse_file(
    path: Path,
    column_map: Optional[Dict[str, int]] = None,
    default_year: Optional[int] = None,
) -> List[BankTransaction]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(fh, dialect))
    return parse_rows(rows, column_map=column_map, default_year=default_year)


def parse_rows(
    rows: List[List[str]],
    column_map: Optional[Dict[str, int]] = None,
    default_year: Optional[int] = None,
) -> List[BankTransaction]:
    if not rows:
        return []
    # Find the header row (first row that maps a date + something monetary).
    header_idx, mapping = _locate_header(rows, column_map)
    if mapping is None or "date" not in mapping:
        raise ValueError(
            "could not identify statement columns; pass an explicit column_map "
            "with at least 'date', 'description' and 'amount' (or 'debit'/'credit')"
        )

    ids = ExternalIdFactory()
    out: List[BankTransaction] = []
    for row in rows[header_idx + 1:]:
        if not any(cell.strip() for cell in row):
            continue
        try:
            txn = _row_to_txn(row, mapping, ids, default_year)
        except (ValueError, IndexError):
            continue  # skip non-transaction rows (subtotals, banners, etc.)
        if txn is not None:
            out.append(txn)
    return out


def _locate_header(rows, column_map):
    if column_map is not None:
        return -1, column_map
    for i, row in enumerate(rows[:15]):
        mapping = _match_columns(row)
        has_amount = "amount" in mapping or "debit" in mapping or "credit" in mapping
        if "date" in mapping and has_amount:
            return i, mapping
    return 0, None


def _row_to_txn(row, mapping, ids: ExternalIdFactory, default_year):
    def cell(field: str) -> str:
        idx = mapping.get(field)
        return row[idx] if idx is not None and idx < len(row) else ""

    date_raw = cell("date").strip()
    if not date_raw:
        return None
    txn_date = parse_date(date_raw, default_year)
    description = cell("description").strip() or "(no description)"
    reference = cell("reference").strip() or None

    if "amount" in mapping:
        amount = parse_amount(cell("amount"))
    else:
        debit = parse_amount(cell("debit"))   # money out
        credit = parse_amount(cell("credit"))  # money in
        amount = abs(credit) - abs(debit)

    if amount.is_zero():
        return None
    external_id = ids.make(txn_date, amount, description)
    return BankTransaction(
        txn_date=txn_date,
        description=description,
        amount=amount,
        external_id=external_id,
        reference=reference,
    )
