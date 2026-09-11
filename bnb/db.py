"""SQLite schema and connection handling for the availability ledger.

SQLite is deliberate, not a placeholder.  A small B&B has four to twelve rooms
and a few hundred reservations a year; the entire dataset fits in a few
megabytes, and a single-writer database with serialised transactions is
*exactly* the concurrency model that makes double booking impossible to
express.  The same code runs unchanged against Postgres when a property
outgrows it — the invariants live in constraints, not in application code.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from .dates import utc_stamp

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS property (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    timezone        TEXT    NOT NULL DEFAULT 'UTC',
    currency        TEXT    NOT NULL DEFAULT 'EUR',
    locale          TEXT    NOT NULL DEFAULT 'en',
    -- Hold the final open room back from the OTAs on any given night.  An
    -- unsold night costs one night's rate; a walked guest costs a relocation,
    -- a refund and a one-star review.
    hold_last_room  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS room (
    id              INTEGER PRIMARY KEY,
    property_id     INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    capacity        INTEGER NOT NULL DEFAULT 2,
    base_rate_cents INTEGER NOT NULL DEFAULT 9000,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    UNIQUE (property_id, name)
);

CREATE TABLE IF NOT EXISTS channel (
    id              INTEGER PRIMARY KEY,
    property_id     INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
    room_id         INTEGER REFERENCES room(id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL,   -- airbnb | booking_com | vrbo | direct | other
    name            TEXT    NOT NULL,
    -- 'ical' is the free tier: no partnership needed, but the far side may
    -- take hours to re-read us.  'api' is the paid tier: webhooks in seconds.
    tier            TEXT    NOT NULL DEFAULT 'ical' CHECK (tier IN ('ical', 'api')),
    import_url      TEXT,
    export_token    TEXT    UNIQUE,
    inbound_token   TEXT    UNIQUE,
    -- How long we tolerate silence before we stop trusting this feed.
    refresh_minutes INTEGER NOT NULL DEFAULT 60,
    -- Close out arrivals inside this window on high-latency channels; the far
    -- side cannot learn about a sale fast enough to be trusted with it.
    stop_sell_hours INTEGER NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'pending',  -- ok | stale | error | pending
    status_detail   TEXT,
    last_success_at TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS booking (
    id              INTEGER PRIMARY KEY,
    property_id     INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
    room_id         INTEGER NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    channel_id      INTEGER REFERENCES channel(id) ON DELETE SET NULL,
    external_ref    TEXT,               -- the channel's own UID for this stay
    guest_name      TEXT,
    guest_email     TEXT,
    guest_phone     TEXT,
    guests          INTEGER NOT NULL DEFAULT 1,
    checkin         TEXT    NOT NULL,   -- local calendar date
    checkout        TEXT    NOT NULL,   -- local calendar date, exclusive
    amount_cents    INTEGER,
    currency        TEXT,
    notes           TEXT,
    kind            TEXT    NOT NULL DEFAULT 'stay' CHECK (kind IN ('stay', 'block')),
    status          TEXT    NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'cancelled', 'conflicted')),
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    CHECK (checkout > checkin)
);

-- A channel may deliver the same reservation more than once; a retried
-- webhook must not sell the room twice.
CREATE UNIQUE INDEX IF NOT EXISTS booking_external_ref
    ON booking (channel_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS booking_stay ON booking (property_id, checkin, checkout);

-- ---------------------------------------------------------------------------
-- The ledger.  One row per *occupied* room-night; the absence of a row means
-- the night is open.  The primary key is the entire double-booking defence:
-- two reservations for the same room-night cannot both exist, so the second
-- write fails at the storage layer rather than relying on application code
-- remembering to check.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_night (
    room_id     INTEGER NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    night       TEXT    NOT NULL,
    state       TEXT    NOT NULL CHECK (state IN ('sold', 'held', 'closed')),
    booking_id  INTEGER REFERENCES booking(id) ON DELETE CASCADE,
    channel_id  INTEGER REFERENCES channel(id) ON DELETE SET NULL,
    reason      TEXT,
    updated_at  TEXT    NOT NULL,
    PRIMARY KEY (room_id, night)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS room_night_by_night ON room_night (night);

CREATE TABLE IF NOT EXISTS conflict (
    id              INTEGER PRIMARY KEY,
    property_id     INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
    room_id         INTEGER NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    incumbent_id    INTEGER REFERENCES booking(id) ON DELETE CASCADE,
    challenger_id   INTEGER REFERENCES booking(id) ON DELETE CASCADE,
    nights          TEXT    NOT NULL,   -- comma-separated dates
    detected_at     TEXT    NOT NULL,
    resolved_at     TEXT,
    resolution      TEXT
);

-- Replay protection for anything that arrives over the wire.
CREATE TABLE IF NOT EXISTS idempotency (
    key         TEXT PRIMARY KEY,
    booking_id  INTEGER REFERENCES booking(id) ON DELETE CASCADE,
    outcome     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY,
    channel_id  INTEGER REFERENCES channel(id) ON DELETE CASCADE,
    direction   TEXT    NOT NULL,       -- import | export | guard
    status      TEXT    NOT NULL,       -- ok | error
    detail      TEXT,
    imported    INTEGER NOT NULL DEFAULT 0,
    cancelled   INTEGER NOT NULL DEFAULT 0,
    conflicts   INTEGER NOT NULL DEFAULT 0,
    at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_log_recent ON sync_log (at DESC);
"""


