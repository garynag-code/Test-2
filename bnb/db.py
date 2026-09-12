"""Opening the ledger, and the write transaction every change goes through.

The schema itself lives in ``bnb.sql``, which renders it for whichever backend
is in use: a single SQLite file on the owner's own machine, or PostgreSQL
(Supabase) when Perch is hosted so the owner can reach it from their phone.

Both are the same product.  In particular the ``(room_id, night)`` primary key
that makes a double booking unrepresentable is identical on both — see
``bnb.sql.SCHEMA``.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from .dates import utc_stamp
from .sql import POSTGRES, SQLITE, Database, connect, describe, dialect_of, schema_for

__all__ = [
    "Database", "POSTGRES", "SQLITE", "connect", "describe", "dialect_of",
    "default_url", "init_db", "open_db", "writing",
    "create_property", "create_room", "create_channel",
]


def default_url() -> str:
    """Where the ledger lives unless told otherwise.

    ``DATABASE_URL`` is what every host sets, and it is what Supabase gives you
    to copy; falling back to a local file keeps the double-click launchers
    working with no configuration at all.
    """
    return os.environ.get("DATABASE_URL") or os.environ.get("PERCH_DB") or "perch.db"


def init_db(db: Database) -> Database:
    db.executescript(schema_for(db.dialect))
    return db


def open_db(url: str | Path | None = None) -> Database:
    return init_db(connect(url or default_url()))


class writing:
    """Context manager for a serialised write transaction.

    Every availability change goes through here.  On SQLite ``BEGIN IMMEDIATE``
    takes the write lock up front, so two concurrent reservations are ordered
    rather than interleaved.  On PostgreSQL the same guarantee comes from an
    advisory lock taken per room inside the transaction (``Database.lock_room``)
    plus, underneath both, the ledger's primary key.
    """

    def __init__(self, db: Database):
        self.db = db

    def __enter__(self) -> Database:
        self.db.begin()
        return self.db

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is None:
            self.db.commit_tx()
        else:
            self.db.rollback_tx()
        return False


def create_property(db, name, *, timezone="UTC", currency="EUR", locale="en",
                    hold_last_room=False, owner_id=None) -> int:
    return db.insert("property", {
        "owner_id": owner_id,
        "name": name,
        "timezone": timezone,
        "currency": currency,
        "locale": locale,
        "hold_last_room": 1 if hold_last_room else 0,
        "created_at": utc_stamp(),
    })


def create_room(db, property_id, name, *, capacity=2, base_rate_cents=9000,
                sort_order=0) -> int:
    return db.insert("room", {
        "property_id": property_id,
        "name": name,
        "capacity": capacity,
        "base_rate_cents": base_rate_cents,
        "sort_order": sort_order,
    })


def create_channel(db, property_id, kind, name, *, room_id=None, tier="ical",
                   import_url=None, refresh_minutes=60, stop_sell_hours=0) -> int:
    return db.insert("channel", {
        "property_id": property_id,
        "room_id": room_id,
        "kind": kind,
        "name": name,
        "tier": tier,
        "import_url": import_url,
        "export_token": secrets.token_urlsafe(18),
        "inbound_token": secrets.token_urlsafe(18),
        "refresh_minutes": refresh_minutes,
        "stop_sell_hours": stop_sell_hours,
        "status": "pending",
    })
