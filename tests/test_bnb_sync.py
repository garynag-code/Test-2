"""Cross-channel sync: the behaviour that actually prevents double bookings."""

from datetime import date, datetime, timedelta, timezone

import pytest

from bnb import icalendar as ics
from bnb.db import create_channel, create_property, create_room, open_db
from bnb.dates import fmt, utc_stamp
from bnb.ledger import is_available, open_conflicts, place_booking
from bnb.sync import (
    channel_health, enforce_guards, export_events, export_feed, import_feed,
    receive_reservation,
)

TODAY = date(2026, 4, 1)


def feed(*events):
    return ics.write([ics.Event(**event) for event in events])


def stay(uid, start_offset, nights_count, summary="Guest"):
    return dict(uid=uid, summary=summary,
                start=TODAY + timedelta(days=start_offset),
                end=TODAY + timedelta(days=start_offset + nights_count))


@pytest.fixture()
def house(tmp_path):
    conn = open_db(tmp_path / "sync.db")
    prop = create_property(conn, "Rose Cottage", timezone="UTC")
    garden = create_room(conn, prop, "Garden Room", sort_order=1)
    attic = create_room(conn, prop, "Attic Room", sort_order=2)
    channels = {
        "airbnb": create_channel(conn, prop, "airbnb", "Airbnb — Garden",
                                 room_id=garden, refresh_minutes=180, stop_sell_hours=24),
        "booking": create_channel(conn, prop, "booking_com", "Booking.com — Garden",
                                  room_id=garden, refresh_minutes=120),
        "attic_airbnb": create_channel(conn, prop, "airbnb", "Airbnb — Attic",
                                       room_id=attic, refresh_minutes=180),
    }
    yield {"conn": conn, "property": prop, "garden": garden, "attic": attic,
           "channels": channels}
    conn.close()


# --------------------------------------------------------------- importing

def test_a_reservation_on_one_platform_blocks_the_others(house):
    """The whole point: Airbnb sells it, Booking.com is told it is gone."""
    import_feed(house["conn"], house["channels"]["airbnb"],
                feed(stay("ab-1", 10, 3, "Jonas (HMX1)")), today=TODAY)

    events = export_events(house["conn"], house["channels"]["booking"],
                           now=datetime(2026, 4, 1, 9, 0))
    blocked = {fmt(event.start) for event in events}
    assert fmt(TODAY + timedelta(days=10)) in blocked
    assert not is_available(house["conn"], house["garden"],
                            TODAY + timedelta(days=10), TODAY + timedelta(days=13))


def test_a_channels_own_booking_is_never_echoed_back_to_it(house):
    """Echoing creates a feedback loop: the platform reads its own reservation
    back as an external block and the two calendars amplify each other."""
    import_feed(house["conn"], house["channels"]["airbnb"],
                feed(stay("ab-1", 10, 3, "Jonas")), today=TODAY)

    events = export_events(house["conn"], house["channels"]["airbnb"],
                           now=datetime(2026, 4, 1, 9, 0))
    labels = {fmt(e.start): e.summary for e in events}
    assert labels.get(fmt(TODAY + timedelta(days=10))) != "Booked"


def test_a_room_is_only_blocked_on_its_own_listing(house):
    import_feed(house["conn"], house["channels"]["airbnb"],
                feed(stay("ab-1", 10, 3)), today=TODAY)
    attic_blocked = {fmt(e.start) for e in export_events(
        house["conn"], house["channels"]["attic_airbnb"], now=datetime(2026, 4, 1, 9, 0))}
    assert fmt(TODAY + timedelta(days=10)) not in attic_blocked


def test_the_same_nights_sold_on_two_platforms_raise_a_conflict(house):
    import_feed(house["conn"], house["channels"]["airbnb"],
                feed(stay("ab-1", 10, 3, "Jonas")), today=TODAY)
    result = import_feed(house["conn"], house["channels"]["booking"],
                         feed(stay("bk-1", 11, 3, "Élodie")), today=TODAY)

    assert result.conflicts == 1
    conflicts = open_conflicts(house["conn"], house["property"])
    assert len(conflicts) == 1
    assert conflicts[0]["incumbent_guest"] == "Jonas"
    assert conflicts[0]["challenger_guest"] == "Élodie"


