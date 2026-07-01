"""Domain dataclasses shared across the engine.

These are plain value objects; persistence lives in :mod:`accounting.db` and
the modules that own each table. Keeping them separate means reports and the
CLI can pass typed data around without depending on SQLite row objects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import List, Optional

from .money import Money


class AccountType(str, Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"

    @property
    def normal_side(self) -> str:
        """Debit-normal for assets/expenses; credit-normal for the rest."""
        return "DR" if self in (AccountType.ASSET, AccountType.EXPENSE) else "CR"

    @property
    def is_pnl(self) -> bool:
        return self in (AccountType.INCOME, AccountType.EXPENSE)


@dataclass(frozen=True)
class Account:
    code: str
    name: str
    type: AccountType
    subtype: Optional[str] = None
    is_bank: bool = False
    vat_applicable: bool = True
    active: bool = True
    parent_code: Optional[str] = None

    @property
    def normal_side(self) -> str:
        return self.type.normal_side


@dataclass
class JournalLine:
    """One side of a journal entry. Exactly one of debit/credit is non-zero."""

    account_code: str
    debit: Money = field(default_factory=Money.zero)
    credit: Money = field(default_factory=Money.zero)
    tax_code: str = "NON"
    tax: Money = field(default_factory=Money.zero)
    memo: Optional[str] = None

    def __post_init__(self) -> None:
        if self.debit.is_negative() or self.credit.is_negative():
            raise ValueError("journal line amounts must be non-negative")
        if not self.debit.is_zero() and not self.credit.is_zero():
            raise ValueError("a journal line cannot be both debit and credit")

    @property
    def signed(self) -> Money:
        """Debit-positive signed amount, handy for balancing checks."""
        return self.debit - self.credit


@dataclass
class JournalEntry:
    """A balanced set of journal lines posted on one date."""

    entry_date: date
    description: str
    lines: List[JournalLine]
    source: str = "MANUAL"
    source_ref: Optional[str] = None
    reference: Optional[str] = None  # assigned on posting
    id: Optional[int] = None

    def total_debits(self) -> Money:
        return sum((ln.debit for ln in self.lines), Money.zero())

    def total_credits(self) -> Money:
        return sum((ln.credit for ln in self.lines), Money.zero())

    def is_balanced(self) -> bool:
        return self.total_debits() == self.total_credits()


@dataclass
class BankTransaction:
    """A single line parsed from a bank statement (bank's point of view).

    ``amount`` is positive for money into the account and negative for money
    out. ``external_id`` uniquely identifies the transaction so that importing
    the same statement twice does not create duplicates.
    """

    txn_date: date
    description: str
    amount: Money
    external_id: str
    reference: Optional[str] = None

    @property
    def is_inflow(self) -> bool:
        return self.amount > Money.zero()
