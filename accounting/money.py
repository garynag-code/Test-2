"""Exact money handling.

Floating-point is never used for money. Amounts are held as
:class:`decimal.Decimal` quantised to 2 places, and persisted as an integer
number of cents. All arithmetic in the engine goes through this type so that
rounding is defined in exactly one place.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Union

_CENTS = Decimal("0.01")

Numeric = Union["Money", Decimal, int, str, float]


class Money:
    """A currency amount, exact to the cent.

    ``Money`` is immutable. Construct from a Decimal/str/int (preferred) or,
    when unavoidable, a float. Internally it stores an integer count of cents,
    which is also how it is written to the database.
    """

    __slots__ = ("_cents",)

    def __init__(self, value: Numeric = 0):
        if isinstance(value, Money):
            self._cents = value._cents
        elif isinstance(value, int):
            # An int is treated as a whole-currency amount (e.g. Money(5) == R5.00).
            self._cents = value * 100
        else:
            if isinstance(value, float):
                value = str(value)  # avoid binary-float artefacts
            dec = Decimal(value).quantize(_CENTS, rounding=ROUND_HALF_UP)
            self._cents = int(dec * 100)

    # -- alternate constructors -------------------------------------------
    @classmethod
    def from_cents(cls, cents: int) -> "Money":
        obj = cls.__new__(cls)
        obj._cents = int(cents)
        return obj

    @classmethod
    def zero(cls) -> "Money":
        return cls.from_cents(0)

    # -- accessors ---------------------------------------------------------
    @property
    def cents(self) -> int:
        return self._cents

    @property
    def decimal(self) -> Decimal:
        return (Decimal(self._cents) / 100).quantize(_CENTS)

    # -- arithmetic --------------------------------------------------------
    def __add__(self, other: Numeric) -> "Money":
        return Money.from_cents(self._cents + Money(other)._cents)

    __radd__ = __add__

    def __sub__(self, other: Numeric) -> "Money":
        return Money.from_cents(self._cents - Money(other)._cents)

    def __rsub__(self, other: Numeric) -> "Money":
        return Money.from_cents(Money(other)._cents - self._cents)

    def __mul__(self, factor: Union[Decimal, int, str]) -> "Money":
        result = (Decimal(self._cents) * Decimal(str(factor))).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
        return Money.from_cents(int(result))

    __rmul__ = __mul__

    def __neg__(self) -> "Money":
        return Money.from_cents(-self._cents)

    def __abs__(self) -> "Money":
        return Money.from_cents(abs(self._cents))

    # -- comparisons -------------------------------------------------------
    def __eq__(self, other: object) -> bool:
        if isinstance(other, Money):
            return self._cents == other._cents
        if isinstance(other, (int, str, Decimal)):
            return self._cents == Money(other)._cents
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self._cents)

    def __lt__(self, other: Numeric) -> bool:
        return self._cents < Money(other)._cents

    def __le__(self, other: Numeric) -> bool:
        return self._cents <= Money(other)._cents

    def __gt__(self, other: Numeric) -> bool:
        return self._cents > Money(other)._cents

    def __ge__(self, other: Numeric) -> bool:
        return self._cents >= Money(other)._cents

    def is_zero(self) -> bool:
        return self._cents == 0

    def is_negative(self) -> bool:
        return self._cents < 0

    # -- display -----------------------------------------------------------
    def format(self, symbol: str = "R", thousands: bool = True) -> str:
        neg = self._cents < 0
        whole = abs(self.decimal)
        s = f"{whole:,.2f}" if thousands else f"{whole:.2f}"
        return f"-{symbol}{s}" if neg else f"{symbol}{s}"

    def __str__(self) -> str:
        return self.format()

    def __repr__(self) -> str:
        return f"Money('{self.decimal}')"