def connect(path: str | Path = "perch.db") -> sqlite3.Connection:
    """Open the ledger.

    ``isolation_level=None`` hands transaction control to us so that every
    write can open with ``BEGIN IMMEDIATE`` — the write lock is taken up front
    instead of being upgraded mid-transaction, which is what turns a race
    between two simultaneous reservations into a clean, ordered queue.
    """
    conn = sqlite3.connect(str(path), isolation_level=None, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except sqlite3.DatabaseError:      # :memory: and some network filesystems
        pass
    return conn


def init_db(conn: sqlite3.Connection) -> sqlite3.Connection:
    conn.executescript(SCHEMA)
    return conn


def open_db(path: str | Path = "perch.db") -> sqlite3.Connection:
    return init_db(connect(path))


class writing:
    """Context manager for a serialised write transaction.

    Every availability change goes through here.  ``BEGIN IMMEDIATE`` means
    two concurrent reservations for the same night are ordered rather than
    interleaved: the first commits, the second sees the committed row and is
    rejected by the ledger's primary key.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self) -> sqlite3.Connection:
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is None:
            self.conn.execute("COMMIT")
        else:
            self.conn.execute("ROLLBACK")
        return False


def create_property(conn, name, *, timezone="UTC", currency="EUR", locale="en",
                    hold_last_room=False) -> int:
    cur = conn.execute(
        "INSERT INTO property (name, timezone, currency, locale, hold_last_room, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (name, timezone, currency, locale, 1 if hold_last_room else 0, utc_stamp()),
    )
    return int(cur.lastrowid)


def create_room(conn, property_id, name, *, capacity=2, base_rate_cents=9000,
                sort_order=0) -> int:
    cur = conn.execute(
        "INSERT INTO room (property_id, name, capacity, base_rate_cents, sort_order)"
        " VALUES (?, ?, ?, ?, ?)",
        (property_id, name, capacity, base_rate_cents, sort_order),
    )
    return int(cur.lastrowid)


def create_channel(conn, property_id, kind, name, *, room_id=None, tier="ical",
                   import_url=None, refresh_minutes=60, stop_sell_hours=0) -> int:
    import secrets

    cur = conn.execute(
        "INSERT INTO channel (property_id, room_id, kind, name, tier, import_url,"
        " export_token, inbound_token, refresh_minutes, stop_sell_hours, status)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
        (property_id, room_id, kind, name, tier, import_url,
         secrets.token_urlsafe(18), secrets.token_urlsafe(18),
         refresh_minutes, stop_sell_hours),
    )
    return int(cur.lastrowid)