def test_re_importing_the_same_feed_changes_nothing(house):
    payload = feed(stay("ab-1", 10, 3))
    first = import_feed(house["conn"], house["channels"]["airbnb"], payload, today=TODAY)
    second = import_feed(house["conn"], house["channels"]["airbnb"], payload, today=TODAY)

    assert (first.imported, second.imported) == (1, 0)
    assert second.conflicts == 0, "a re-read must not fight its own reservation"
    count = house["conn"].execute("SELECT COUNT(*) c FROM booking").fetchone()["c"]
    assert count == 1


def test_a_stay_withdrawn_from_the_feed_is_released(house):
    """The cancellation webhook that never arrived.  A nightly full diff is the
    only thing that reliably catches it."""
    import_feed(house["conn"], house["channels"]["airbnb"], feed(stay("ab-1", 10, 3)), today=TODAY)
    result = import_feed(house["conn"], house["channels"]["airbnb"], feed(), today=TODAY)

    assert result.cancelled == 1
    assert is_available(house["conn"], house["garden"],
                        TODAY + timedelta(days=10), TODAY + timedelta(days=13))


def test_a_changed_stay_moves_rather_than_duplicating(house):
    import_feed(house["conn"], house["channels"]["airbnb"], feed(stay("ab-1", 10, 3)), today=TODAY)
    result = import_feed(house["conn"], house["channels"]["airbnb"], feed(stay("ab-1", 12, 2)), today=TODAY)

    assert (result.updated, result.imported) == (1, 0)
    assert is_available(house["conn"], house["garden"],
                        TODAY + timedelta(days=10), TODAY + timedelta(days=11))
    assert not is_available(house["conn"], house["garden"],
                            TODAY + timedelta(days=12), TODAY + timedelta(days=14))


def test_owner_blocks_are_imported_as_blocks_not_guests(house):
    import_feed(house["conn"], house["channels"]["airbnb"],
                feed(stay("blk", 10, 2, "Airbnb (Not available)")), today=TODAY)
    row = house["conn"].execute("SELECT kind, guest_name FROM booking").fetchone()
    assert row["kind"] == "block" and row["guest_name"] is None


def test_stays_already_in_the_past_are_skipped(house):
    """A feed carries history; re-importing it must not resurrect old stays."""
    old = dict(uid="old", summary="Last year",
               start=date(2020, 1, 1), end=date(2020, 1, 5))
    result = import_feed(house["conn"], house["channels"]["airbnb"], feed(old), today=TODAY)
    assert result.imported == 0


# ------------------------------------------------------------- the guards

def test_a_slow_channel_is_not_trusted_with_tonights_room(house):
    """Airbnb re-reads a subscribed feed only every few hours, so a same-day
    arrival sold there is a race we would lose."""
    now = datetime(2026, 4, 1, 18, 0)
    blocked = {fmt(e.start) for e in export_events(
        house["conn"], house["channels"]["airbnb"], now=now)}

    assert fmt(TODAY) in blocked, "tonight is withheld from the slow channel"
    assert fmt(TODAY + timedelta(days=5)) not in blocked, "next week stays on sale"
    # ...but the ledger is untouched, so the owner can still take a walk-in.
    assert is_available(house["conn"], house["garden"], TODAY, TODAY + timedelta(days=1))


def test_a_channel_without_a_stop_sell_window_keeps_tonight_on_sale(house):
    blocked = {fmt(e.start) for e in export_events(
        house["conn"], house["channels"]["booking"], now=datetime(2026, 4, 1, 18, 0))}
    assert fmt(TODAY) not in blocked


