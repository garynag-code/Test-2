"""The HTTP surface: the owner's API, the platforms' feed, the inbound hook."""

import json

import pytest

from bnb import icalendar as ics
from bnb.db import create_channel, create_property, create_room, open_db
from bnb.web import create_app


@pytest.fixture()
def app(db_url):
    path = db_url
    conn = open_db(path)
    prop = create_property(conn, "Rose Cottage", timezone="UTC", currency="EUR", locale="en")
    garden = create_room(conn, prop, "Garden Room", base_rate_cents=11000, sort_order=1)
    attic = create_room(conn, prop, "Attic Room", base_rate_cents=9000, sort_order=2)
    channel = create_channel(conn, prop, "booking_com", "Booking.com — Garden",
                             room_id=garden, tier="api")
    tokens = conn.execute(
        "SELECT export_token, inbound_token FROM channel WHERE id = ?",
        (channel,)).fetchone()
    conn.close()

    application = create_app(str(path))
    application.config.update(TESTING=True)
    application.config["ids"] = {"property": prop, "garden": garden, "attic": attic,
                                "channel": channel,
                                "export_token": tokens["export_token"],
                                "inbound_token": tokens["inbound_token"]}
    return application


@pytest.fixture()
def client(app):
    return app.test_client()


def ids(app):
    return app.config["ids"]


def make_booking(client, app, **overrides):
    payload = {"room_id": ids(app)["garden"], "checkin": "2026-06-01",
               "checkout": "2026-06-04", "guest_name": "Ada", "guests": 2,
               "amount_cents": 33000}
    payload.update(overrides)
    return client.post("/api/bookings", json=payload,
                       headers={"Idempotency-Key": overrides.pop("key", "k-1")})


# ------------------------------------------------------------------ shell

def test_the_app_shell_and_manifest_are_served(client):
    assert client.get("/").status_code == 200
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert json.loads(manifest.data)["start_url"] == "/"
    worker = client.get("/service-worker.js")
    assert worker.status_code == 200
    # Served from the root so its scope covers the whole app, and never cached
    # or an old worker pins an old shell forever.
    assert worker.headers["Cache-Control"] == "no-cache"


def test_bootstrap_carries_everything_the_client_needs_to_paint(client, app):
    body = client.get("/api/bootstrap").get_json()
    assert body["property"]["name"] == "Rose Cottage"
    assert [room["name"] for room in body["rooms"]] == ["Garden Room", "Attic Room"]
    assert body["i18n"]["locale"] == "en"
    assert body["today"]


def test_bootstrap_honours_a_requested_language(client):
    body = client.get("/api/bootstrap?locale=pt-BR").get_json()
    assert body["i18n"]["locale"] == "pt"
    assert body["i18n"]["dir"] == "ltr"


def test_an_rtl_locale_reports_its_direction(client):
    body = client.get("/api/bootstrap?locale=ar").get_json()
    assert body["i18n"]["dir"] == "rtl"


# --------------------------------------------------------------- bookings

def test_creating_a_booking(client, app):
    response = make_booking(client, app)
    assert response.status_code == 201
    assert response.get_json()["booking_id"]


def test_a_clash_is_a_409_that_names_the_nights(client, app):
    make_booking(client, app)
    clash = make_booking(client, app, checkin="2026-06-03", checkout="2026-06-06", key="k-2")

    assert clash.status_code == 409
    body = clash.get_json()
    assert body["clashing_nights"] == ["2026-06-03"]
    assert body["incumbent_id"]


def test_the_same_idempotency_key_returns_the_first_booking(client, app):
    first = make_booking(client, app).get_json()
    second = make_booking(client, app).get_json()
    assert first["booking_id"] == second["booking_id"]
    assert second["replayed"] is True


def test_a_bad_date_range_is_rejected_as_a_client_error(client, app):
    response = make_booking(client, app, checkin="2026-06-04", checkout="2026-06-01")
    assert response.status_code == 400


def test_a_missing_field_is_a_400_not_a_crash(client):
    assert client.post("/api/bookings", json={"checkin": "2026-06-01"}).status_code == 400


def test_cancelling_frees_the_room(client, app):
    booking_id = make_booking(client, app).get_json()["booking_id"]
    assert client.post(f"/api/bookings/{booking_id}/cancel", json={}).get_json()["cancelled"]
    assert make_booking(client, app, key="k-after").status_code == 201


def test_moving_a_booking_to_a_free_room(client, app):
    booking_id = make_booking(client, app).get_json()["booking_id"]
    response = client.post(f"/api/bookings/{booking_id}/move",
                           json={"room_id": ids(app)["attic"]})
    assert response.status_code == 200 and response.get_json()["moved"]


def test_moving_onto_an_occupied_room_is_a_409(client, app):
    first = make_booking(client, app).get_json()["booking_id"]
    make_booking(client, app, room_id=ids(app)["attic"], key="k-2")
    response = client.post(f"/api/bookings/{first}/move", json={"room_id": ids(app)["attic"]})
    assert response.status_code == 409


def test_an_unknown_booking_is_a_404(client):
    assert client.get("/api/bookings/9999").status_code == 404


