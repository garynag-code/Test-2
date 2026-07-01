"""Ledger auto-allocation: rules engine + learned memory.

Given a bank-statement description ("POS PURCHASE ENGEN GARAGE 1234"), this
suggests the general-ledger account and VAT code to post it to, with a
confidence and a plain-English rationale for the audit trail.

Precedence, most trusted first:

1. **Learned rules** — allocations the user has confirmed before. Once
   "ENGEN" is confirmed to Fuel & Oil, every later ENGEN line auto-matches.
2. **Seed rules** — a starter set of well-known South African vendors and
   generic keywords (fuel stations, telcos, municipalities, banks…).
3. **Enricher** (optional/pluggable) — an external "intelligence" (an LLM or
   web vendor-lookup) consulted only when the rules are silent. It is an
   injected interface so the deterministic, auditable core never depends on a
   network call; see :class:`Enricher`.
4. **Suspense** — anything still unknown lands in the suspense account at low
   confidence so it is visibly awaiting a human.

Confirming a suggestion calls :func:`learn`, which is how the system "remembers
allocations" and reuses them every month.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Protocol

SUSPENSE_CODE = "8000"

# Noise tokens common in SA bank narratives, stripped when deriving a vendor key.
_NOISE = {
    "pos", "purchase", "payment", "card", "debit", "credit", "order", "eft",
    "ref", "transfer", "fee", "fees", "cash", "withdrawal", "deposit", "the",
    "pty", "ltd", "cc", "za", "sa", "to", "from", "at", "of", "and", "no",
    "trf", "int", "abs", "fnb", "acb", "onl", "app",
}
_WORD = re.compile(r"[a-z]+")


def normalize(text: str) -> str:
    """Lowercase and collapse a description for matching."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def vendor_key(text: str) -> str:
    """Derive a stable vendor key from a description.

    Keeps alphabetic words, drops noise/stopwords and pure numbers, so
    "POS PURCHASE ENGEN N1 CITY 4471" -> "engen city". Used as the pattern for
    learned rules and to compare two narratives for the same payee.
    """
    words = [w for w in _WORD.findall(text.lower()) if w not in _NOISE and len(w) > 2]
    return " ".join(words[:3])


@dataclass(frozen=True)
class Suggestion:
    account_code: str
    tax_code: str
    confidence: float          # 0..1
    origin: str                # LEARNED | SEED | AI | SUSPENSE
    rationale: str


class Enricher(Protocol):
    """Pluggable external allocator (LLM / web vendor lookup).

    Implementations receive the raw description and return a suggestion or
    ``None``. This is the seam where "search the SA internet for the vendor"
    can be added later without changing the core engine or its audit trail.
    """

    def suggest(self, description: str) -> Optional[Suggestion]:
        ...


# --- seed rules: (contains-pattern, account_code, tax_code, rationale) ------
# Patterns are matched as substrings against the normalized description.
SEED_RULES: List[tuple] = [
    # Fuel stations
    ("engen", "6150", "STD", "Engen — fuel station"),
    ("sasol", "6150", "STD", "Sasol — fuel station"),
    ("shell", "6150", "STD", "Shell — fuel station"),
    ("bp ", "6150", "STD", "BP — fuel station"),
    ("caltex", "6150", "STD", "Caltex — fuel station"),
    ("total ", "6150", "STD", "TotalEnergies — fuel station"),
    ("astron", "6150", "STD", "Astron Energy — fuel"),
    ("puma energy", "6150", "STD", "Puma Energy — fuel"),
    # Telco / connectivity
    ("telkom", "6400", "STD", "Telkom — telephone & internet"),
    ("vodacom", "6400", "STD", "Vodacom — telephone & internet"),
    ("mtn", "6400", "STD", "MTN — telephone & internet"),
    ("cell c", "6400", "STD", "Cell C — telephone & internet"),
    ("afrihost", "6400", "STD", "Afrihost — internet"),
    ("webafrica", "6400", "STD", "Web Africa — internet"),
    ("rain ", "6400", "STD", "Rain — connectivity"),
    # Utilities / municipality
    ("eskom", "6450", "STD", "Eskom — electricity"),
    ("city of", "6450", "STD", "Municipality — electricity & water"),
    ("municipal", "6450", "STD", "Municipality — electricity & water"),
    # Insurance
    ("santam", "6250", "STD", "Santam — insurance"),
    ("outsurance", "6250", "STD", "OUTsurance — insurance"),
    ("discovery ins", "6250", "STD", "Discovery Insure — insurance"),
    ("old mutual", "6250", "STD", "Old Mutual — insurance"),
    ("momentum", "6250", "STD", "Momentum — insurance"),
    # Bank charges (no VAT)
    ("bank charge", "6050", "NON", "Bank charge"),
    ("service fee", "6050", "NON", "Bank service fee"),
    ("admin fee", "6050", "NON", "Bank admin fee"),
    ("monthly account", "6050", "NON", "Monthly account fee"),
    ("cash dep fee", "6050", "NON", "Cash deposit fee"),
    # Payroll (no VAT)
    ("salary", "6100", "NON", "Salary payment"),
    ("salaries", "6100", "NON", "Salary payment"),
    ("wages", "6100", "NON", "Wages payment"),
    ("payroll", "6100", "NON", "Payroll"),
    # Interest
    ("interest received", "4200", "NON", "Interest received"),
    ("credit interest", "4200", "NON", "Interest received"),
    ("interest paid", "6750", "NON", "Interest paid"),
    ("debit interest", "6750", "NON", "Interest paid"),
    # Stationery / office
    ("waltons", "6500", "STD", "Waltons — stationery"),
    ("stationery", "6500", "STD", "Stationery"),
]


