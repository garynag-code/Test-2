from datetime import date

import pytest

from accounting import cashbook, ledger, reports
from accounting.allocation import Allocator, vendor_key
from accounting.bootstrap import open_book
from accounting.importers import csv_importer
from accounting.money import Money


CSV_ROWS = [
    ["Date", "Description", "Debit", "Credit"],
    ["2026/03/02", "POS PURCHASE ENGEN GARAGE N1 CITY", "575.00", ""],
    ["2026/03/03", "MONTHLY ACCOUNT FEE", "120.00", ""],
    ["2026/03/10", "EFT CUSTOMER PAYMENT INV1023", "", "11500.00"],
]


@pytest.fixture
def conn():
    c = open_book(":memory:", name="Acme", industry="retail", vat_registered=True)
    cashbook.add_bank_account(c, "FNB Cheque", "1000")
    return c


def _write_csv(tmp_path, rows=CSV_ROWS):
    import csv
    p = tmp_path / "stmt.csv"
    with open(p, "w", newline="") as fh:
        csv.writer(fh).writerows(rows)
    return p


def test_csv_parsing_signs_and_amounts(tmp_path):
    txns = csv_importer.parse_file(_write_csv(tmp_path))
    assert len(txns) == 3
    assert txns[0].amount == Money("-575.00")   # debit -> outflow
    assert txns[2].amount == Money("11500.00")  # credit -> inflow


def test_import_is_idempotent(conn, tmp_path):
    path = _write_csv(tmp_path)
    first = cashbook.import_statement(conn, 1, path)
    second = cashbook.import_statement(conn, 1, path)
    assert first.inserted == 3
    assert second.inserted == 0
    assert second.duplicates == 3


def test_outflow_posting_splits_vat(conn, tmp_path):
    cashbook.import_statement(conn, 1, _write_csv(tmp_path))
    engen = conn.execute(
        "SELECT id FROM statement_line WHERE description LIKE 'POS%ENGEN%'").fetchone()
    cashbook.allocate_line(conn, engen["id"], "6150", "STD")
    # 575 incl 15% -> 500 net expense, 75 input VAT, 575 credit to bank.
    assert ledger.account_balance(conn, "6150") == Money("500.00")
    assert ledger.account_balance(conn, "2100") == Money("75.00")  # DR input VAT
    assert ledger.account_balance(conn, "1000") == Money("-575.00")


def test_inflow_posting_splits_output_vat(conn, tmp_path):
    cashbook.import_statement(conn, 1, _write_csv(tmp_path))
    sale = conn.execute(
        "SELECT id FROM statement_line WHERE description LIKE 'EFT%'").fetchone()
    cashbook.allocate_line(conn, sale["id"], "4000", "STD")
    # 11500 incl -> 10000 revenue (credit), 1500 output VAT (credit).
    assert ledger.account_balance(conn, "4000") == Money("-10000.00")
    assert ledger.account_balance(conn, "2100") == Money("-1500.00")
    assert ledger.account_balance(conn, "1000") == Money("11500.00")


def test_allocation_is_learned_and_reused(conn):
    alloc = Allocator(conn)
    desc = "PAYFAST WEIRDSHOP 998"
    assert alloc.suggest(desc).origin == "SUSPENSE"
    # Post it once as a stationery expense; it should be remembered.
    from accounting.allocation import learn
    key = learn(conn, desc, "6500", "STD")
    assert key == vendor_key(desc)
    sug = Allocator(conn).suggest("PAYFAST WEIRDSHOP 1201")
    assert sug.account_code == "6500"
    assert sug.origin == "LEARNED"
    assert sug.confidence > 0.9


def test_non_vat_registered_entity_does_not_split(tmp_path):
    c = open_book(":memory:", name="Small", industry="general", vat_registered=False)
    cashbook.add_bank_account(c, "Bank", "1000")
    cashbook.import_statement(c, 1, _write_csv(tmp_path))
    engen = c.execute(
        "SELECT id FROM statement_line WHERE description LIKE 'POS%ENGEN%'").fetchone()
    cashbook.allocate_line(c, engen["id"], "6150", "STD")
    # No VAT split: full 575 hits the expense, VAT control untouched.
    assert ledger.account_balance(c, "6150") == Money("575.00")
    assert ledger.account_balance(c, "2100") == Money.zero()


def test_reports_balance_after_full_run(conn, tmp_path):
    cashbook.import_statement(conn, 1, _write_csv(tmp_path))
    for row in conn.execute("SELECT id, suggested_code, suggested_tax FROM statement_line"):
        code = row["suggested_code"]
        # Give the unmatched inflow a revenue account.
        if code == "8000":
            code, tax = "4000", "STD"
        else:
            tax = row["suggested_tax"]
        cashbook.allocate_line(conn, row["id"], code, tax)

    tb = reports.trial_balance(conn)
    assert tb.balanced
    bs = reports.balance_sheet(conn)
    assert bs.balanced
    pnl = reports.profit_and_loss(conn)
    # revenue 10000 - (fuel 500 + bank charge 120) = 9380
    assert pnl.net_profit == Money("9380.00")
