from datetime import date

import pytest

from accounting import ledger
from accounting.bootstrap import open_book
from accounting.models import JournalEntry, JournalLine
from accounting.money import Money


@pytest.fixture
def conn():
    return open_book(":memory:", name="Test Co", industry="general")


def _entry(**kw):
    return JournalEntry(
        entry_date=date(2026, 3, 1),
        description=kw.get("desc", "test"),
        lines=kw["lines"],
        source="MANUAL",
    )


def test_balanced_entry_posts_with_reference(conn):
    entry = _entry(lines=[
        JournalLine("6050", debit=Money("100")),
        JournalLine("1000", credit=Money("100")),
    ])
    posted = ledger.post(conn, entry, ref_prefix="CB")
    assert posted.id is not None
    assert posted.reference == "CB000001"
    assert ledger.account_balance(conn, "1000") == Money("-100")
    assert ledger.account_balance(conn, "6050") == Money("100")


def test_unbalanced_entry_is_rejected(conn):
    entry = _entry(lines=[
        JournalLine("6050", debit=Money("100")),
        JournalLine("1000", credit=Money("90")),
    ])
    with pytest.raises(ledger.LedgerError):
        ledger.post(conn, entry)


def test_unknown_account_is_rejected(conn):
    entry = _entry(lines=[
        JournalLine("9999", debit=Money("100")),
        JournalLine("1000", credit=Money("100")),
    ])
    with pytest.raises(ledger.LedgerError):
        ledger.post(conn, entry)


def test_reference_sequence_increments(conn):
    for _ in range(3):
        ledger.post(conn, _entry(lines=[
            JournalLine("6050", debit=Money("10")),
            JournalLine("1000", credit=Money("10")),
        ]), ref_prefix="CB")
    row = conn.execute("SELECT COUNT(*) n FROM journal_entry").fetchone()
    assert row["n"] == 3
    last = conn.execute(
        "SELECT reference FROM journal_entry ORDER BY id DESC LIMIT 1").fetchone()
    assert last["reference"] == "CB000003"


def test_reverse_cancels_balances_and_preserves_history(conn):
    posted = ledger.post(conn, _entry(lines=[
        JournalLine("6050", debit=Money("100")),
        JournalLine("1000", credit=Money("100")),
    ]), ref_prefix="CB")
    ledger.reverse(conn, posted.id)
    # Net effect is zero, but both entries still exist (audit trail intact).
    assert ledger.account_balance(conn, "6050") == Money.zero()
    assert ledger.account_balance(conn, "1000") == Money.zero()
    assert conn.execute("SELECT COUNT(*) n FROM journal_entry").fetchone()["n"] == 2
    head = conn.execute(
        "SELECT reversed_by FROM journal_entry WHERE id=?", (posted.id,)).fetchone()
    assert head["reversed_by"] is not None


def test_double_reversal_is_blocked(conn):
    posted = ledger.post(conn, _entry(lines=[
        JournalLine("6050", debit=Money("100")),
        JournalLine("1000", credit=Money("100")),
    ]), ref_prefix="CB")
    ledger.reverse(conn, posted.id)
    with pytest.raises(ledger.LedgerError):
        ledger.reverse(conn, posted.id)