def test_the_last_open_room_can_be_held_back_from_the_platforms(house):
    conn = house["conn"]
    conn.execute("UPDATE property SET hold_last_room = 1 WHERE id = ?", (house["property"],))
    # The Attic sells, leaving the Garden as the only room free that night.
    place_booking(conn, property_id=house["property"], room_id=house["attic"],
                  checkin=TODAY + timedelta(days=20), checkout=TODAY + timedelta(days=21),
                  guest_name="Solo")

    blocked = {fmt(e.start) for e in export_events(
        conn, house["channels"]["booking"], now=datetime(2026, 4, 1, 9, 0))}
    assert fmt(TODAY + timedelta(days=20)) in blocked
    # Still sellable directly — the hold is a channel policy, not a closure.
    assert is_available(conn, house["garden"],
                        TODAY + timedelta(days=20), TODAY + timedelta(days=21))


def test_holding_the_last_room_is_skipped_for_a_one_room_property(tmp_path):
    """Otherwise the policy would simply mean never selling anything."""
    conn = open_db(tmp_path / "solo.db")
    prop = create_property(conn, "Tiny", hold_last_room=True)
    room = create_room(conn, prop, "The Room")
    channel = create_channel(conn, prop, "airbnb", "Airbnb", room_id=room)
    place_booking(conn, property_id=prop, room_id=room, checkin="2026-04-10",
                  checkout="2026-04-11", guest_name="Ada")

    blocked = {fmt(e.start) for e in export_events(conn, channel,
                                                   now=datetime(2026, 4, 1, 9, 0))}
    assert "2026-04-20" not in blocked
    conn.close()


def test_a_dark_channel_takes_its_inventory_off_sale(house):
    """We no longer know what it has sold, so we stop selling it too."""
    conn = house["conn"]
    long_ago = (datetime.now(timezone.utc) - timedelta(hours=40)).replace(microsecond=0)
    conn.execute("UPDATE channel SET status='ok', last_success_at=? WHERE id=?",
                 (long_ago.isoformat(), house["channels"]["airbnb"]))

    health = channel_health(conn, house["channels"]["airbnb"])
    assert health["stale"] and health["needs_attention"]

    results = enforce_guards(conn, house["property"], now=datetime(2026, 4, 1, 9, 0))
    assert any(result.closed for result in results)
    assert not is_available(conn, house["garden"], "2026-04-10", "2026-04-11")


def test_a_dark_channel_never_closes_a_night_that_is_already_sold(house):
    conn = house["conn"]
    place_booking(conn, property_id=house["property"], room_id=house["garden"],
                  checkin="2026-04-10", checkout="2026-04-12", guest_name="Ada")
    long_ago = (datetime.now(timezone.utc) - timedelta(hours=40)).replace(microsecond=0)
    conn.execute("UPDATE channel SET status='ok', last_success_at=? WHERE id=?",
                 (long_ago.isoformat(), house["channels"]["airbnb"]))

    enforce_guards(conn, house["property"], now=datetime(2026, 4, 1, 9, 0))
    state = conn.execute(
        "SELECT state FROM room_night WHERE room_id=? AND night='2026-04-10'",
        (house["garden"],)).fetchone()["state"]
    assert state == "sold", "a closure sweep must never overwrite a real guest"


def test_inventory_comes_back_when_the_channel_recovers(house):
    conn = house["conn"]
    long_ago = (datetime.now(timezone.utc) - timedelta(hours=40)).replace(microsecond=0)
    conn.execute("UPDATE channel SET status='ok', last_success_at=? WHERE id=?",
                 (long_ago.isoformat(), house["channels"]["airbnb"]))
    enforce_guards(conn, house["property"], now=datetime(2026, 4, 1, 9, 0))
    assert not is_available(conn, house["garden"], "2026-04-10", "2026-04-11")

    conn.execute("UPDATE channel SET status='ok', last_success_at=? WHERE id=?",
                 (utc_stamp(), house["channels"]["airbnb"]))
    results = enforce_guards(conn, house["property"], now=datetime(2026, 4, 1, 9, 0))
    assert any(result.reopened for result in results)
    assert is_available(conn, house["garden"], "2026-04-10", "2026-04-11")


