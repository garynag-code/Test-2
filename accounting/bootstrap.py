"""One-call setup for a fresh (or existing) set of books."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

from . import accounts, cashbook
from .allocation import install_seed_rules
from .db import connect


def open_book(
    path: Union[str, Path],
    name: Optional[str] = None,
    industry: str = "general",
    vat_registered: bool = False,
    vat_number: Optional[str] = None,
    fy_start_month: int = 3,
):
    """Open the accounting database at *path*, installing the chart, VAT codes
    and seed rules on first use. If *name* is given, (re)sets the entity and
    installs the industry-specific chart.
    """
    conn = connect(path)
    if name is not None:
        cashbook.set_entity(conn, name, industry=industry,
                            vat_registered=vat_registered, vat_number=vat_number,
                            fy_start_month=fy_start_month)
    accounts.install_chart(conn, industry=industry)
    accounts.install_tax_codes(conn)
    install_seed_rules(conn)
    return conn
