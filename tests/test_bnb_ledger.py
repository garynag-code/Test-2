"""The double-booking guarantees, which are the reason the product exists."""

import sqlite3
import threading

import pytest

from bnb.db import create_channel, create_property, create_room, open_db
from bnb.dates import nights
from bnb.ledger import (
    LedgerError, available_rooms, calendar, cancel_booking, close_nights, day_sheet,
    is_available, move_booking, occupancy_stats, open_conflicts, place_booking,
    reopen_nights, resolve_conflict,
)


@pytest.fixture()
def db(tmp_path):
    conn = open_db(tmp_path / "test.db")
    yield conn
    conn.close()


@pytest.fixture()
def house(db):
    prop = create_property(db, "Rose Cottage", timezone="Europe/Dublin")
    rooms = {
        "garden": create_room(db, prop, "Garden Room", base_rate_cents=11000, sort_order=1),
        "attic": create_room(db, prop, "Attic Room", base_rate_cents=9000, sort_order=2),
    }
    return {"conn": db, "property": prop, "rooms": rooms}


def book(house, room, checkin, checkout, **kwargs):
    return place_booking(
        house["conn"], property_id=house["property"],
        room_id=house["rooms"][room], checkin=checkin, checkout=checkout, **kwargs)


# ---------------------------------------------------------------- stay maths

def test_checkout_day_is_not_occupied():
    """The departure day is sellable to the next guest, and forgetting that
    silently destroys one night of inventory per stay."""
    assert len(nights("2026-04-01", "2026-04-04")) == 3
    assert [str(n) for n in nights("2026-04-01", "2026-04-04")][-1] == "2026-04-03"


def test_a_stay_must_be_at_least_one_night():
    with pytest.raises(ValueError):
        nights("2026-04-01", "2026-04-01")


def test_back_to_back_stays_do_not_clash(house):
    assert book(house, "garden", "2026-04-01", "2026-04-04", guest_name="Ada").ok
    # Bob arrives the morning Ada leaves — this must be allowed.
    assert book(house, "garden", "2026-04-04", "2026-04-06", guest_name="Bob").ok


# ------------------------------------------------------- the core guarantee

def test_overlapping_stay_in_same_room_is_refused(house):
    assert book(house, "garden", "2026-04-01", "2026-04-05", guest_name="Ada").ok
    clash = book(house, "garden", "2026-04-03", "2026-04-07", guest_name="Bob")
    assert not clash.ok
    assert clash.clashing_nights == ["2026-04-03", "2026-04-04"]


def test_same_dates_in_a_different_room_is_fine(house):
    assert book(house, "garden", "2026-04-01", "2026-04-05").ok
    assert book(house, "attic", "2026-04-01", "2026-04-05").ok


def test_the_ledger_itself_rejects_a_second_sale(house):
    """Even with every application check bypassed, the storage layer refuses.

    This is the guarantee that survives a future refactor deleting a check.
    """
    placement = book(house, "garden", "2026-04-01", "2026-04-02", guest_name="Ada")
    conn = house["conn"]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO room_night (room_id, night, state, booking_id, updated_at)"
            " VALUES (?, '2026-04-01', 'sold', ?, '2026-01-01T00:00:00')",
            (house["rooms"]["garden"], placement.booking_id))


def test_an_owners_own_booking_is_refused_rather_than_recorded_as_a_clash(house):
    """The owner is on the phone with the guest — they need "no", not an inbox
    item to deal with later."""
    book(house, "garden", "2026-04-01", "2026-04-05", guest_name="Ada")
    clash = book(house, "garden", "2026-04-02", "2026-04-03", authoritative=False)
    assert not clash.ok
    assert clash.booking_id is None
    assert open_conflicts(house["conn"], house["property"]) == []


