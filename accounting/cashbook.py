"""The cashbook: turn imported bank lines into balanced ledger postings.

Flow:

    import_statement()   -> load a CSV/PDF, store each line, attach an
                            allocation *suggestion* (rules/memory), idempotently.
    allocate_line()      -> a human (or auto_post) confirms an account + VAT
                            code; a balanced journal entry is posted and the
                            allocation is *learned* for next time.
    auto_post()          -> post everything whose suggestion is confident enough,
                            leaving the rest for review.

Each bank line becomes a two- or three-legged journal entry:

    money out (R115 @ 15%):  DR expense 100, DR VAT control 15, CR bank 115
    money in  (R115 @ 15%):  DR bank 115, CR income 100, CR VAT control 15

so the bank leg always equals the statement movement and the books balance.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Union

from . import ledger, vat
from .accounts import VAT_CONTROL_CODE
from .allocation import Allocator, learn
from .importers import load_file
from .importers.base import sha256_file
from .models import BankTransaction, JournalEntry, JournalLine
from .money import Money


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Entity + bank-account setup
# ---------------------------------------------------------------------------
def set_entity(conn, name: str, industry: str = "general",
               vat_registered: bool = False, vat_number: Optional[str] = None,
               fy_start_month: int = 3) -> None:
    conn.execute(
        """INSERT INTO entity (id, name, industry, vat_registered, vat_number,
                               fy_start_month, created_at)
           VALUES (1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, industry=excluded.industry,
             vat_registered=excluded.vat_registered,
             vat_number=excluded.vat_number, fy_start_month=excluded.fy_start_month""",
        (name, industry, int(vat_registered), vat_number, fy_start_month, _now()),
    )
    conn.commit()


def get_entity(conn):
    return conn.execute("SELECT * FROM entity WHERE id = 1").fetchone()


def add_bank_account(conn, name: str, gl_code: str, bank_name: str = "",
                     account_number: str = "") -> int:
    cur = conn.execute(
        """INSERT INTO bank_account (name, bank_name, account_number, gl_code, created_at)
           VALUES (?,?,?,?,?)""",
        (name, bank_name, account_number, gl_code, _now()),
    )
    conn.commit()
    return cur.lastrowid


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------
@dataclass
class ImportResult:
    import_id: int
    parsed: int
    inserted: int
    duplicates: int
    suggested: int


def import_statement(conn, bank_account_id: int, path: Union[str, Path],
                     allocator: Optional[Allocator] = None, **parse_kwargs) -> ImportResult:
    """Load a statement file, store its lines, and attach suggestions.

    Re-importing the same transactions is safe: lines are keyed on a stable
    ``external_id`` and duplicates are counted, not re-inserted.
    """
    path = Path(path)
    txns: List[BankTransaction] = load_file(path, **parse_kwargs)
    allocator = allocator or Allocator(conn)

    cur = conn.execute(
        """INSERT INTO statement_import
           (bank_account_id, filename, file_sha256, row_count, imported_at)
           VALUES (?,?,?,?,?)""",
        (bank_account_id, path.name, sha256_file(path), len(txns), _now()),
    )
    import_id = cur.lastrowid

    inserted = duplicates = suggested = 0
    for txn in txns:
        exists = conn.execute(
            "SELECT 1 FROM statement_line WHERE external_id = ?", (txn.external_id,)
        ).fetchone()
        if exists:
            duplicates += 1
            continue
        sug = allocator.suggest(txn.description)
        status = "SUGGESTED" if sug.origin != "SUSPENSE" else "UNALLOCATED"
        if sug.origin != "SUSPENSE":
            suggested += 1
        conn.execute(
            """INSERT INTO statement_line
               (import_id, bank_account_id, txn_date, description, reference,
                amount_cents, external_id, status, suggested_code, suggested_tax,
                suggested_conf, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (import_id, bank_account_id, txn.txn_date.isoformat(), txn.description,
             txn.reference, txn.amount.cents, txn.external_id, status,
             sug.account_code, sug.tax_code, sug.confidence, _now()),
        )
        inserted += 1
    ledger.audit(conn, "IMPORT", "statement_import", import_id,
                 f"{path.name}: {inserted} new, {duplicates} dup")
    conn.commit()
    return ImportResult(import_id, len(txns), inserted, duplicates, suggested)


# ---------------------------------------------------------------------------
# Allocation -> posting
# ---------------------------------------------------------------------------
def _build_entry(conn, line, account_code: str, tax_code: str) -> JournalEntry:
    """Construct the balanced journal entry for one statement line."""
    bank = conn.execute(
        "SELECT gl_code FROM bank_account WHERE id = ?", (line["bank_account_id"],)
    ).fetchone()
    bank_code = bank["gl_code"]
    amount = Money.from_cents(line["amount_cents"])
    gross = abs(amount)
    outflow = amount.is_negative()

    entity = get_entity(conn)
    vat_registered = bool(entity and entity["vat_registered"])
    rate = vat.rate_for(conn, tax_code) if vat_registered else 0
    split = vat.split_inclusive(gross, rate, tax_code)

    txn_date = datetime.strptime(line["txn_date"], "%Y-%m-%d").date()
    lines: List[JournalLine] = []
    if outflow:
        lines.append(JournalLine(account_code, debit=split.net, tax_code=tax_code,
                                 tax=split.vat, memo=line["description"]))
        if not split.vat.is_zero():
            lines.append(JournalLine(VAT_CONTROL_CODE, debit=split.vat,
                                     memo="Input VAT"))
        lines.append(JournalLine(bank_code, credit=gross))
    else:
        lines.append(JournalLine(bank_code, debit=gross))
        lines.append(JournalLine(account_code, credit=split.net, tax_code=tax_code,
                                 tax=split.vat, memo=line["description"]))
        if not split.vat.is_zero():
            lines.append(JournalLine(VAT_CONTROL_CODE, credit=split.vat,
                                     memo="Output VAT"))
    return JournalEntry(
        entry_date=txn_date,
        description=line["description"],
        lines=lines,
        source="CASHBOOK",
        source_ref=line["reference"] or line["external_id"][:12],
    )


def allocate_line(conn, line_id: int, account_code: str, tax_code: str = "NON",
                  actor: str = "user", remember: bool = True) -> JournalEntry:
    """Confirm an allocation: post the entry, link it, and learn the vendor."""
    line = conn.execute(
        "SELECT * FROM statement_line WHERE id = ?", (line_id,)
    ).fetchone()
    if line is None:
        raise ValueError(f"statement line {line_id} not found")
    if line["status"] == "ALLOCATED":
        raise ValueError(f"statement line {line_id} is already allocated")

    entry = _build_entry(conn, line, account_code, tax_code)
    posted = ledger.post(conn, entry, actor=actor, ref_prefix="CB")
    conn.execute(
        "UPDATE statement_line SET status='ALLOCATED', entry_id=?, "
        "suggested_code=?, suggested_tax=? WHERE id=?",
        (posted.id, account_code, tax_code, line_id),
    )
    if remember:
        learn(conn, line["description"], account_code, tax_code)
    conn.commit()
    return posted


def auto_post(conn, min_confidence: float = 0.9, actor: str = "auto") -> int:
    """Post every suggested line at or above *min_confidence*. Returns count."""
    rows = conn.execute(
        """SELECT id, suggested_code, suggested_tax FROM statement_line
           WHERE status='SUGGESTED' AND suggested_conf >= ?
           ORDER BY txn_date, id""",
        (min_confidence,),
    ).fetchall()
    n = 0
    for r in rows:
        allocate_line(conn, r["id"], r["suggested_code"], r["suggested_tax"],
                      actor=actor, remember=False)
        n += 1
    return n


def pending_lines(conn) -> List:
    """Statement lines still awaiting confirmation."""
    return conn.execute(
        "SELECT * FROM statement_line WHERE status <> 'ALLOCATED' "
        "ORDER BY txn_date, id"
    ).fetchall()
