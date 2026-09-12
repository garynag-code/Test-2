"""The availability ledger — the one place inventory is decided.

Four rules keep it correct:

1. **Serialised writes.**  Every change runs inside ``BEGIN IMMEDIATE``, so two
   reservations arriving at the same instant are ordered, not interleaved.
2. **A storage-level uniqueness guarantee.**  ``room_night``'s primary key is
   ``(room_id, night)``.  A second sale of the same night cannot be written
   even if every check above it were removed.
3. **Idempotency.**  Channels retry deliveries; a replayed reservation returns
   the original booking instead of decrementing inventory a second time.
4. **Fail closed.**  Anything we cannot place is surfaced in the conflict inbox
   rather than dropped, and anything we cannot confirm is closed rather than
   left sellable (see ``bnb.sync``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .db import writing
from .dates import fmt, nights, parse_date, utc_stamp

OCCUPIED = ("sold", "held", "closed")


class LedgerError(Exception):
    """A booking could not be placed."""


@dataclass
class Placement:
    """What happened when we tried to put a stay on the ledger."""

    ok: bool
    booking_id: int | None = None
    conflict_id: int | None = None
    clashing_nights: list[str] = field(default_factory=list)
    incumbent_id: int | None = None
    replayed: bool = False

    def raise_for_status(self) -> "Placement":
        if not self.ok:
            raise LedgerError(
                "room is not available on " + ", ".join(self.clashing_nights)
            )
        return self


def occupied_nights(conn, room_id: int, checkin, checkout,
                    *, exclude_booking_id: int | None = None) -> list:
    """Which of a stay's nights are already taken, and by what.

    ``exclude_booking_id`` ignores a stay's own rows, so a booking can be
    checked against a move target it partly already occupies.
    """
    wanted = [fmt(night) for night in nights(checkin, checkout)]
    placeholders = ",".join("?" * len(wanted))
    sql = (f"SELECT night, state, booking_id, reason FROM room_night"
           f" WHERE room_id = ? AND night IN ({placeholders})")
    params = [room_id, *wanted]
    if exclude_booking_id is not None:
        sql += " AND (booking_id IS NULL OR booking_id != ?)"
        params.append(exclude_booking_id)
    return list(conn.execute(sql + " ORDER BY night", params))


def is_available(conn, room_id: int, checkin, checkout) -> bool:
    return not occupied_nights(conn, room_id, checkin, checkout)


def available_rooms(conn, property_id: int, checkin, checkout) -> list:
    wanted = [fmt(night) for night in nights(checkin, checkout)]
    placeholders = ",".join("?" * len(wanted))
    return list(conn.execute(
        f"SELECT r.* FROM room r WHERE r.property_id = ? AND r.active = 1"
        f" AND NOT EXISTS (SELECT 1 FROM room_night rn WHERE rn.room_id = r.id"
        f"                 AND rn.night IN ({placeholders}))"
        f" ORDER BY r.sort_order, r.name",
        [property_id, *wanted],
    ))


def _replayed(conn, idempotency_key: str | None) -> Placement | None:
    if not idempotency_key:
        return None
    row = conn.execute(
        "SELECT booking_id, outcome FROM idempotency WHERE key = ?",
        (idempotency_key,),
    ).fetchone()
    if row is None:
        return None
    return Placement(
        ok=row["outcome"] == "placed",
        booking_id=row["booking_id"],
        replayed=True,
    )


def place_booking(
    conn,
    *,
    property_id: int,
    room_id: int,
    checkin,
    checkout,
    channel_id: int | None = None,
    external_ref: str | None = None,
    guest_name: str | None = None,
    guest_email: str | None = None,
    guest_phone: str | None = None,
    guests: int = 1,
    amount_cents: int | None = None,
    currency: str | None = None,
    notes: str | None = None,
    kind: str = "stay",
    state: str = "sold",
    idempotency_key: str | None = None,
    authoritative: bool = False,
) -> Placement:
    """Write a stay to the ledger, or explain why we could not.

    ``authoritative`` marks a reservation the far side has *already sold* — an
    inbound OTA booking.  We cannot simply refuse it, because the guest is
    holding a confirmation email, so it is recorded as ``conflicted`` and put
    in the owner's conflict inbox with both stays side by side.  An owner's own
    direct booking is not authoritative: it is rejected outright so they can
    pick another room while the guest is still on the phone.
    """
    replay = _replayed(conn, idempotency_key)
    if replay is not None:
        return replay

    stay_nights = [fmt(night) for night in nights(checkin, checkout)]
    stamp = utc_stamp()

    with writing(conn):
        # Claim the room for the duration of this transaction, so a
        # simultaneous reservation for the same room queues behind us rather
        # than reading "free" at the same moment we do.
        conn.lock_room(room_id)
        clashes = occupied_nights(conn, room_id, checkin, checkout)
        if clashes:
            return _record_conflict(
                conn, property_id=property_id, room_id=room_id, clashes=clashes,
                stamp=stamp, authoritative=authoritative,
                idempotency_key=idempotency_key,
                booking_fields=dict(
                    channel_id=channel_id, external_ref=external_ref,
                    guest_name=guest_name, guest_email=guest_email,
                    guest_phone=guest_phone, guests=guests,
                    checkin=fmt(checkin), checkout=fmt(checkout),
                    amount_cents=amount_cents, currency=currency, notes=notes,
                    kind=kind,
                ),
            )

        booking_id = conn.insert("booking", {
            "property_id": property_id, "room_id": room_id, "channel_id": channel_id,
            "external_ref": external_ref, "guest_name": guest_name,
            "guest_email": guest_email, "guest_phone": guest_phone, "guests": guests,
            "checkin": fmt(checkin), "checkout": fmt(checkout),
            "amount_cents": amount_cents, "currency": currency, "notes": notes,
            "kind": kind, "status": "confirmed",
            "created_at": stamp, "updated_at": stamp,
        })

        try:
            conn.executemany(
                "INSERT INTO room_night (room_id, night, state, booking_id,"
                " channel_id, reason, updated_at) VALUES (?,?,?,?,?,?,?)",
                [(room_id, night, state, booking_id, channel_id, None, stamp)
                 for night in stay_nights],
            )
        except conn.IntegrityError:
            # Belt and braces: another writer committed between our check and
            # our insert.  The primary key caught it; nothing is sold twice.
            raise LedgerError(
                "lost a race for this room-night; retry the reservation"
            )

        if idempotency_key:
            conn.insert("idempotency", {
                "key": idempotency_key, "booking_id": booking_id,
                "outcome": "placed", "created_at": stamp,
            }, returning=None)

    return Placement(ok=True, booking_id=booking_id)


def _record_conflict(conn, *, property_id, room_id, clashes, stamp,
                     authoritative, idempotency_key, booking_fields) -> Placement:
    """Called inside an open transaction when nights are already taken."""
    clashing = [row["night"] for row in clashes]
    incumbent_id = next((row["booking_id"] for row in clashes if row["booking_id"]), None)

    challenger_id = None
    conflict_id = None

    if authoritative:
        challenger_id = conn.insert("booking", {
            "property_id": property_id, "room_id": room_id,
            "channel_id": booking_fields["channel_id"],
            "external_ref": booking_fields["external_ref"],
            "guest_name": booking_fields["guest_name"],
            "guest_email": booking_fields["guest_email"],
            "guest_phone": booking_fields["guest_phone"],
            "guests": booking_fields["guests"],
            "checkin": booking_fields["checkin"],
            "checkout": booking_fields["checkout"],
            "amount_cents": booking_fields["amount_cents"],
            "currency": booking_fields["currency"],
            "notes": booking_fields["notes"],
            "kind": booking_fields["kind"], "status": "conflicted",
            "created_at": stamp, "updated_at": stamp,
        })

        conflict_id = conn.insert("conflict", {
            "property_id": property_id, "room_id": room_id,
            "incumbent_id": incumbent_id, "challenger_id": challenger_id,
            "nights": ",".join(clashing), "detected_at": stamp,
        })

    if idempotency_key:
        conn.upsert("idempotency", {
            "key": idempotency_key, "booking_id": challenger_id,
            "outcome": "conflicted", "created_at": stamp,
        }, key="key")

    return Placement(
        ok=False,
        booking_id=challenger_id,
        conflict_id=conflict_id,
        clashing_nights=clashing,
        incumbent_id=incumbent_id,
    )


def cancel_booking(conn, booking_id: int, *, reason: str | None = None) -> bool:
    """Release a stay's nights back to open inventory."""
    with writing(conn):
        row = conn.execute(
            "SELECT status FROM booking WHERE id = ?", (booking_id,)
        ).fetchone()
        if row is None or row["status"] == "cancelled":
            return False
        conn.execute("DELETE FROM room_night WHERE booking_id = ?", (booking_id,))
        conn.execute(
            "UPDATE booking SET status = 'cancelled', notes = COALESCE(notes || ' | ', '')"
            " || ?, updated_at = ? WHERE id = ?",
            (reason or "cancelled", utc_stamp(), booking_id),
        )
    return True


