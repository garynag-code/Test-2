"""Shared parsing helpers for statement importers.

Bank exports are messy and inconsistent, so date/amount parsing and the
generation of a stable transaction id live here and are reused by every
importer.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from datetime import date, datetime
from typing import Optional

from ..money import Money

_DATE_FORMATS = [
    "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y",
    "%d/%m/%y", "%d-%m-%y", "%Y%m%d", "%d %b", "%m/%d/%Y",
]


def parse_date(raw: str, default_year: Optional[int] = None) -> date:
    """Parse a date from the many formats SA banks emit."""
    s = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(s, fmt)
            if "%Y" not in fmt and "%y" not in fmt:
                dt = dt.replace(year=default_year or date.today().year)
            return dt.date()
        except ValueError:
            continue
    raise ValueError(f"unrecognised date: {raw!r}")


_AMOUNT_CLEAN = re.compile(r"[^\d,.\-()]")


def parse_amount(raw: str) -> Money:
    """Parse an amount, tolerating 'R', thousands separators, () and trailing -."""
    s = raw.strip()
    if not s:
        return Money.zero()
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    if s.endswith("-"):  # some banks put the minus at the end
        neg, s = True, s[:-1]
    s = _AMOUNT_CLEAN.sub("", s)
    if s.startswith("-"):
        neg, s = True, s[1:]
    # Treat comma as a thousands separator unless it is clearly the decimal.
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        # e.g. "1234,56" (decimal comma) vs "1,234" (thousands)
        s = s.replace(",", ".") if re.search(r",\d{2}$", s) else s.replace(",", "")
    if not s or s == ".":
        return Money.zero()
    val = Money(s)
    return -val if neg else val


class ExternalIdFactory:
    """Generates stable, unique ids so re-imports are idempotent.

    Identical (date, amount, description) tuples get an occurrence suffix so
    two genuinely identical transactions on the same day remain distinct while
    a re-run of the *same* file reproduces the *same* ids.
    """

    def __init__(self) -> None:
        self._seen: Counter = Counter()

    def make(self, txn_date: date, amount: Money, description: str) -> str:
        base = f"{txn_date.isoformat()}|{amount.cents}|{description.strip().lower()}"
        self._seen[base] += 1
        keyed = f"{base}#{self._seen[base]}"
        return hashlib.sha256(keyed.encode("utf-8")).hexdigest()[:24]


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
