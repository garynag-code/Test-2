"""The sync engine: pull every channel in, push the ledger back out, fail closed.

Nothing here writes availability to a channel directly.  A reservation lands in
the ledger and the ledger is what every outbound feed is rendered from, so the
platforms cannot disagree about what is sold — there is only ever one answer.

The guard rails matter as much as the sync:

* **Stale feeds close inventory.**  If a channel has gone dark we no longer know
  what it has sold, so those nights stop being sellable and the owner is told.
  An unsold night costs one night's rate; a walked guest costs a relocation, a
  refund and a review that suppresses bookings for a year.
* **High-latency channels get a stop-sell window.**  A platform that re-reads us
  every three hours cannot be trusted with tomorrow's last room, so late
  arrivals are presented as busy to that channel while staying sellable
  directly, over the phone or at the door.
* **We never echo a channel's own bookings back to it.**  A feed rendered for
  Airbnb excludes the reservations Airbnb gave us, or the two calendars would
  amplify each other into a loop of phantom blocks.
"""

from __future__ import annotations

import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import timedelta

from . import icalendar as ics
from .db import writing
from .dates import date_range, fmt, now_in, parse_date, today_in, utc_now, utc_stamp
from .ledger import cancel_booking, close_nights, move_booking, place_booking, reopen_nights

USER_AGENT = "Perch/1.0 (+https://example.invalid/perch)"
FETCH_TIMEOUT = 20
STALE_GRACE = 2          # tolerate two missed refresh cycles before distrusting a feed
CLOSE_HORIZON_DAYS = 90  # how far ahead a dark channel closes inventory


@dataclass
class SyncResult:
    channel_id: int
    status: str = "ok"
    imported: int = 0
    updated: int = 0
    cancelled: int = 0
    conflicts: int = 0
    closed: int = 0
    reopened: int = 0
    detail: str = ""
    conflict_nights: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return dict(
            channel_id=self.channel_id, status=self.status, imported=self.imported,
            updated=self.updated, cancelled=self.cancelled, conflicts=self.conflicts,
            closed=self.closed, reopened=self.reopened, detail=self.detail,
            conflict_nights=self.conflict_nights,
        )