def move_booking(conn, booking_id: int, *, room_id: int | None = None,
                 checkin=None, checkout=None) -> Placement:
    """Relocate a stay — the usual way an owner resolves a conflict.

    Availability is checked first, then the old nights are released and the new
    ones claimed in one transaction, so the room is never briefly open to
    another channel mid-move.
    """
    row = conn.execute("SELECT * FROM booking WHERE id = ?", (booking_id,)).fetchone()
    if row is None:
        raise LedgerError(f"no booking {booking_id}")

    target_room = room_id or row["room_id"]
    target_in = fmt(checkin or row["checkin"])
    target_out = fmt(checkout or row["checkout"])
    stay_nights = [fmt(night) for night in nights(target_in, target_out)]
    stamp = utc_stamp()

    with writing(conn):
        conn.lock_room(target_room)
        taken = occupied_nights(conn, target_room, target_in, target_out,
                                exclude_booking_id=booking_id)
        if taken:
            return Placement(
                ok=False,
                booking_id=booking_id,
                clashing_nights=[r["night"] for r in taken],
                incumbent_id=next((r["booking_id"] for r in taken if r["booking_id"]), None),
            )
        conn.execute("DELETE FROM room_night WHERE booking_id = ?", (booking_id,))
        conn.executemany(
            "INSERT INTO room_night (room_id, night, state, booking_id, channel_id,"
            " reason, updated_at) VALUES (?,?,'sold',?,?,NULL,?)",
            [(target_room, night, booking_id, row["channel_id"], stamp)
             for night in stay_nights],
        )
        conn.execute(
            "UPDATE booking SET room_id = ?, checkin = ?, checkout = ?,"
            " status = 'confirmed', updated_at = ? WHERE id = ?",
            (target_room, target_in, target_out, stamp, booking_id),
        )

    return Placement(ok=True, booking_id=booking_id)


