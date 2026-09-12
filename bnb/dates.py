"""Stay-date arithmetic.

Stay dates are *local calendar dates*, never instants.  A guest arriving on
the 3rd arrives on the 3rd whether the server is in Dublin or Denver, so we
store ``YYYY-MM-DD`` strings and compare them as dates.  Storing a check-in as
a UTC timestamp is the most common and most damaging bug in accommodation
software: it silently shifts arrivals across the date line for anyone east of
Greenwich.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ISO = "%Y-%m-%d"


def parse_date(value) -> date:
    """Accept a ``date`` or a ``YYYY-MM-DD`` string; reject anything else."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return datetime.strptime(value.strip(), ISO).date()
    raise TypeError(f"expected a date or YYYY-MM-DD string, got {value!r}")


def fmt(value) -> str:
    return parse_date(value).strftime(ISO)


def nights(checkin, checkout) -> list[date]:
    """The nights a stay occupies: check-in through the night before checkout.

    Checkout day is *not* occupied — that room is sellable to the next guest
    the same day.  Getting this wrong costs an owner one sellable night per
    stay, which on a four-room B&B is a five-figure annual mistake.
    """
    start, end = parse_date(checkin), parse_date(checkout)
    if end <= start:
        raise ValueError("checkout must be after checkin (a stay is at least one night)")
    return [start + timedelta(days=offset) for offset in range((end - start).days)]


def date_range(start, end) -> list[date]:
    """Every date in ``[start, end)`` — used for calendar windows."""
    start, end = parse_date(start), parse_date(end)
    if end < start:
        raise ValueError("end must not precede start")
    return [start + timedelta(days=offset) for offset in range((end - start).days)]


def today_in(tz_name: str) -> date:
    """'Today' at the property, not on the server.

    A property in Auckland turns over its arrivals board twelve hours before a
    UTC server thinks the day has changed.
    """
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        tz = timezone.utc
    return datetime.now(tz).date()


def now_in(tz_name: str) -> datetime:
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        tz = timezone.utc
    return datetime.now(tz)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_stamp() -> str:
    """Timestamps (audit trail, sync times) *are* instants, so they are UTC."""
    return utc_now().replace(microsecond=0).isoformat()