def test_an_ota_booking_that_clashes_goes_to_the_conflict_inbox(house):
    """The far side already sold it and the guest holds a confirmation, so it
    cannot simply be dropped."""
    first = book(house, "garden", "2026-04-01", "2026-04-05", guest_name="Ada")
    clash = book(house, "garden", "2026-04-02", "2026-04-06",
                 guest_name="Bob", authoritative=True)

    assert not clash.ok
    assert clash.conflict_id is not None
    conflicts = open_conflicts(house["conn"], house["property"])
    assert len(conflicts) == 1
    assert conflicts[0]["incumbent_id"] == first.booking_id
    assert conflicts[0]["challenger_guest"] == "Bob"
    # The incumbent keeps the room; the challenger is recorded, not sold.
    assert is_available(house["conn"], house["rooms"]["garden"], "2026-04-05", "2026-04-06")


def test_raise_for_status_turns_a_clash_into_an_exception(house):
    book(house, "garden", "2026-04-01", "2026-04-03")
    with pytest.raises(LedgerError):
        book(house, "garden", "2026-04-01", "2026-04-03").raise_for_status()


# -------------------------------------------------------------- idempotency

def test_a_replayed_reservation_does_not_sell_the_room_twice(house):
    first = book(house, "garden", "2026-04-01", "2026-04-03",
                 guest_name="Ada", idempotency_key="channel-42")
    replay = book(house, "garden", "2026-04-01", "2026-04-03",
                  guest_name="Ada", idempotency_key="channel-42")

    assert replay.ok and replay.replayed
    assert replay.booking_id == first.booking_id
    count = house["conn"].execute("SELECT COUNT(*) c FROM booking").fetchone()["c"]
    assert count == 1


def test_a_replayed_clash_stays_a_clash(house):
    book(house, "garden", "2026-04-01", "2026-04-05")
    first = book(house, "garden", "2026-04-02", "2026-04-04",
                 authoritative=True, idempotency_key="dup")
    replay = book(house, "garden", "2026-04-02", "2026-04-04",
                  authoritative=True, idempotency_key="dup")
    assert not first.ok and not replay.ok
    assert len(open_conflicts(house["conn"], house["property"])) == 1


# ----------------------------------------------------------- concurrency