def _channel(conn, channel_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM channel WHERE id = ?", (channel_id,)).fetchone()
    if row is None:
        raise ValueError(f"no channel {channel_id}")
    return row


def _log(conn, channel_id, direction, status, result: SyncResult | None = None,
         detail: str = "") -> None:
    with writing(conn):
        conn.execute(
            "INSERT INTO sync_log (channel_id, direction, status, detail, imported,"
            " cancelled, conflicts, at) VALUES (?,?,?,?,?,?,?,?)",
            (channel_id, direction, status, detail or (result.detail if result else ""),
             result.imported if result else 0,
             result.cancelled if result else 0,
             result.conflicts if result else 0,
             utc_stamp()),
        )


# --------------------------------------------------------------------------
# Inbound
# --------------------------------------------------------------------------

def fetch_feed(url: str, *, timeout: int = FETCH_TIMEOUT) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def import_feed(conn, channel_id: int, text: str, *, reconcile: bool = True,
                today=None) -> SyncResult:
    """Fold a channel's calendar into the ledger.

    This is a full reconciliation, not an incremental patch: every import
    re-reads the channel's complete calendar and diffs it against what we hold.
    Incremental sync accumulates silent drift — a cancellation whose webhook was
    dropped leaves a room blocked for a stay that no longer exists — and a
    nightly full diff is the only thing that reliably catches it.
    """
    channel = _channel(conn, channel_id)
    if channel["room_id"] is None:
        raise ValueError("iCal channels are per-listing and must be bound to a room")

    result = SyncResult(channel_id=channel_id)
    events = ics.parse(text)
    property_id, room_id = channel["property_id"], channel["room_id"]
    # 'Today' is the property's, not the server's, and is injectable so the
    # behaviour around the past/future boundary can be tested deterministically.
    today = fmt(today or today_in(_timezone(conn, property_id)))

    seen: set[str] = set()
    for event in events:
        seen.add(event.uid)
        if fmt(event.end) <= today:
            continue                      # a stay already in the past

        existing = conn.execute(
            "SELECT * FROM booking WHERE channel_id = ? AND external_ref = ?",
            (channel_id, event.uid)).fetchone()

        if existing is None:
            placement = place_booking(
                conn,
                property_id=property_id,
                room_id=room_id,
                channel_id=channel_id,
                external_ref=event.uid,
                guest_name=event.guest_name,
                checkin=event.start,
                checkout=event.end,
                notes=event.description or None,
                kind="block" if event.is_block else "stay",
                # An owner block is inventory taken off sale, not a guest:
                # showing it as "booked" would overstate occupancy to the
                # owner and put a phantom arrival on the day sheet.
                state="closed" if event.is_block else "sold",
                # The far side has already sold this.  We cannot refuse it, so
                # a clash is surfaced to the owner rather than dropped.
                authoritative=True,
                idempotency_key=f"{channel_id}:{event.uid}:{fmt(event.start)}:{fmt(event.end)}",
            )
            if placement.ok:
                result.imported += 1
            else:
                result.conflicts += 1
                result.conflict_nights.extend(placement.clashing_nights)
            continue

        if existing["status"] == "cancelled":
            continue
        if (existing["checkin"], existing["checkout"]) != (fmt(event.start), fmt(event.end)):
            moved = move_booking(conn, existing["id"],
                                 checkin=event.start, checkout=event.end)
            if moved.ok:
                result.updated += 1
            else:
                result.conflicts += 1
                result.conflict_nights.extend(moved.clashing_nights)

    if reconcile:
        stale = conn.execute(
            "SELECT id FROM booking WHERE channel_id = ? AND status = 'confirmed'"
            "  AND external_ref IS NOT NULL AND checkout > ?",
            (channel_id, today)).fetchall()
        for row in stale:
            ref = conn.execute("SELECT external_ref FROM booking WHERE id = ?",
                               (row["id"],)).fetchone()["external_ref"]
            if ref not in seen:
                # Gone from the channel's own calendar: the guest cancelled and
                # we either missed or never received the notification.
                if cancel_booking(conn, row["id"], reason="withdrawn from channel feed"):
                    result.cancelled += 1

    result.detail = (f"{result.imported} new, {result.updated} changed, "
                     f"{result.cancelled} withdrawn, {result.conflicts} conflicts")
    _mark_healthy(conn, channel_id)
    _log(conn, channel_id, "import", "ok", result)
    return result


def sync_channel(conn, channel_id: int, *, today=None) -> SyncResult:
    """Fetch a channel's feed and import it, failing closed if we cannot."""
    channel = _channel(conn, channel_id)
    if not channel["import_url"]:
        result = SyncResult(channel_id=channel_id, status="skipped",
                            detail="no import URL configured")
        _log(conn, channel_id, "import", "ok", result)
        return result
    try:
        text = fetch_feed(channel["import_url"])
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as exc:
        detail = f"{type(exc).__name__}: {exc}"
        _mark_unhealthy(conn, channel_id, "error", detail)
        result = SyncResult(channel_id=channel_id, status="error", detail=detail)
        _log(conn, channel_id, "import", "error", result)
        return result
    return import_feed(conn, channel_id, text, today=today)


def sync_all(conn, property_id: int) -> list[SyncResult]:
    rows = conn.execute(
        "SELECT id FROM channel WHERE property_id = ? AND enabled = 1"
        "  AND tier = 'ical' AND import_url IS NOT NULL", (property_id,)).fetchall()
    return [sync_channel(conn, row["id"]) for row in rows]


def receive_reservation(conn, channel_id: int, payload: dict) -> dict:
    """The paid tier's inbound path: a reservation pushed to us by webhook.

    Channels retry deliveries aggressively, so the caller's reference is used as
    an idempotency key — a replay returns the original booking instead of
    selling the room a second time.
    """
    channel = _channel(conn, channel_id)
    room_id = payload.get("room_id") or channel["room_id"]
    if not room_id:
        raise ValueError("reservation does not identify a room")

    reference = str(payload.get("reference") or payload.get("uid") or "")
    if not reference:
        raise ValueError("reservation has no reference to deduplicate on")

    action = (payload.get("action") or "book").lower()
    if action in ("cancel", "cancelled", "canceled"):
        existing = conn.execute(
            "SELECT id FROM booking WHERE channel_id = ? AND external_ref = ?",
            (channel_id, reference)).fetchone()
        if existing and cancel_booking(conn, existing["id"], reason="cancelled by channel"):
            _mark_healthy(conn, channel_id)
            return {"ok": True, "action": "cancelled", "booking_id": existing["id"]}
        return {"ok": True, "action": "noop", "detail": "nothing to cancel"}

    placement = place_booking(
        conn,
        property_id=channel["property_id"],
        room_id=int(room_id),
        channel_id=channel_id,
        external_ref=reference,
        guest_name=payload.get("guest_name"),
        guest_email=payload.get("guest_email"),
        guest_phone=payload.get("guest_phone"),
        guests=int(payload.get("guests") or 1),
        checkin=payload["checkin"],
        checkout=payload["checkout"],
        amount_cents=payload.get("amount_cents"),
        currency=payload.get("currency"),
        notes=payload.get("notes"),
        authoritative=True,
        idempotency_key=f"{channel_id}:{reference}",
    )
    _mark_healthy(conn, channel_id)
    return {
        "ok": placement.ok,
        "action": "replayed" if placement.replayed else "booked",
        "booking_id": placement.booking_id,
        "conflict_id": placement.conflict_id,
        "clashing_nights": placement.clashing_nights,
    }


# --------------------------------------------------------------------------
# Outbound
# --------------------------------------------------------------------------

def export_events(conn, channel_id: int, *, days: int = 540, now=None) -> list[ics.Event]:
    """Render what this channel should see as busy.

    Three things are blocked: nights the ledger says are occupied, nights inside
    this channel's stop-sell window, and — when the owner asks for it — the
    property's last open room.  The last two are deliberately *not* written to
    the ledger: the owner can still sell those nights on the phone or at the
    door, they are simply withheld from a platform that cannot keep up.
    """
    channel = _channel(conn, channel_id)
    property_id, room_id = channel["property_id"], channel["room_id"]
    if room_id is None:
        raise ValueError("iCal export is per-listing and needs a room binding")

    prop = conn.execute("SELECT * FROM property WHERE id = ?", (property_id,)).fetchone()
    moment = now or now_in(prop["timezone"])
    start = moment.date()
    end = start + timedelta(days=days)

    busy: dict[str, str] = {}

    rows = conn.execute(
        "SELECT rn.night, rn.state, rn.reason, b.channel_id AS booking_channel,"
        "       b.guest_name, b.kind"
        " FROM room_night rn LEFT JOIN booking b ON b.id = rn.booking_id"
        " WHERE rn.room_id = ? AND rn.night >= ? AND rn.night < ?",
        (room_id, fmt(start), fmt(end)))
    for row in rows:
        # Never echo a channel's own reservations back to it.
        if row["booking_channel"] == channel_id:
            continue
        busy[row["night"]] = "Booked" if row["state"] == "sold" else "Not available"

    for night in _stop_sell_nights(channel, moment, end):
        busy.setdefault(night, "Not available")

    if prop["hold_last_room"]:
        for night in _last_room_nights(conn, property_id, room_id, start, end):
            busy.setdefault(night, "Not available")

    return _to_events(busy, channel)


def _stop_sell_nights(channel, moment, end) -> list[str]:
    """Nights too close to arrival to trust a slow channel with."""
    hours = channel["stop_sell_hours"] or 0
    if hours <= 0:
        return []
    horizon = (moment + timedelta(hours=hours)).date()
    if horizon > end:
        horizon = end
    return [fmt(night) for night in date_range(moment.date(), horizon + timedelta(days=1))]


def _last_room_nights(conn, property_id, room_id, start, end) -> list[str]:
    """Nights on which *this* room is the property's only remaining open one.

    Skipped for single-room properties, where holding the last room back would
    simply mean never selling anything.
    """
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM room WHERE property_id = ? AND active = 1",
        (property_id,)).fetchone()["n"]
    if total < 2:
        return []

    rows = conn.execute(
        "SELECT nights.night AS night, COUNT(rn.room_id) AS taken"
        " FROM (SELECT DISTINCT night FROM room_night"
        "        WHERE night >= ? AND night < ?) nights"
        " LEFT JOIN room_night rn ON rn.night = nights.night"
        "      AND rn.room_id IN (SELECT id FROM room WHERE property_id = ? AND active = 1)"
        " WHERE NOT EXISTS (SELECT 1 FROM room_night mine"
        "                    WHERE mine.room_id = ? AND mine.night = nights.night)"
        " GROUP BY nights.night",
        (fmt(start), fmt(end), property_id, room_id))
    return [row["night"] for row in rows if total - row["taken"] <= 1]