# ----------------------------------------------------------------- views

def test_calendar_agenda_day_and_insights_all_reflect_a_new_booking(client, app):
    make_booking(client, app)

    grid = client.get("/api/calendar?start=2026-06-01&end=2026-06-08").get_json()
    cells = grid["nights"][str(ids(app)["garden"])]
    assert cells["2026-06-01"]["state"] == "sold"
    assert cells["2026-06-01"]["arrival"] is True
    assert "2026-06-04" not in cells, "the departure day is open again"

    stays = client.get("/api/agenda?start=2026-06-01&end=2026-06-30").get_json()["stays"]
    assert [row["guest_name"] for row in stays] == ["Ada"]

    day = client.get("/api/day?date=2026-06-01").get_json()
    assert [row["guest_name"] for row in day["arrivals"]] == ["Ada"]

    insights = client.get("/api/insights?start=2026-06-01&end=2026-06-04").get_json()
    assert insights["nights_sold"] == 3
    assert insights["revenue_cents"] == 33000
    assert insights["currency"] == "EUR"


def test_availability_lists_only_the_free_rooms(client, app):
    make_booking(client, app)
    body = client.get("/api/availability?checkin=2026-06-02&checkout=2026-06-03").get_json()
    assert [room["name"] for room in body["rooms"]] == ["Attic Room"]


def test_channels_never_expose_the_inbound_write_token(client, app):
    """The export token is a read URL handed to the platforms; the inbound
    token authorises writes and must never reach the browser."""
    channels = client.get("/api/channels").get_json()["channels"]
    assert channels[0]["export_token"]
    assert "inbound_token" not in channels[0]
    assert ids(app)["inbound_token"] not in client.get("/api/channels").get_data(as_text=True)


# ------------------------------------------------------------ the feed out

def test_the_ical_feed_serves_what_the_platforms_subscribe_to(client, app):
    make_booking(client, app, room_id=ids(app)["attic"])
    response = client.get(f"/ical/{ids(app)['export_token']}.ics")

    assert response.status_code == 200
    assert response.mimetype == "text/calendar"
    events = ics.parse(response.get_data(as_text=True))
    assert isinstance(events, list)


def test_an_unknown_feed_token_is_a_404(client):
    assert client.get("/ical/not-a-real-token.ics").status_code == 404


# ------------------------------------------------------------- the hook in

def test_the_inbound_hook_books_a_room(client, app):
    response = client.post(f"/hooks/{ids(app)['inbound_token']}", json={
        "reference": "BDC-1", "checkin": "2026-07-01", "checkout": "2026-07-03",
        "guest_name": "Bob"})
    assert response.status_code == 200
    assert response.get_json()["booking_id"]


def test_a_retried_hook_delivery_does_not_book_twice(client, app):
    payload = {"reference": "BDC-1", "checkin": "2026-07-01",
               "checkout": "2026-07-03", "guest_name": "Bob"}
    first = client.post(f"/hooks/{ids(app)['inbound_token']}", json=payload).get_json()
    second = client.post(f"/hooks/{ids(app)['inbound_token']}", json=payload).get_json()
    assert first["booking_id"] == second["booking_id"]
    assert second["action"] == "replayed"


def test_a_clashing_hook_delivery_still_returns_200(client, app):
    """A clash is a successful delivery.  Returning an error would make the
    platform retry forever over something only the owner can settle."""
    make_booking(client, app)
    response = client.post(f"/hooks/{ids(app)['inbound_token']}", json={
        "reference": "BDC-9", "checkin": "2026-06-02", "checkout": "2026-06-05",
        "guest_name": "Bob"})

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is False and body["conflict_id"]
    assert client.get("/api/conflicts").get_json()["conflicts"]


def test_an_unknown_hook_token_is_a_404(client):
    assert client.post("/hooks/nope", json={"reference": "x"}).status_code == 404


def test_resolving_a_conflict_empties_the_inbox(client, app):
    make_booking(client, app)
    client.post(f"/hooks/{ids(app)['inbound_token']}", json={
        "reference": "BDC-9", "checkin": "2026-06-02", "checkout": "2026-06-05"})
    conflict = client.get("/api/conflicts").get_json()["conflicts"][0]

    assert client.post(f"/api/conflicts/{conflict['id']}/resolve",
                       json={"resolution": "moved to Attic"}).get_json()["resolved"]
    assert client.get("/api/conflicts").get_json()["conflicts"] == []


def test_healthz(client):
    assert client.get("/healthz").get_json()["ok"] is True


def test_the_inbound_hook_accepts_a_body_without_a_json_content_type(client, app):
    """The content type a platform sends is not ours to control, and some send
    none at all; refusing the body would drop a real reservation."""
    response = client.post(f"/hooks/{ids(app)['inbound_token']}",
                           data=json.dumps({"reference": "BDC-7", "checkin": "2026-08-01",
                                            "checkout": "2026-08-03", "guest_name": "Ada"}),
                           content_type="text/plain")
    assert response.status_code == 200
    assert response.get_json()["booking_id"]