def test_two_simultaneous_writers_cannot_both_sell_the_same_night(tmp_path):
    """The realistic failure: two channels deliver the same night at once."""
    path = tmp_path / "race.db"
    setup = open_db(path)
    prop = create_property(setup, "Rose Cottage")
    room = create_room(setup, prop, "Garden Room")
    setup.close()

    results, barrier = [], threading.Barrier(2)

    def attempt(name):
        conn = open_db(path)
        try:
            barrier.wait(timeout=10)
            results.append(place_booking(
                conn, property_id=prop, room_id=room,
                checkin="2026-04-01", checkout="2026-04-03", guest_name=name))
        except LedgerError:
            results.append(None)
        finally:
            conn.close()

    threads = [threading.Thread(target=attempt, args=(n,)) for n in ("Ada", "Bob")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    winners = [r for r in results if r and r.ok]
    assert len(winners) == 1, "exactly one writer may win the night"

    conn = open_db(path)
    sold = conn.execute(
        "SELECT COUNT(*) c FROM room_night WHERE night = '2026-04-01'").fetchone()["c"]
    conn.close()
    assert sold == 1


# -------------------------------------------------------- moving and closing

def test_moving_a_stay_frees_its_old_nights(house):
    placement = book(house, "garden", "2026-04-01", "2026-04-04", guest_name="Ada")
    assert move_booking(house["conn"], placement.booking_id,
                        room_id=house["rooms"]["attic"]).ok
    assert is_available(house["conn"], house["rooms"]["garden"], "2026-04-01", "2026-04-04")
    assert not is_available(house["conn"], house["rooms"]["attic"], "2026-04-01", "2026-04-04")


def test_a_move_into_an_occupied_room_changes_nothing(house):
    ada = book(house, "garden", "2026-04-01", "2026-04-04", guest_name="Ada")
    book(house, "attic", "2026-04-02", "2026-04-03", guest_name="Bob")

    blocked = move_booking(house["conn"], ada.booking_id, room_id=house["rooms"]["attic"])
    assert not blocked.ok
    # Ada must still hold her original room: a failed move may not strand her.
    assert not is_available(house["conn"], house["rooms"]["garden"], "2026-04-01", "2026-04-04")


def test_extending_a_stay_in_place_is_allowed(house):
    ada = book(house, "garden", "2026-04-01", "2026-04-03", guest_name="Ada")
    assert move_booking(house["conn"], ada.booking_id, checkout="2026-04-06").ok
    assert not is_available(house["conn"], house["rooms"]["garden"], "2026-04-05", "2026-04-06")


def test_cancelling_releases_the_nights(house):
    placement = book(house, "garden", "2026-04-01", "2026-04-04")
    assert cancel_booking(house["conn"], placement.booking_id)
    assert is_available(house["conn"], house["rooms"]["garden"], "2026-04-01", "2026-04-04")
    assert not cancel_booking(house["conn"], placement.booking_id), "cancelling twice is a no-op"


def test_closing_nights_never_overwrites_a_real_booking(house):
    book(house, "garden", "2026-04-02", "2026-04-03", guest_name="Ada")
    close_nights(house["conn"], house["rooms"]["garden"],
                 ["2026-04-01", "2026-04-02", "2026-04-03"], reason="channel_dark:7")

    states = dict(house["conn"].execute(
        "SELECT night, state FROM room_night WHERE room_id = ?",
        (house["rooms"]["garden"],)).fetchall())
    assert states["2026-04-02"] == "sold", "Ada's night must survive a closure sweep"
    assert states["2026-04-01"] == "closed"


def test_reopening_only_clears_the_matching_closure(house):
    room = house["rooms"]["garden"]
    close_nights(house["conn"], room, ["2026-04-01"], reason="channel_dark:7")
    close_nights(house["conn"], room, ["2026-04-02"], reason="channel_dark:9")
    assert reopen_nights(house["conn"], reason="channel_dark:7") == 1
    assert is_available(house["conn"], room, "2026-04-01", "2026-04-02")
    assert not is_available(house["conn"], room, "2026-04-02", "2026-04-03")


def test_resolving_a_conflict_clears_the_inbox(house):
    book(house, "garden", "2026-04-01", "2026-04-05")
    clash = book(house, "garden", "2026-04-02", "2026-04-04", authoritative=True)
    assert resolve_conflict(house["conn"], clash.conflict_id, "moved to Attic")
    assert open_conflicts(house["conn"], house["property"]) == []


# ------------------------------------------------------------------- views

def test_available_rooms_excludes_the_occupied_one(house):
    book(house, "garden", "2026-04-01", "2026-04-04")
    free = available_rooms(house["conn"], house["property"], "2026-04-02", "2026-04-03")
    assert [room["name"] for room in free] == ["Attic Room"]


def test_calendar_marks_the_arrival_night(house):
    book(house, "garden", "2026-04-02", "2026-04-04", guest_name="Ada")
    grid = calendar(house["conn"], house["property"], "2026-04-01", "2026-04-06")
    cells = grid["nights"][house["rooms"]["garden"]]
    assert cells["2026-04-02"]["arrival"] is True
    assert cells["2026-04-03"]["arrival"] is False
    assert "2026-04-04" not in cells, "departure day is open again"


def test_day_sheet_finds_the_same_day_turnover(house):
    book(house, "garden", "2026-04-01", "2026-04-03", guest_name="Ada")
    book(house, "garden", "2026-04-03", "2026-04-05", guest_name="Bob")
    sheet = day_sheet(house["conn"], house["property"], "2026-04-03")

    assert [r["guest_name"] for r in sheet["departures"]] == ["Ada"]
    assert [r["guest_name"] for r in sheet["arrivals"]] == ["Bob"]
    assert sheet["turnovers"] == [house["rooms"]["garden"]]


def test_occupancy_apportions_revenue_across_the_window(house):
    """A stay straddling the window edge contributes only its nights inside it."""
    book(house, "garden", "2026-04-01", "2026-04-05",
         guest_name="Ada", amount_cents=40000)          # 4 nights at 100.00
    stats = occupancy_stats(house["conn"], house["property"], "2026-04-01", "2026-04-03")

    assert stats["nights_available"] == 4               # 2 rooms x 2 nights
    assert stats["nights_sold"] == 2
    assert stats["occupancy"] == 0.5
    assert stats["revenue_cents"] == 20000              # 2 of the 4 nights
    assert stats["adr_cents"] == 10000