def close_nights(conn, room_id: int, dates: list, *, reason: str,
                 channel_id: int | None = None) -> int:
    """Take nights off sale without a guest attached (the fail-closed path).

    Nights already sold are left alone — closing inventory must never quietly
    overwrite a real reservation.
    """
    stamp = utc_stamp()
    wanted = [fmt(night) for night in dates]
    with writing(conn):
        conn.lock_room(room_id)
        closed = conn.insert_ignore_many(
            "room_night",
            ["room_id", "night", "state", "booking_id", "channel_id", "reason",
             "updated_at"],
            [(room_id, night, "closed", None, channel_id, reason, stamp)
             for night in wanted],
        )
    return closed


def reopen_nights(conn, *, reason: str, room_id: int | None = None) -> int:
    """Undo fail-closed closures once a channel is healthy again."""
    with writing(conn):
        if room_id is None:
            cur = conn.execute(
                "DELETE FROM room_night WHERE state = 'closed' AND booking_id IS NULL"
                " AND reason = ?", (reason,))
        else:
            cur = conn.execute(
                "DELETE FROM room_night WHERE state = 'closed' AND booking_id IS NULL"
                " AND reason = ? AND room_id = ?", (reason, room_id))
        return cur.rowcount or 0


def calendar(conn, property_id: int, start, end) -> dict:
    """The grid the owner lives in: every room, every night, in one read."""
    start, end = fmt(start), fmt(end)
    rooms = list(conn.execute(
        "SELECT * FROM room WHERE property_id = ? AND active = 1"
        " ORDER BY sort_order, name", (property_id,)))
    cells = list(conn.execute(
        "SELECT rn.room_id, rn.night, rn.state, rn.booking_id, rn.reason,"
        "       b.guest_name, b.checkin, b.checkout, b.kind, c.name AS channel_name,"
        "       c.kind AS channel_kind"
        " FROM room_night rn"
        " LEFT JOIN booking b ON b.id = rn.booking_id"
        " LEFT JOIN channel c ON c.id = COALESCE(b.channel_id, rn.channel_id)"
        " WHERE rn.night >= ? AND rn.night < ?"
        "   AND rn.room_id IN (SELECT id FROM room WHERE property_id = ?)"
        " ORDER BY rn.room_id, rn.night",
        (start, end, property_id)))

    by_room: dict[int, dict[str, dict]] = {room["id"]: {} for room in rooms}
    for cell in cells:
        by_room.setdefault(cell["room_id"], {})[cell["night"]] = {
            "state": cell["state"],
            "booking_id": cell["booking_id"],
            "guest": cell["guest_name"],
            "channel": cell["channel_name"],
            "channel_kind": cell["channel_kind"],
            "reason": cell["reason"],
            "arrival": cell["checkin"] == cell["night"],
            "departure_next": cell["checkout"] == cell["night"],
            "kind": cell["kind"],
        }
    return {"rooms": [dict(room) for room in rooms], "nights": by_room}