def _to_events(busy: dict[str, str], channel) -> list[ics.Event]:
    """Collapse per-night blocks into the fewest possible all-day events."""
    events: list[ics.Event] = []
    for night in sorted(busy):
        label = busy[night]
        day = parse_date(night)
        if events and events[-1].summary == label and fmt(events[-1].end) == night:
            events[-1].end = day + timedelta(days=1)
            continue
        events.append(ics.Event(
            uid=f"perch-{channel['id']}-{night}@perch",
            start=day,
            end=day + timedelta(days=1),
            summary=label,
        ))
    for event in events:                    # stable UID over the merged span
        event.uid = f"perch-{channel['id']}-{fmt(event.start)}-{fmt(event.end)}@perch"
    return events


def export_feed(conn, channel_id: int, **kwargs) -> str:
    channel = _channel(conn, channel_id)
    room = conn.execute("SELECT name FROM room WHERE id = ?",
                        (channel["room_id"],)).fetchone()
    events = export_events(conn, channel_id, **kwargs)
    label = f"{room['name']} — {channel['name']}" if room else channel["name"]
    return ics.write(events, name=label)


# --------------------------------------------------------------------------
# Health and the fail-closed guard
# --------------------------------------------------------------------------

def _timezone(conn, property_id: int) -> str:
    row = conn.execute("SELECT timezone FROM property WHERE id = ?",
                       (property_id,)).fetchone()
    return row["timezone"] if row else "UTC"