def test_a_never_verified_channel_is_flagged_but_does_not_close_the_calendar(house):
    """Closing everything the moment a channel is added would make setup
    unusable; the owner is warned loudly instead."""
    health = channel_health(house["conn"], house["channels"]["airbnb"])
    assert health["needs_attention"] and not health["verified"]

    enforce_guards(house["conn"], house["property"], now=datetime(2026, 4, 1, 9, 0))
    assert is_available(house["conn"], house["garden"], "2026-04-10", "2026-04-11")


# ------------------------------------------------------------- the webhook

def test_a_retried_webhook_delivery_does_not_book_twice(house):
    payload = {"reference": "BDC-99", "checkin": "2026-04-10",
               "checkout": "2026-04-13", "guest_name": "Ada", "amount_cents": 30000}
    first = receive_reservation(house["conn"], house["channels"]["booking"], payload)
    replay = receive_reservation(house["conn"], house["channels"]["booking"], payload)

    assert first["booking_id"] == replay["booking_id"]
    assert replay["action"] == "replayed"
    count = house["conn"].execute("SELECT COUNT(*) c FROM booking").fetchone()["c"]
    assert count == 1


def test_a_webhook_cancellation_releases_the_room(house):
    receive_reservation(house["conn"], house["channels"]["booking"],
                        {"reference": "BDC-99", "checkin": "2026-04-10",
                         "checkout": "2026-04-13", "guest_name": "Ada"})
    result = receive_reservation(house["conn"], house["channels"]["booking"],
                                 {"reference": "BDC-99", "action": "cancel"})
    assert result["action"] == "cancelled"
    assert is_available(house["conn"], house["garden"], "2026-04-10", "2026-04-13")


def test_a_webhook_without_a_reference_is_refused(house):
    """With nothing to deduplicate on, a retry would sell the room twice."""
    with pytest.raises(ValueError):
        receive_reservation(house["conn"], house["channels"]["booking"],
                            {"checkin": "2026-04-10", "checkout": "2026-04-12"})


def test_a_clashing_webhook_reservation_is_recorded_not_dropped(house):
    place_booking(house["conn"], property_id=house["property"], room_id=house["garden"],
                  checkin="2026-04-10", checkout="2026-04-14", guest_name="Ada")
    result = receive_reservation(house["conn"], house["channels"]["booking"],
                                 {"reference": "BDC-1", "checkin": "2026-04-12",
                                  "checkout": "2026-04-16", "guest_name": "Bob"})
    assert result["ok"] is False
    assert result["conflict_id"] is not None
    assert len(open_conflicts(house["conn"], house["property"])) == 1


# ---------------------------------------------------------------- feed out

def test_the_exported_feed_is_valid_and_merges_adjacent_nights(house):
    import_feed(house["conn"], house["channels"]["airbnb"], feed(stay("ab-1", 10, 3)), today=TODAY)
    body = export_feed(house["conn"], house["channels"]["booking"],
                       now=datetime(2026, 4, 1, 9, 0))

    assert body.startswith("BEGIN:VCALENDAR") and body.rstrip().endswith("END:VCALENDAR")
    events = ics.parse(body)
    booked = [e for e in events if e.summary == "Booked"]
    assert len(booked) == 1, "three consecutive nights are one event, not three"
    assert (booked[0].end - booked[0].start).days == 3


def test_an_owner_block_is_off_sale_rather_than_sold(house):
    """A block is inventory withheld, not a guest — counting it as a sale
    overstates occupancy and puts a phantom arrival on the day sheet."""
    import_feed(house["conn"], house["channels"]["airbnb"],
                feed(stay("blk", 10, 2, "Airbnb (Not available)")), today=TODAY)
    state = house["conn"].execute(
        "SELECT state FROM room_night WHERE room_id = ? ORDER BY night",
        (house["garden"],)).fetchone()["state"]
    assert state == "closed"