def agenda(conn, property_id: int, start, end) -> list[dict]:
    """The same information as a flat, screen-reader-friendly list.

    A dense date grid is genuinely hostile to assistive technology and to a
    five-inch phone, so the agenda is a first-class view, not a fallback.
    """
    rows = conn.execute(
        "SELECT b.*, r.name AS room_name, c.name AS channel_name, c.kind AS channel_kind"
        " FROM booking b JOIN room r ON r.id = b.room_id"
        " LEFT JOIN channel c ON c.id = b.channel_id"
        " WHERE b.property_id = ? AND b.status != 'cancelled'"
        "   AND b.checkout > ? AND b.checkin < ?"
        " ORDER BY b.checkin, r.sort_order, r.name",
        (property_id, fmt(start), fmt(end)))
    return [dict(row) for row in rows]


def day_sheet(conn, property_id: int, on) -> dict:
    """Arrivals, departures and turnovers for one day — the morning briefing."""
    day = fmt(on)
    arrivals = [dict(r) for r in conn.execute(
        "SELECT b.*, r.name AS room_name, c.name AS channel_name FROM booking b"
        " JOIN room r ON r.id = b.room_id LEFT JOIN channel c ON c.id = b.channel_id"
        " WHERE b.property_id = ? AND b.checkin = ? AND b.status = 'confirmed'"
        "   AND b.kind = 'stay' ORDER BY r.sort_order", (property_id, day))]
    departures = [dict(r) for r in conn.execute(
        "SELECT b.*, r.name AS room_name, c.name AS channel_name FROM booking b"
        " JOIN room r ON r.id = b.room_id LEFT JOIN channel c ON c.id = b.channel_id"
        " WHERE b.property_id = ? AND b.checkout = ? AND b.status = 'confirmed'"
        "   AND b.kind = 'stay' ORDER BY r.sort_order", (property_id, day))]
    staying = [dict(r) for r in conn.execute(
        "SELECT b.*, r.name AS room_name FROM booking b JOIN room r ON r.id = b.room_id"
        " WHERE b.property_id = ? AND b.checkin < ? AND b.checkout > ?"
        "   AND b.status = 'confirmed' AND b.kind = 'stay' ORDER BY r.sort_order",
        (property_id, day, day))]

    departing_rooms = {row["room_id"] for row in departures}
    arriving_rooms = {row["room_id"] for row in arrivals}
    return {
        "date": day,
        "arrivals": arrivals,
        "departures": departures,
        "staying": staying,
        # A room that empties and refills the same day is the one the cleaner
        # has to reach first.
        "turnovers": sorted(departing_rooms & arriving_rooms),
    }