def _mark_healthy(conn, channel_id: int) -> None:
    with writing(conn):
        conn.execute(
            "UPDATE channel SET status = 'ok', status_detail = NULL, last_success_at = ?"
            " WHERE id = ?", (utc_stamp(), channel_id))


def _mark_unhealthy(conn, channel_id: int, status: str, detail: str) -> None:
    with writing(conn):
        conn.execute("UPDATE channel SET status = ?, status_detail = ? WHERE id = ?",
                     (status, detail[:500], channel_id))


def channel_health(conn, channel_id: int, *, now=None) -> dict:
    """Is this feed still telling us the truth?"""
    channel = _channel(conn, channel_id)
    moment = now or utc_now()
    last = channel["last_success_at"]
    verified = last is not None

    minutes_since = None
    if verified:
        from datetime import datetime
        try:
            seen = datetime.fromisoformat(last)
            if seen.tzinfo is None:
                seen = seen.replace(tzinfo=moment.tzinfo)
            minutes_since = (moment - seen).total_seconds() / 60
        except ValueError:
            minutes_since = None

    tolerance = (channel["refresh_minutes"] or 60) * STALE_GRACE
    stale = bool(verified and minutes_since is not None and minutes_since > tolerance)
    return {
        "channel_id": channel_id,
        "verified": verified,
        "stale": stale,
        "errored": channel["status"] == "error",
        "minutes_since_success": None if minutes_since is None else round(minutes_since),
        "tolerance_minutes": tolerance,
        # A channel we have never successfully read may already hold
        # reservations we have never seen.  We do not close the whole calendar
        # on setup over that — it would make the first run unusable — but the
        # owner is told loudly until the first successful read.
        "needs_attention": (not verified) or stale or channel["status"] == "error",
    }


def enforce_guards(conn, property_id: int, *, now=None,
                   horizon_days: int = CLOSE_HORIZON_DAYS) -> list[SyncResult]:
    """Close inventory behind any channel we have stopped trusting, reopen behind
    any that has recovered.

    Only channels that once worked and have since gone dark close inventory:
    they made us a promise about what they would tell us, and they have stopped
    keeping it.  Nights already sold are untouched — closing inventory must
    never overwrite a real reservation.
    """
    prop = conn.execute("SELECT * FROM property WHERE id = ?", (property_id,)).fetchone()
    moment = now or now_in(prop["timezone"])
    start = moment.date()
    window = [fmt(night) for night in date_range(start, start + timedelta(days=horizon_days))]

    results: list[SyncResult] = []
    channels = conn.execute(
        "SELECT * FROM channel WHERE property_id = ? AND enabled = 1", (property_id,))

    for channel in channels:
        health = channel_health(conn, channel["id"], now=utc_now())
        reason = f"channel_dark:{channel['id']}"
        result = SyncResult(channel_id=channel["id"])

        if (health["stale"] or health["errored"]) and channel["room_id"] is not None:
            result.closed = close_nights(conn, channel["room_id"], window,
                                         reason=reason, channel_id=channel["id"])
            result.status = "closed"
            result.detail = (f"{channel['name']} has not been read successfully for "
                             f"{health['minutes_since_success']} min — "
                             f"{result.closed} night(s) taken off sale")
            _mark_unhealthy(conn, channel["id"], "stale", result.detail)
            _log(conn, channel["id"], "guard", "error", result)
        else:
            result.reopened = reopen_nights(conn, reason=reason)
            if result.reopened:
                result.status = "reopened"
                result.detail = f"{channel['name']} healthy again — {result.reopened} night(s) back on sale"
                _log(conn, channel["id"], "guard", "ok", result)

        if result.closed or result.reopened:
            results.append(result)

    return results


def channel_overview(conn, property_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT c.*, r.name AS room_name FROM channel c"
        " LEFT JOIN room r ON r.id = c.room_id"
        " WHERE c.property_id = ? ORDER BY r.sort_order, c.name", (property_id,))
    overview = []
    for row in rows:
        entry = dict(row)
        entry.pop("inbound_token", None)     # never leak the write credential
        entry["health"] = channel_health(conn, row["id"])
        overview.append(entry)
    return overview
