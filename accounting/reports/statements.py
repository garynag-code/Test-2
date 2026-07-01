"""Report builders and plain-text renderers.

Balances are read with a single debit-positive convention: a positive signed
balance is a debit balance, a negative one a credit balance. Income and
liability/equity accounts are therefore naturally negative and are flipped for
presentation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional, Tuple

from ..models import AccountType
from ..money import Money


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _accounts(conn):
    return conn.execute(
        "SELECT code, name, type, subtype, normal_side FROM account ORDER BY code"
    ).fetchall()


def _balances(conn, upto: Optional[date]) -> Dict[str, Money]:
    """Debit-positive signed balance per account code, optionally as at date."""
    q = ("SELECT jl.account_code AS code, "
         "COALESCE(SUM(jl.debit_cents - jl.credit_cents),0) AS bal "
         "FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id ")
    params: list = []
    if upto is not None:
        q += "WHERE je.entry_date <= ? "
        params.append(upto.isoformat())
    q += "GROUP BY jl.account_code"
    return {r["code"]: Money.from_cents(r["bal"]) for r in conn.execute(q, params)}


def _period_balances(conn, start: date, end: date) -> Dict[str, Money]:
    q = ("SELECT jl.account_code AS code, "
         "COALESCE(SUM(jl.debit_cents - jl.credit_cents),0) AS bal "
         "FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id "
         "WHERE je.entry_date >= ? AND je.entry_date <= ? "
         "GROUP BY jl.account_code")
    return {r["code"]: Money.from_cents(r["bal"])
            for r in conn.execute(q, (start.isoformat(), end.isoformat()))}


# ---------------------------------------------------------------------------
# Trial balance
# ---------------------------------------------------------------------------
@dataclass
class TrialBalanceRow:
    code: str
    name: str
    debit: Money
    credit: Money


@dataclass
class TrialBalance:
    as_at: Optional[date]
    rows: List[TrialBalanceRow]
    total_debit: Money
    total_credit: Money

    @property
    def balanced(self) -> bool:
        return self.total_debit == self.total_credit


def trial_balance(conn, as_at: Optional[date] = None) -> TrialBalance:
    balances = _balances(conn, as_at)
    rows: List[TrialBalanceRow] = []
    total_dr = Money.zero()
    total_cr = Money.zero()
    for acc in _accounts(conn):
        bal = balances.get(acc["code"], Money.zero())
        if bal.is_zero():
            continue
        if bal > Money.zero():
            debit, credit = bal, Money.zero()
            total_dr += bal
        else:
            debit, credit = Money.zero(), -bal
            total_cr += -bal
        rows.append(TrialBalanceRow(acc["code"], acc["name"], debit, credit))
    return TrialBalance(as_at, rows, total_dr, total_cr)


# ---------------------------------------------------------------------------
# Profit & loss
# ---------------------------------------------------------------------------
@dataclass
class PnLSection:
    title: str
    lines: List[Tuple[str, str, Money]]  # (code, name, amount)
    total: Money


@dataclass
class ProfitAndLoss:
    start: Optional[date]
    end: Optional[date]
    revenue: PnLSection
    cost_of_sales: PnLSection
    other_income: PnLSection
    expenses: PnLSection

    @property
    def gross_profit(self) -> Money:
        return self.revenue.total - self.cost_of_sales.total

    @property
    def net_profit(self) -> Money:
        return (self.revenue.total + self.other_income.total
                - self.cost_of_sales.total - self.expenses.total)


def profit_and_loss(conn, start: Optional[date] = None,
                    end: Optional[date] = None) -> ProfitAndLoss:
    if start is not None and end is not None:
        balances = _period_balances(conn, start, end)
    else:
        balances = _balances(conn, end)

    buckets: Dict[str, List[Tuple[str, str, Money]]] = {
        "REVENUE": [], "COST_OF_SALES": [], "OTHER_INCOME": [], "EXPENSE": []
    }
    for acc in _accounts(conn):
        atype = acc["type"]
        if atype not in ("INCOME", "EXPENSE"):
            continue
        raw = balances.get(acc["code"], Money.zero())
        if raw.is_zero():
            continue
        # Present income as a positive figure (credit balance -> flip sign).
        amount = -raw if atype == "INCOME" else raw
        subtype = acc["subtype"] or ""
        if atype == "INCOME":
            key = "REVENUE" if subtype == "REVENUE" else "OTHER_INCOME"
        else:
            key = "COST_OF_SALES" if subtype == "COST_OF_SALES" else "EXPENSE"
        buckets[key].append((acc["code"], acc["name"], amount))

    def section(title, key):
        lines = buckets[key]
        return PnLSection(title, lines, sum((a for _, _, a in lines), Money.zero()))

    return ProfitAndLoss(
        start=start, end=end,
        revenue=section("Revenue", "REVENUE"),
        cost_of_sales=section("Cost of sales", "COST_OF_SALES"),
        other_income=section("Other income", "OTHER_INCOME"),
        expenses=section("Operating expenses", "EXPENSE"),
    )


# ---------------------------------------------------------------------------
# Balance sheet (IFRS for SMEs statement of financial position)
# ---------------------------------------------------------------------------
@dataclass
class BSSection:
    title: str
    lines: List[Tuple[str, str, Money]]
    total: Money


@dataclass
class BalanceSheet:
    as_at: Optional[date]
    non_current_assets: BSSection
    current_assets: BSSection
    equity: BSSection
    non_current_liabilities: BSSection
    current_liabilities: BSSection
    net_profit: Money

    @property
    def total_assets(self) -> Money:
        return self.non_current_assets.total + self.current_assets.total

    @property
    def total_equity(self) -> Money:
        return self.equity.total + self.net_profit

    @property
    def total_liabilities(self) -> Money:
        return self.non_current_liabilities.total + self.current_liabilities.total

    @property
    def total_equity_and_liabilities(self) -> Money:
        return self.total_equity + self.total_liabilities

    @property
    def balanced(self) -> bool:
        return self.total_assets == self.total_equity_and_liabilities


def balance_sheet(conn, as_at: Optional[date] = None) -> BalanceSheet:
    balances = _balances(conn, as_at)
    pnl = profit_and_loss(conn, end=as_at)

    groups: Dict[str, List[Tuple[str, str, Money]]] = {
        "NON_CURRENT_ASSET": [], "CURRENT_ASSET": [],
        "EQUITY": [], "NON_CURRENT_LIABILITY": [], "CURRENT_LIABILITY": [],
    }
    for acc in _accounts(conn):
        atype = acc["type"]
        if atype not in ("ASSET", "LIABILITY", "EQUITY"):
            continue
        raw = balances.get(acc["code"], Money.zero())
        if raw.is_zero():
            continue
        # Assets keep debit-positive sign; liabilities & equity are flipped
        # so a credit balance shows as a positive figure.
        amount = raw if atype == "ASSET" else -raw
        subtype = acc["subtype"] or ("EQUITY" if atype == "EQUITY" else "CURRENT_ASSET")
        if subtype not in groups:
            subtype = ("CURRENT_ASSET" if atype == "ASSET"
                       else "EQUITY" if atype == "EQUITY" else "CURRENT_LIABILITY")
        groups[subtype].append((acc["code"], acc["name"], amount))

    def section(title, key):
        lines = groups[key]
        return BSSection(title, lines, sum((a for _, _, a in lines), Money.zero()))

    return BalanceSheet(
        as_at=as_at,
        non_current_assets=section("Non-current assets", "NON_CURRENT_ASSET"),
        current_assets=section("Current assets", "CURRENT_ASSET"),
        equity=section("Equity", "EQUITY"),
        non_current_liabilities=section("Non-current liabilities", "NON_CURRENT_LIABILITY"),
        current_liabilities=section("Current liabilities", "CURRENT_LIABILITY"),
        net_profit=pnl.net_profit,
    )


# ---------------------------------------------------------------------------
# Text rendering
# ---------------------------------------------------------------------------
_W = 64


def _line(label: str, amount: Money, indent: int = 0) -> str:
    pad = " " * indent
    text = f"{pad}{label}"
    return f"{text:<{_W - 18}}{amount.format():>18}"


def render_trial_balance(tb: TrialBalance) -> str:
    out = ["TRIAL BALANCE" + (f" as at {tb.as_at}" if tb.as_at else ""), "=" * _W]
    out.append(f"{'Code  Account':<{_W - 36}}{'Debit':>18}{'Credit':>18}")
    out.append("-" * _W)
    for r in tb.rows:
        label = f"{r.code}  {r.name}"[: _W - 36]
        dr = r.debit.format() if not r.debit.is_zero() else ""
        cr = r.credit.format() if not r.credit.is_zero() else ""
        out.append(f"{label:<{_W - 36}}{dr:>18}{cr:>18}")
    out.append("-" * _W)
    out.append(f"{'TOTAL':<{_W - 36}}{tb.total_debit.format():>18}{tb.total_credit.format():>18}")
    out.append("BALANCED" if tb.balanced else "*** OUT OF BALANCE ***")
    return "\n".join(out)


def _render_section(sec, out, sign=1):
    for _code, name, amount in sec.lines:
        out.append(_line(name, amount * sign, indent=2))


def render_profit_and_loss(p: ProfitAndLoss) -> str:
    period = ""
    if p.start and p.end:
        period = f" for {p.start} to {p.end}"
    elif p.end:
        period = f" to {p.end}"
    out = ["STATEMENT OF PROFIT OR LOSS" + period, "=" * _W]
    out.append(p.revenue.title)
    _render_section(p.revenue, out)
    out.append(_line("Total revenue", p.revenue.total))
    if p.cost_of_sales.lines:
        out.append("")
        out.append(p.cost_of_sales.title)
        _render_section(p.cost_of_sales, out, sign=-1)
        out.append(_line("Gross profit", p.gross_profit))
    if p.other_income.lines:
        out.append("")
        out.append(p.other_income.title)
        _render_section(p.other_income, out)
    out.append("")
    out.append(p.expenses.title)
    _render_section(p.expenses, out, sign=-1)
    out.append(_line("Total operating expenses", -p.expenses.total))
    out.append("-" * _W)
    out.append(_line("NET PROFIT / (LOSS)", p.net_profit))
    return "\n".join(out)


def render_balance_sheet(bs: BalanceSheet) -> str:
    out = ["STATEMENT OF FINANCIAL POSITION"
           + (f" as at {bs.as_at}" if bs.as_at else ""), "=" * _W]
    out.append("ASSETS")
    out.append(bs.non_current_assets.title)
    _render_section(bs.non_current_assets, out)
    out.append(_line("Total non-current assets", bs.non_current_assets.total))
    out.append(bs.current_assets.title)
    _render_section(bs.current_assets, out)
    out.append(_line("Total current assets", bs.current_assets.total))
    out.append("-" * _W)
    out.append(_line("TOTAL ASSETS", bs.total_assets))
    out.append("")
    out.append("EQUITY AND LIABILITIES")
    out.append(bs.equity.title)
    _render_section(bs.equity, out)
    out.append(_line("Current-year earnings", bs.net_profit, indent=2))
    out.append(_line("Total equity", bs.total_equity))
    if bs.non_current_liabilities.lines:
        out.append(bs.non_current_liabilities.title)
        _render_section(bs.non_current_liabilities, out)
        out.append(_line("Total non-current liabilities", bs.non_current_liabilities.total))
    out.append(bs.current_liabilities.title)
    _render_section(bs.current_liabilities, out)
    out.append(_line("Total current liabilities", bs.current_liabilities.total))
    out.append("-" * _W)
    out.append(_line("TOTAL EQUITY AND LIABILITIES", bs.total_equity_and_liabilities))
    out.append("BALANCED" if bs.balanced else "*** DOES NOT BALANCE ***")
    return "\n".join(out)


def financial_statements(conn, as_at: Optional[date] = None,
                         start: Optional[date] = None) -> str:
    """Render a combined IFRS-for-SMEs statement set as text."""
    entity = conn.execute("SELECT * FROM entity WHERE id = 1").fetchone()
    header = []
    if entity:
        header.append(entity["name"].upper())
        header.append("Annual Financial Statements (IFRS for SMEs)")
        header.append("")
    tb = trial_balance(conn, as_at)
    pnl = profit_and_loss(conn, start=start, end=as_at)
    bs = balance_sheet(conn, as_at)
    body = "\n\n".join([
        render_profit_and_loss(pnl),
        render_balance_sheet(bs),
        render_trial_balance(tb),
    ])
    prefix = ("\n".join(header) + "\n") if header else ""
    return prefix + body
