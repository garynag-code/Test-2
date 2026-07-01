"""PDF bank-statement importer (optional).

PDF layouts vary wildly between banks, so this is a pragmatic heuristic
extractor: it pulls the text with ``pdfplumber`` and reads lines that look
like transactions — a leading date, a description, and a trailing signed
amount. A per-bank profile can refine the regex later; the goal here is a
sensible default plus a clear seam for that.

``pdfplumber`` is an optional dependency; a helpful error is raised if the
user tries to import a PDF without it installed.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional

from ..models import BankTransaction
from .base import ExternalIdFactory, parse_amount, parse_date

# date .... description .... amount [balance]
_LINE = re.compile(
    r"^\s*(?P<date>\d{1,2}[\s/\-][A-Za-z0-9]{2,9}[\s/\-]?\d{0,4})\s+"
    r"(?P<desc>.+?)\s+"
    r"(?P<amount>[-(]?\s?R?\s?[\d\s.,]+\)?-?)\s*$"
)


def _require_pdfplumber():
    try:
        import pdfplumber  # noqa: F401
        return pdfplumber
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise ImportError(
            "PDF import needs the optional 'pdfplumber' package. "
            "Install it with:  pip install pdfplumber"
        ) from exc


def extract_text(path: Path) -> str:
    pdfplumber = _require_pdfplumber()
    parts: List[str] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


def parse_text(text: str, default_year: Optional[int] = None) -> List[BankTransaction]:
    ids = ExternalIdFactory()
    out: List[BankTransaction] = []
    for line in text.splitlines():
        m = _LINE.match(line)
        if not m:
            continue
        try:
            txn_date = parse_date(m.group("date").strip(), default_year)
            amount = parse_amount(m.group("amount"))
        except ValueError:
            continue
        if amount.is_zero():
            continue
        desc = " ".join(m.group("desc").split())
        out.append(
            BankTransaction(
                txn_date=txn_date,
                description=desc or "(no description)",
                amount=amount,
                external_id=ids.make(txn_date, amount, desc),
            )
        )
    return out


def parse_file(path: Path, default_year: Optional[int] = None) -> List[BankTransaction]:
    return parse_text(extract_text(path), default_year=default_year)
