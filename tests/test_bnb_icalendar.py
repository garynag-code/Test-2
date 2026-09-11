"""The free tier's connectivity: reading and writing calendar feeds."""

from datetime import date

import pytest

from bnb import icalendar as ics

AIRBNB_FEED = "\r\n".join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airbnb Inc//Hosting Calendar 1.0.0//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "DTEND;VALUE=DATE:20260404",
    "DTSTART;VALUE=DATE:20260401",
    "UID:1234567890abcdef@airbnb.com",
    "SUMMARY:Jonas (HMAB3CDEF4)",
    "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de",
    " tails/HMAB3CDEF4\\nPhone Number (Last 4 Digits): 1234",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTEND;VALUE=DATE:20260412",
    "DTSTART;VALUE=DATE:20260410",
    "UID:blocked-0001@airbnb.com",
    "SUMMARY:Airbnb (Not available)",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
])


def test_reads_a_real_airbnb_feed():
    events = ics.parse(AIRBNB_FEED)
    assert len(events) == 2
    stay = events[0]
    assert stay.start == date(2026, 4, 1)
    assert stay.end == date(2026, 4, 4)
    assert stay.guest_name == "Jonas", "the reservation code is not part of the name"
    assert not stay.is_block


def test_unfolds_a_wrapped_description():
    """Feeds wrap long lines; a naive reader loses half the text."""
    events = ics.parse(AIRBNB_FEED)
    assert "details/HMAB3CDEF4" in events[0].description
    assert "\n" in events[0].description, "an escaped \\n becomes a real newline"


def test_recognises_owner_blocks_in_several_languages():
    for summary in ("Airbnb (Not available)", "CLOSED", "Blocked",
                    "No disponible", "Nicht verfügbar"):
        event = ics.Event(uid="x", start=date(2026, 4, 1), end=date(2026, 4, 2),
                          summary=summary)
        assert event.is_block, summary
        assert event.guest_name is None


def test_a_malformed_event_does_not_strand_the_rest_of_the_feed():
    feed = "\r\n".join([
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT", "UID:broken", "DTSTART;VALUE=DATE:not-a-date", "END:VEVENT",
        "BEGIN:VEVENT", "UID:fine", "DTSTART;VALUE=DATE:20260501",
        "DTEND;VALUE=DATE:20260503", "SUMMARY:Ada", "END:VEVENT",
        "END:VCALENDAR", ""])
    events = ics.parse(feed)
    assert [event.uid for event in events] == ["fine"]


def test_backwards_and_zero_length_events_are_dropped():
    feed = "\r\n".join([
        "BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:20260503",
        "DTEND;VALUE=DATE:20260501", "END:VEVENT",
        "BEGIN:VEVENT", "UID:b", "DTSTART;VALUE=DATE:20260503",
        "DTEND;VALUE=DATE:20260503", "END:VEVENT", ""])
    assert ics.parse(feed) == []


def test_datetime_forms_are_reduced_to_their_date():
    feed = "\r\n".join([
        "BEGIN:VEVENT", "UID:z", "DTSTART:20260501T150000Z",
        "DTEND:20260503T110000Z", "SUMMARY:Ada", "END:VEVENT", ""])
    event = ics.parse(feed)[0]
    assert (event.start, event.end) == (date(2026, 5, 1), date(2026, 5, 3))


def test_an_event_without_a_uid_still_gets_a_stable_one():
    feed = "\r\n".join([
        "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260501",
        "DTEND;VALUE=DATE:20260503", "SUMMARY:Ada", "END:VEVENT", ""])
    first, second = ics.parse(feed)[0], ics.parse(feed)[0]
    assert first.uid and first.uid == second.uid, "re-imports must match, not duplicate"


def test_round_trip_preserves_dates_and_identity():
    events = ics.parse(AIRBNB_FEED)
    again = ics.parse(ics.write(events))
    assert [(e.uid, e.start, e.end) for e in again] == [(e.uid, e.start, e.end) for e in events]


def test_written_lines_are_folded_at_75_octets():
    long_name = "Bed & Breakfast " + "x" * 200
    output = ics.write(
        [ics.Event(uid="u", start=date(2026, 4, 1), end=date(2026, 4, 2), summary=long_name)],
        name=long_name)
    for line in output.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75, line[:40]


@pytest.mark.parametrize("summary", [
    "أحمد بن سالم " * 12,          # Arabic, 2 bytes per character
    "日本語のお客様さま " * 12,      # Japanese, 3 bytes
    "Ünïcödé Gäste " * 12,         # Latin with diacritics
    "🛏️ family suite " * 12,       # emoji, 4 bytes plus a variation selector
])
def test_folding_never_splits_a_multibyte_character(summary):
    """A fold boundary landing mid-character corrupts the feed.

    Every line must be valid UTF-8 on its own, which a purely 7-bit test suite
    never checks — and guest names are the least ASCII part of the product.
    """
    summary = summary.strip()
    output = ics.write([ics.Event(uid="u", start=date(2026, 4, 1),
                                  end=date(2026, 4, 2), summary=summary)])
    for line in output.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75
        line.encode("utf-8").decode("utf-8")          # raises if split badly
    assert ics.parse(output)[0].summary == summary


def test_surrounding_whitespace_in_a_summary_is_trimmed():
    """Real feeds pad values; the guest is "Jonas", not " Jonas "."""
    feed = "\r\n".join([
        "BEGIN:VEVENT", "UID:p", "DTSTART;VALUE=DATE:20260501",
        "DTEND;VALUE=DATE:20260502", "SUMMARY:  Jonas  ", "END:VEVENT", ""])
    assert ics.parse(feed)[0].summary == "Jonas"


def test_special_characters_survive_a_round_trip():
    summary = "Smith; Jones, party\\ of two"
    output = ics.write([ics.Event(uid="u", start=date(2026, 4, 1),
                                  end=date(2026, 4, 2), summary=summary)])
    assert ics.parse(output)[0].summary == summary
