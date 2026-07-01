"""Command-line interface for the cashbook and reports.

Examples
--------
    # create a book and a bank account
    python -m accounting init --db acme.db --name "Acme Trading" \
        --industry retail --vat-registered
    python -m accounting add-bank --db acme.db --name "FNB Cheque" --gl 1000

    # import a statement, review suggestions, auto-post the confident ones
    python -m accounting import --db acme.db --bank 1 --file statement.csv
    python -m accounting review --db acme.db
    python -m accounting auto-post --db acme.db --min-confidence 0.9
    python -m accounting allocate --db acme.db --line 7 --account 6150 --tax STD

    # reports
    python -m accounting trial-balance --db acme.db
    python -m accounting pnl --db acme.db
    python -m accounting balance-sheet --db acme.db
    python -m accounting statements --db acme.db
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from typing import Optional

from . import cashbook, reports
from .accounts import INDUSTRIES
from .bootstrap import open_book
from .db import connect
from .money import Money


def _parse_date(s: Optional[str]) -> Optional[date]:
    return date.fromisoformat(s) if s else None


def cmd_init(args):
    open_book(args.db, name=args.name, industry=args.industry,
              vat_registered=args.vat_registered, vat_number=args.vat_number,
              fy_start_month=args.fy_start_month)
    print(f"Initialised book '{args.name}' ({args.industry}) at {args.db}")
    if args.vat_registered:
        print("VAT registered: standard rate 15%")


def cmd_add_bank(args):
    conn = connect(args.db)
    bid = cashbook.add_bank_account(conn, args.name, args.gl,
                                    bank_name=args.bank_name or "",
                                    account_number=args.account_number or "")
    print(f"Added bank account #{bid}: {args.name} -> GL {args.gl}")


def cmd_import(args):
    conn = open_book(args.db)
    res = cashbook.import_statement(conn, args.bank, args.file,
                                    default_year=args.year)
    print(f"Imported {args.file}:")
    print(f"  parsed      : {res.parsed}")
    print(f"  new lines   : {res.inserted}")
    print(f"  duplicates  : {res.duplicates}")
    print(f"  suggested   : {res.suggested}")


def cmd_review(args):
    conn = connect(args.db)
    rows = cashbook.pending_lines(conn)
    if not rows:
        print("Nothing pending — every line is allocated.")
        return
    print(f"{'ID':>4}  {'Date':<10} {'Amount':>12}  {'Sugg':<6} {'Tax':<4} {'Conf':>5}  Description")
    print("-" * 96)
    for r in rows:
        amt = Money.from_cents(r["amount_cents"])
        conf = f"{r['suggested_conf']:.2f}" if r["suggested_conf"] is not None else "  -  "
        print(f"{r['id']:>4}  {r['txn_date']:<10} {amt.format():>12}  "
              f"{(r['suggested_code'] or '-'):<6} {(r['suggested_tax'] or '-'):<4} "
              f"{conf:>5}  {r['description'][:44]}")


def cmd_allocate(args):
    conn = open_book(args.db)
    entry = cashbook.allocate_line(conn, args.line, args.account, args.tax)
    print(f"Posted {entry.reference}: {entry.description} "
          f"(DR {entry.total_debits()} / CR {entry.total_credits()})")


def cmd_auto_post(args):
    conn = open_book(args.db)
    n = cashbook.auto_post(conn, min_confidence=args.min_confidence)
    print(f"Auto-posted {n} line(s) at confidence >= {args.min_confidence}")


def cmd_trial_balance(args):
    conn = connect(args.db)
    print(reports.render_trial_balance(
        reports.trial_balance(conn, as_at=_parse_date(args.as_at))))


def cmd_pnl(args):
    conn = connect(args.db)
    print(reports.render_profit_and_loss(
        reports.profit_and_loss(conn, start=_parse_date(args.start),
                                end=_parse_date(args.end))))


def cmd_balance_sheet(args):
    conn = connect(args.db)
    print(reports.render_balance_sheet(
        reports.balance_sheet(conn, as_at=_parse_date(args.as_at))))


def cmd_statements(args):
    conn = connect(args.db)
    print(reports.financial_statements(conn, as_at=_parse_date(args.as_at),
                                       start=_parse_date(args.start)))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="accounting", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default="books.db", help="path to the accounting database")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("init", help="create/initialise a set of books")
    s.add_argument("--name", required=True)
    s.add_argument("--industry", default="general", choices=INDUSTRIES)
    s.add_argument("--vat-registered", action="store_true")
    s.add_argument("--vat-number")
    s.add_argument("--fy-start-month", type=int, default=3)
    s.set_defaults(func=cmd_init)

    s = sub.add_parser("add-bank", help="add a bank account")
    s.add_argument("--name", required=True)
    s.add_argument("--gl", required=True, help="GL account code for the bank")
    s.add_argument("--bank-name")
    s.add_argument("--account-number")
    s.set_defaults(func=cmd_add_bank)

    s = sub.add_parser("import", help="import a CSV/PDF bank statement")
    s.add_argument("--bank", type=int, required=True, help="bank account id")
    s.add_argument("--file", required=True)
    s.add_argument("--year", type=int, help="default year for day/month-only dates")
    s.set_defaults(func=cmd_import)

    s = sub.add_parser("review", help="list lines awaiting allocation")
    s.set_defaults(func=cmd_review)

    s = sub.add_parser("allocate", help="confirm/allocate one statement line")
    s.add_argument("--line", type=int, required=True)
    s.add_argument("--account", required=True, help="GL account code")
    s.add_argument("--tax", default="NON")
    s.set_defaults(func=cmd_allocate)

    s = sub.add_parser("auto-post", help="post confident suggestions")
    s.add_argument("--min-confidence", type=float, default=0.9)
    s.set_defaults(func=cmd_auto_post)

    s = sub.add_parser("trial-balance", help="print the trial balance")
    s.add_argument("--as-at")
    s.set_defaults(func=cmd_trial_balance)

    s = sub.add_parser("pnl", help="print the profit & loss")
    s.add_argument("--start")
    s.add_argument("--end")
    s.set_defaults(func=cmd_pnl)

    s = sub.add_parser("balance-sheet", help="print the statement of financial position")
    s.add_argument("--as-at")
    s.set_defaults(func=cmd_balance_sheet)

    s = sub.add_parser("statements", help="print the full IFRS-for-SMEs statement set")
    s.add_argument("--as-at")
    s.add_argument("--start")
    s.set_defaults(func=cmd_statements)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
