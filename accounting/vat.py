"""South African VAT.

The standard rate is 15%. Bank-statement amounts are VAT *inclusive*, so the
core operation is splitting a gross amount into its net and VAT parts:

    vat = gross * rate / (100 + rate)      # 15/115 of the gross at 15%
    net = gross - vat

Rates are read from the ``tax_code`` table (basis points) rather than being
hard-coded, so a future rate change is a data change, not a code change.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .money import Money

STANDARD_RATE_BPS = 1500  # 15.00%


@dataclass(frozen=True)
class VatSplit:
    gross: Money
    net: Money
    vat: Money
    tax_code: str
    rate_bps: int


def split_inclusive(gross: Money, rate_bps: int, tax_code: str) -> VatSplit:
    """Split a VAT-inclusive *gross* amount into net + VAT at *rate_bps*."""
    if rate_bps <= 0:
        return VatSplit(gross=gross, net=gross, vat=Money.zero(),
                        tax_code=tax_code, rate_bps=rate_bps)
    rate = Decimal(rate_bps) / Decimal(10000)  # 1500 bps -> 0.15
    fraction = rate / (Decimal(1) + rate)      # 0.15 / 1.15
    vat = gross * fraction                      # Money rounds half-up to the cent
    net = gross - vat
    return VatSplit(gross=gross, net=net, vat=vat,
                    tax_code=tax_code, rate_bps=rate_bps)


def rate_for(conn, tax_code: str) -> int:
    row = conn.execute(
        "SELECT rate_bps FROM tax_code WHERE code = ?", (tax_code,)
    ).fetchone()
    if row is None:
        raise ValueError(f"unknown tax code: {tax_code!r}")
    return int(row["rate_bps"])
