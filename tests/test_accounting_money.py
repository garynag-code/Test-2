from decimal import Decimal

from accounting.money import Money


def test_int_is_whole_currency():
    assert Money(5) == Money("5.00")
    assert Money(5).cents == 500


def test_from_cents_and_decimal():
    m = Money.from_cents(1234)
    assert m.decimal == Decimal("12.34")
    assert str(m) == "R12.34"


def test_float_is_not_lossy():
    # 0.1 + 0.2 must not drift.
    assert Money("0.1") + Money("0.2") == Money("0.30")


def test_rounding_half_up():
    assert Money("1.005") == Money("1.01")


def test_multiplication_rounds_to_cent():
    # 15/115 of 575.00 == 75.00 exactly
    from decimal import Decimal as D
    assert Money("575.00") * (D("15") / D("115")) == Money("75.00")


def test_arithmetic_and_signs():
    assert Money("100") - Money("115") == Money("-15")
    assert abs(Money("-15")) == Money("15")
    assert (-Money("15")).is_negative()
    assert Money.zero().is_zero()


def test_sum_builtin_with_zero_start():
    total = sum((Money("1.11"), Money("2.22"), Money("3.33")), Money.zero())
    assert total == Money("6.66")


def test_formatting_thousands_and_negative():
    assert Money("1234567.89").format() == "R1,234,567.89"
    assert Money("-500").format() == "-R500.00"
