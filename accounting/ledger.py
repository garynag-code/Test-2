"""The double-entry general ledger — the heart of the system.

Every financial event ends up here as a balanced :class:`JournalEntry`. The
ledger enforces the invariants an auditor cares about:

* debits equal credits on every posted entry (rejected otherwise);
* posted entries are immutable — corrections are made by *reversing* and
  re-posting, never by editing history;
* every referenced account exists and is active;
* each entry gets a sequential, human-readable reference (e.g. ``CB000042``);
* every post/reversal is written to the append-only ``audit_log``.

Later phases (AR, AP, stock) post through this same module, so those
invariants hold for the entire book, not just the cashbook.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional

from .models import JournalEntry, JournalLine
from .money import Money


class LedgerError(Exception):
    """Raised when a posting would violate a ledger invariant."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def audit(conn, action: str, object_type: str, object_id, detail: str = "",
          actor: str = "system") -> None:
    conn.execute(
        """INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail)
           VALUES (?,?,?,?,?,?)""",
        (_now(), actor, action, object_type, str(object_id), detail),
    )


def next_reference(conn, prefix: str) -> str:
    """Allocate the next sequential document reference for *prefix*.

    Counts existing entries with the same prefix; safe within a single writer
    (SQLite serialises writes) which is the model this engine assumes.
    """
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM journal_entry WHERE reference LIKE ?",
        (f"{prefix}%",),
    ).fetchone()
    return f"{prefix}{row['n'] + 1:06d}"


def _account_active(conn, code: str) -> bool:
    row = conn.execute(
        "SELECT active FROM account WHERE code = ?", (code,)
    ).fetchone()
    return row is not None and row["active"] == 1


def post(conn, entry: JournalEntry, actor: str = "system",
         ref_prefix: str = "JE") -> JournalEntry:
    """Validate and persist *entry*. Returns it with ``id``/``reference`` set.

    Raises :class:`LedgerError` if the entry is unbalanced, empty, or refers
    to a missing/inactive account. The whole post is one SQLite transaction.
    """
    if not entry.lines:
        raise LedgerError("journal entry has no lines")
    if not entry.is_balanced():
        raise LedgerError(
            f"entry not balanced: debits {entry.total_debits()} "
            f"!= credits {entry.total_credits()}"
        )
    for ln in entry.lines:
        if not _account_active(conn, ln.account_code):
            raise LedgerError(f"account {ln.account_code!r} missing or inactive")

    reference = entry.reference or next_reference(conn, ref_prefix)
    try:
        cur = conn.execute(
            """INSERT INTO journal_entry
               (reference, entry_date, description, source, source_ref, created_at)
               VALUES (?,?,?,?,?,?)""",
            (reference, entry.entry_date.isoformat(), entry.description,
             entry.source, entry.source_ref, _now()),
        )
        entry.id = cur.lastrowid
        entry.reference = reference
        for i, ln in enumerate(entry.lines, start=1):
            conn.execute(
                """INSERT INTO journal_line
                   (entry_id, line_no, account_code, debit_cents, credit_cents,
                    tax_code, tax_cents, memo)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (entry.id, i, ln.account_code, ln.debit.cents, ln.credit.cents,
                 ln.tax_code, ln.tax.cents, ln.memo),
            )
        audit(conn, "POST", "journal_entry", entry.id,
              f"{reference} {entry.description}", actor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return entry


def reverse(conn, entry_id: int, on_date: Optional[date] = None,
            actor: str = "system") -> JournalEntry:
    """Post a reversing entry that cancels *entry_id*, preserving history."""
    head = conn.execute(
        "SELECT * FROM journal_entry WHERE id = ?", (entry_id,)
    ).fetchone()
    if head is None:
        raise LedgerError(f"journal entry {entry_id} not found")
    if head["reversed_by"] is not None:
        raise LedgerError(f"entry {entry_id} already reversed")

    lines = conn.execute(
        "SELECT * FROM journal_line WHERE entry_id = ? ORDER BY line_no",
        (entry_id,),
    ).fetchall()
    rev_lines: List[JournalLine] = [
        JournalLine(
            account_code=l["account_code"],
            debit=Money.from_cents(l["credit_cents"]),
            credit=Money.from_cents(l["debit_cents"]),
            tax_code=l["tax_code"],
            tax=Money.from_cents(-l["tax_cents"]),
            memo=f"Reversal of {head['reference']}",
        )
        for l in lines
    ]
    rev = JournalEntry(
        entry_date=on_date or date.fromisoformat(head["entry_date"]),
        description=f"REVERSAL: {head['description']}",
        lines=rev_lines,
        source=head["source"],
        source_ref=head["source_ref"],
    )
    posted = post(conn, rev, actor=actor, ref_prefix="REV")
    conn.execute("UPDATE journal_entry SET reverses = ? WHERE id = ?",
                 (entry_id, posted.id))
    conn.execute("UPDATE journal_entry SET reversed_by = ? WHERE id = ?",
                 (posted.id, entry_id))
    audit(conn, "REVERSE", "journal_entry", entry_id,
          f"reversed by {posted.reference}", actor)
    conn.commit()
    return posted


def account_balance(conn, code: str, upto: Optional[date] = None) -> Money:
    """Signed balance (debit-positive) for *code*, optionally as at *upto*."""
    q = ("SELECT COALESCE(SUM(jl.debit_cents - jl.credit_cents),0) AS bal "
         "FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id "
         "WHERE jl.account_code = ?")
    params: list = [code]
    if upto is not None:
        q += " AND je.entry_date <= ?"
        params.append(upto.isoformat())
    row = conn.execute(q, params).fetchone()
    return Money.from_cents(row["bal"])
