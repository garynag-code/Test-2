"""A demo property, so the app has something to show the first time it runs.

The scenario is the one that sells the product: the same room sold twice,
once on Airbnb and once on Booking.com, caught before the guest arrives.
"""

from __future__ import annotations

import os
from datetime import date, timedelta

from . import icalendar as ics
from .db import (create_channel, create_property, create_room, default_url,
                 dialect_of, open_db)
from .dates import fmt
from .ledger import place_booking
from .sync import import_feed

DEMO_PROPERTY = "Rose Cottage B&B"


def seed_demo(db_url: str | None = None, *, today: date | None = None,
              force: bool = False, owner_id: str | None = None) -> dict:
    """Create the sample property if the database has none."""
    db_url = db_url or default_url()
    fresh = force or (dialect_of(db_url) == "sqlite" and not os.path.exists(db_url))
    conn = open_db(db_url)

    existing = conn.execute("SELECT id FROM property ORDER BY id LIMIT 1").fetchone()
    if existing and not force:
        return {"property_id": existing["id"], "seeded": False}

    today = today or date.today()
    prop = create_property(conn, DEMO_PROPERTY, timezone="Europe/Dublin",
                           currency="EUR", locale="en", hold_last_room=True,
                           owner_id=owner_id)

    rooms = {
        "Garden Room": create_room(conn, prop, "Garden Room", capacity=2,
                                   base_rate_cents=11000, sort_order=1),
        "Attic Room": create_room(conn, prop, "Attic Room", capacity=2,
                                  base_rate_cents=9500, sort_order=2),
        "Stable Loft": create_room(conn, prop, "Stable Loft", capacity=4,
                                   base_rate_cents=14500, sort_order=3),
    }

    channels = {}
    for room_name, room_id in rooms.items():
        channels[f"airbnb:{room_name}"] = create_channel(
            conn, prop, "airbnb", f"Airbnb — {room_name}", room_id=room_id,
            # Airbnb re-reads a subscribed feed every couple of hours, so a
            # same-day arrival is not safe to leave on sale there.
            refresh_minutes=180, stop_sell_hours=24)
        channels[f"booking:{room_name}"] = create_channel(
            conn, prop, "booking_com", f"Booking.com — {room_name}", room_id=room_id,
            refresh_minutes=120, stop_sell_hours=24)

    direct = create_channel(conn, prop, "direct", "Direct — our own site",
                            tier="api", refresh_minutes=5)

    # A few direct bookings the owner took over the phone.
    place_booking(conn, property_id=prop, room_id=rooms["Attic Room"],
                  channel_id=direct, guest_name="Maria Oyelaran",
                  guest_email="maria@example.invalid", guests=2,
                  checkin=fmt(today + timedelta(days=3)),
                  checkout=fmt(today + timedelta(days=6)),
                  amount_cents=28500, currency="EUR",
                  notes="Gluten-free breakfast. Arriving late, around 22:00.")
    place_booking(conn, property_id=prop, room_id=rooms["Stable Loft"],
                  channel_id=direct, guest_name="The Okonkwo family", guests=4,
                  checkin=fmt(today + timedelta(days=1)),
                  checkout=fmt(today + timedelta(days=4)),
                  amount_cents=43500, currency="EUR",
                  notes="Travel cot needed.")

    # Airbnb's feed for the Garden Room.
    airbnb_feed = ics.write([
        ics.Event(uid="HMAB3CDEF4@airbnb", summary="Jonas (HMAB3CDEF4)",
                  description="Reservation URL: https://www.airbnb.com/hosting/reservations",
                  start=today + timedelta(days=8), end=today + timedelta(days=11)),
        ics.Event(uid="blocked-1@airbnb", summary="Airbnb (Not available)",
                  start=today + timedelta(days=20), end=today + timedelta(days=22)),
    ])
    import_feed(conn, channels["airbnb:Garden Room"], airbnb_feed)

    # ...and Booking.com's, which has sold the same room over the same nights.
    # This is the moment the product exists for.
    booking_feed = ics.write([
        ics.Event(uid="4415762118@booking.com", summary="Élodie Marchand",
                  start=today + timedelta(days=9), end=today + timedelta(days=12)),
    ])
    import_feed(conn, channels["booking:Garden Room"], booking_feed)

    conn.commit()
    conn.close()
    return {"property_id": prop, "seeded": True, "fresh_file": fresh,
            "rooms": rooms, "channels": channels}


if __name__ == "__main__":
    import sys
    print(seed_demo(sys.argv[1] if len(sys.argv) > 1 else None))