def occupancy_stats(conn, property_id: int, start, end) -> dict:
    """Occupancy, ADR and RevPAR — enough to show where the money leaks."""
    from .dates import date_range

    window = date_range(start, end)
    room_count = conn.execute(
        "SELECT COUNT(*) AS n FROM room WHERE property_id = ? AND active = 1",
        (property_id,)).fetchone()["n"]
    capacity = room_count * len(window)

    sold = conn.execute(
        "SELECT COUNT(*) AS n FROM room_night rn WHERE rn.state = 'sold'"
        " AND rn.night >= ? AND rn.night < ?"
        " AND rn.room_id IN (SELECT id FROM room WHERE property_id = ?)"
        " AND rn.booking_id IN (SELECT id FROM booking WHERE kind = 'stay')",
        (fmt(start), fmt(end), property_id)).fetchone()["n"]

    revenue_rows = conn.execute(
        "SELECT b.amount_cents, b.checkin, b.checkout FROM booking b"
        " WHERE b.property_id = ? AND b.status = 'confirmed' AND b.kind = 'stay'"
        "   AND b.checkout > ? AND b.checkin < ? AND b.amount_cents IS NOT NULL",
        (property_id, fmt(start), fmt(end)))

    window_set = {fmt(day) for day in window}
    revenue = 0
    for row in revenue_rows:
        stay = [fmt(night) for night in nights(row["checkin"], row["checkout"])]
        if not stay:
            continue
        in_window = sum(1 for night in stay if night in window_set)
        revenue += round(row["amount_cents"] * in_window / len(stay))

    by_channel = [dict(r) for r in conn.execute(
        "SELECT COALESCE(c.name, 'Direct') AS channel,"
        "       COUNT(*) AS bookings, COALESCE(SUM(b.amount_cents), 0) AS revenue_cents"
        " FROM booking b LEFT JOIN channel c ON c.id = b.channel_id"
        " WHERE b.property_id = ? AND b.status = 'confirmed' AND b.kind = 'stay'"
        "   AND b.checkout > ? AND b.checkin < ?"
        " GROUP BY channel ORDER BY revenue_cents DESC",
        (property_id, fmt(start), fmt(end)))]

    return {
        "nights_available": capacity,
        "nights_sold": sold,
        "occupancy": round(sold / capacity, 4) if capacity else 0.0,
        "revenue_cents": revenue,
        "adr_cents": round(revenue / sold) if sold else 0,
        "revpar_cents": round(revenue / capacity) if capacity else 0,
        "by_channel": by_channel,
    }


def open_conflicts(conn, property_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT cf.*, r.name AS room_name,"
        "       inc.guest_name AS incumbent_guest, inc.checkin AS incumbent_checkin,"
        "       inc.checkout AS incumbent_checkout, inc_c.name AS incumbent_channel,"
        "       chal.guest_name AS challenger_guest, chal.checkin AS challenger_checkin,"
        "       chal.checkout AS challenger_checkout, chal_c.name AS challenger_channel"
        " FROM conflict cf JOIN room r ON r.id = cf.room_id"
        " LEFT JOIN booking inc ON inc.id = cf.incumbent_id"
        " LEFT JOIN channel inc_c ON inc_c.id = inc.channel_id"
        " LEFT JOIN booking chal ON chal.id = cf.challenger_id"
        " LEFT JOIN channel chal_c ON chal_c.id = chal.channel_id"
        " WHERE cf.property_id = ? AND cf.resolved_at IS NULL"
        " ORDER BY cf.detected_at DESC", (property_id,))
    return [dict(row) for row in rows]


def resolve_conflict(conn, conflict_id: int, resolution: str) -> bool:
    with writing(conn):
        cur = conn.execute(
            "UPDATE conflict SET resolved_at = ?, resolution = ?"
            " WHERE id = ? AND resolved_at IS NULL",
            (utc_stamp(), resolution, conflict_id))
        return (cur.rowcount or 0) > 0
