"""HTTP layer: a small JSON API, the outbound iCal feeds, and the inbound hook.

The front end is a plain progressive web app with no build step (see
``bnb/static``), so the whole thing is ``pip install flask`` and run — which is
the point.  A property paying nineteen euro a month cannot be the reason its
software needs a container platform.
"""

from __future__ import annotations

import json
import os
import sqlite3
from functools import wraps

from flask import Flask, g, jsonify, request, send_from_directory

from . import i18n
from .db import open_db
from .dates import fmt, parse_date, today_in, utc_stamp
from .ledger import (
    LedgerError, agenda, available_rooms, calendar, cancel_booking, day_sheet,
    move_booking, occupancy_stats, open_conflicts, place_booking, resolve_conflict,
)
from .sync import (
    channel_overview, enforce_guards, export_feed, import_feed, receive_reservation,
    sync_all, sync_channel,
)

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
DEFAULT_DB = os.environ.get("PERCH_DB", "perch.db")


class NotFound(Exception):
    """A dedicated type rather than LookupError, because KeyError subclasses
    LookupError — using it here turns a missing request field into a 404."""


def create_app(db_path: str | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["DB_PATH"] = db_path or DEFAULT_DB

    # ---------------------------------------------------------------- db

    def db() -> sqlite3.Connection:
        if "db" not in g:
            g.db = open_db(app.config["DB_PATH"])
        return g.db

    @app.teardown_appcontext
    def _close(_exc):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    def current_property() -> sqlite3.Row:
        row = db().execute("SELECT * FROM property ORDER BY id LIMIT 1").fetchone()
        if row is None:
            raise NotFound("no property has been set up yet")
        return row

    def json_error(status: int, message: str, **extra):
        return jsonify({"error": message, **extra}), status

    def api(fn):
        """Turn the handful of expected failures into honest status codes."""
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except NotFound as exc:
                return json_error(404, str(exc))
            except LedgerError as exc:
                return json_error(409, str(exc))
            except KeyError as exc:
                return json_error(400, f"missing field: {exc.args[0]}")
            except (ValueError, TypeError) as exc:
                return json_error(400, str(exc))
        return wrapper

    def window(default_days: int = 30) -> tuple[str, str]:
        prop = current_property()
        start = request.args.get("start") or fmt(today_in(prop["timezone"]))
        end = request.args.get("end")
        if not end:
            from datetime import timedelta
            end = fmt(parse_date(start) + timedelta(days=default_days))
        return fmt(start), fmt(end)

    # -------------------------------------------------------------- pages

    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(STATIC, "manifest.webmanifest",
                                   mimetype="application/manifest+json")

    @app.get("/service-worker.js")
    def service_worker():
        # Served from the root so its scope covers the whole app.
        response = send_from_directory(STATIC, "service-worker.js",
                                       mimetype="text/javascript")
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/static/<path:filename>")
    def static_files(filename):
        return send_from_directory(STATIC, filename)

    # ---------------------------------------------------------------- api

    @app.get("/api/bootstrap")
    @api
    def bootstrap():
        prop = current_property()
        locale = request.args.get("locale") or prop["locale"]
        rooms = [dict(r) for r in db().execute(
            "SELECT * FROM room WHERE property_id = ? AND active = 1"
            " ORDER BY sort_order, name", (prop["id"],))]
        return jsonify({
            "property": dict(prop),
            "rooms": rooms,
            "channels": channel_overview(db(), prop["id"]),
            "today": fmt(today_in(prop["timezone"])),
            "conflicts": len(open_conflicts(db(), prop["id"])),
            "i18n": i18n.bundle(locale),
        })

    @app.get("/api/calendar")
    @api
    def api_calendar():
        start, end = window(30)
        prop = current_property()
        return jsonify({"start": start, "end": end,
                        **calendar(db(), prop["id"], start, end)})

    @app.get("/api/agenda")
    @api
    def api_agenda():
        start, end = window(60)
        prop = current_property()
        return jsonify({"start": start, "end": end,
                        "stays": agenda(db(), prop["id"], start, end)})

    @app.get("/api/day")
    @api
    def api_day():
        prop = current_property()
        on = request.args.get("date") or fmt(today_in(prop["timezone"]))
        return jsonify(day_sheet(db(), prop["id"], on))

    @app.get("/api/insights")
    @api
    def api_insights():
        start, end = window(30)
        prop = current_property()
        return jsonify({"start": start, "end": end, "currency": prop["currency"],
                        **occupancy_stats(db(), prop["id"], start, end)})

    @app.get("/api/availability")
    @api
    def api_availability():
        prop = current_property()
        checkin = request.args["checkin"]
        checkout = request.args["checkout"]
        return jsonify({"rooms": [dict(r) for r in
                                  available_rooms(db(), prop["id"], checkin, checkout)]})

    @app.post("/api/bookings")
    @api
    def api_create_booking():
        prop = current_property()
        payload = request.get_json(silent=True) or {}
        # The offline queue retries; the key makes a retry free.
        key = (request.headers.get("Idempotency-Key")
               or payload.get("idempotency_key"))
        placement = place_booking(
            db(),
            property_id=prop["id"],
            room_id=int(payload["room_id"]),
            checkin=payload["checkin"],
            checkout=payload["checkout"],
            guest_name=payload.get("guest_name"),
            guest_email=payload.get("guest_email"),
            guest_phone=payload.get("guest_phone"),
            guests=int(payload.get("guests") or 1),
            amount_cents=payload.get("amount_cents"),
            currency=payload.get("currency") or prop["currency"],
            notes=payload.get("notes"),
            channel_id=payload.get("channel_id"),
            idempotency_key=key,
            # An owner's own booking is refused on a clash so they can offer
            # the guest another room while still on the phone.
            authoritative=False,
        )
        if not placement.ok:
            return json_error(409, "room is not available",
                              clashing_nights=placement.clashing_nights,
                              incumbent_id=placement.incumbent_id)
        return jsonify({"booking_id": placement.booking_id,
                        "replayed": placement.replayed}), 201

    @app.get("/api/bookings/<int:booking_id>")
    @api
    def api_get_booking(booking_id):
        row = db().execute(
            "SELECT b.*, r.name AS room_name FROM booking b"
            " JOIN room r ON r.id = b.room_id WHERE b.id = ?", (booking_id,)).fetchone()
        if row is None:
            raise NotFound(f"no booking {booking_id}")
        return jsonify(dict(row))

    @app.post("/api/bookings/<int:booking_id>/cancel")
    @api
    def api_cancel_booking(booking_id):
        payload = request.get_json(silent=True) or {}
        done = cancel_booking(db(), booking_id, reason=payload.get("reason"))
        return jsonify({"cancelled": done})

    @app.post("/api/bookings/<int:booking_id>/move")
    @api
    def api_move_booking(booking_id):
        payload = request.get_json(silent=True) or {}
        placement = move_booking(
            db(), booking_id,
            room_id=int(payload["room_id"]) if payload.get("room_id") else None,
            checkin=payload.get("checkin"), checkout=payload.get("checkout"))
        if not placement.ok:
            return json_error(409, "target is not available",
                              clashing_nights=placement.clashing_nights)
        return jsonify({"moved": True, "booking_id": booking_id})

    @app.get("/api/conflicts")
    @api
    def api_conflicts():
        prop = current_property()
        return jsonify({"conflicts": open_conflicts(db(), prop["id"])})

    @app.post("/api/conflicts/<int:conflict_id>/resolve")
    @api
    def api_resolve_conflict(conflict_id):
        payload = request.get_json(silent=True) or {}
        done = resolve_conflict(db(), conflict_id,
                                payload.get("resolution") or "resolved by owner")
        return jsonify({"resolved": done})

    @app.get("/api/channels")
    @api
    def api_channels():
        prop = current_property()
        return jsonify({"channels": channel_overview(db(), prop["id"])})

    @app.post("/api/channels/<int:channel_id>/sync")
    @api
    def api_sync_channel(channel_id):
        payload = request.get_json(silent=True) or {}
        if "ics" in payload:                 # lets the demo run without network
            result = import_feed(db(), channel_id, payload["ics"])
        else:
            result = sync_channel(db(), channel_id)
        return jsonify(result.as_dict())

    @app.post("/api/sync")
    @api
    def api_sync_all():
        prop = current_property()
        results = [r.as_dict() for r in sync_all(db(), prop["id"])]
        guards = [r.as_dict() for r in enforce_guards(db(), prop["id"])]
        return jsonify({"channels": results, "guards": guards})

    @app.post("/api/guards")
    @api
    def api_guards():
        prop = current_property()
        return jsonify({"guards": [r.as_dict() for r in enforce_guards(db(), prop["id"])]})

    # ------------------------------------------------------- channel edges

    @app.get("/ical/<token>.ics")
    def ical_feed(token):
        """What the platforms subscribe to.

        Unguessable per-channel token rather than a login: OTA calendar
        subscribers cannot authenticate, so the URL is the credential. It is
        revoked by rotating the token.
        """
        row = db().execute("SELECT id FROM channel WHERE export_token = ?",
                           (token,)).fetchone()
        if row is None:
            return "not found", 404
        body = export_feed(db(), row["id"])
        return app.response_class(
            body, mimetype="text/calendar; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=perch.ics",
                     "Cache-Control": "no-cache"})

    @app.post("/hooks/<token>")
    @api
    def inbound_hook(token):
        """The paid tier's inbound path — a reservation pushed to us in seconds."""
        row = db().execute("SELECT id FROM channel WHERE inbound_token = ?",
                           (token,)).fetchone()
        if row is None:
            return json_error(404, "unknown channel")
        # force=True because the content type a platform sends is not ours to
        # control, and some send none at all.  The owner-facing API is left
        # strict so a client bug surfaces rather than being papered over.
        payload = request.get_json(silent=True, force=True) or {}
        result = receive_reservation(db(), row["id"], payload)
        # A conflict is still a successful *delivery* — the far side must not
        # retry forever over a clash only the owner can settle.
        return jsonify(result), 200

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True, "at": utc_stamp()})

    return app


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run the Perch booking manager.")
    parser.add_argument("--db", default=DEFAULT_DB, help="path to the ledger database")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--demo", action="store_true",
                        help="seed a sample property and start with data to look at")
    args = parser.parse_args()

    if args.demo:
        from .sample import seed_demo
        seed_demo(args.db)

    create_app(args.db).run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