def install_seed_rules(conn) -> int:
    """Install the built-in seed rules (idempotent)."""
    now = datetime.now(timezone.utc).isoformat()
    n = 0
    for pattern, code, tax, _rationale in SEED_RULES:
        cur = conn.execute(
            """INSERT OR IGNORE INTO allocation_rule
               (match_type, pattern, account_code, tax_code, origin, priority, created_at)
               VALUES ('CONTAINS', ?, ?, ?, 'SEED', 100, ?)""",
            (pattern, code, tax, now),
        )
        n += cur.rowcount
    conn.commit()
    return n


class Allocator:
    """Suggests ledger allocations, consulting learned rules first."""

    def __init__(self, conn, enricher: Optional[Enricher] = None):
        self.conn = conn
        self.enricher = enricher

    def suggest(self, description: str) -> Suggestion:
        norm = normalize(description)

        # 1 + 2: database rules (LEARNED before SEED via priority), longest
        # pattern wins so specific vendors beat generic keywords.
        rules = self.conn.execute(
            """SELECT pattern, account_code, tax_code, origin, priority
               FROM allocation_rule
               WHERE match_type = 'CONTAINS'
               ORDER BY priority ASC, LENGTH(pattern) DESC, hits DESC"""
        ).fetchall()
        for r in rules:
            if r["pattern"] in norm:
                learned = r["origin"] == "LEARNED"
                self._touch_rule(r["pattern"], r["account_code"])
                return Suggestion(
                    account_code=r["account_code"],
                    tax_code=r["tax_code"],
                    confidence=0.98 if learned else 0.85,
                    origin=r["origin"],
                    rationale=(
                        "Matched a previously confirmed allocation"
                        if learned else f"Matched rule '{r['pattern']}'"
                    ),
                )

        # 3: optional external enricher.
        if self.enricher is not None:
            hit = self.enricher.suggest(description)
            if hit is not None:
                return hit

        # 4: suspense.
        return Suggestion(
            account_code=SUSPENSE_CODE,
            tax_code="NON",
            confidence=0.0,
            origin="SUSPENSE",
            rationale="No rule matched — needs a human decision",
        )

    def _touch_rule(self, pattern: str, code: str) -> None:
        self.conn.execute(
            """UPDATE allocation_rule SET hits = hits + 1, last_used_at = ?
               WHERE pattern = ? AND account_code = ?""",
            (datetime.now(timezone.utc).isoformat(), pattern, code),
        )


def learn(conn, description: str, account_code: str, tax_code: str) -> Optional[str]:
    """Record a confirmed allocation so the same vendor auto-maps next time.

    Returns the learned pattern (vendor key), or ``None`` if no usable key
    could be derived from *description*.
    """
    key = vendor_key(description)
    if not key:
        return None
    now = datetime.now(timezone.utc).isoformat()
    # Upsert: if the vendor was previously learned to a different account,
    # move it to the newly confirmed one (the human is the source of truth).
    conn.execute(
        """INSERT INTO allocation_rule
           (match_type, pattern, account_code, tax_code, origin, priority, hits, created_at)
           VALUES ('CONTAINS', ?, ?, ?, 'LEARNED', 10, 1, ?)
           ON CONFLICT(match_type, pattern, account_code)
           DO UPDATE SET hits = hits + 1, tax_code = excluded.tax_code,
                         last_used_at = excluded.created_at""",
        (key, account_code, tax_code, now),
    )
    # Retire stale learned rules that mapped this vendor elsewhere.
    conn.execute(
        """DELETE FROM allocation_rule
           WHERE match_type='CONTAINS' AND pattern=? AND origin='LEARNED'
             AND account_code<>?""",
        (key, account_code),
    )
    conn.commit()
    return key
