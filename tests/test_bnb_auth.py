"""Signing in, and the isolation between one owner's property and another's."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import pytest

from bnb.auth import Auth, AuthError, guard_exposure
from bnb.db import create_property, create_room, open_db
from bnb.web import create_app

SECRET = "test-jwt-secret"
PROJECT = "https://example.supabase.co"


def _b64(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()


def make_token(*, secret: str = SECRET, header: dict | None = None,
               signature: str | None = None, **claims) -> str:
    payload = {"sub": "owner-1", "email": "ada@example.invalid",
               "aud": "authenticated", "role": "authenticated",
               "exp": time.time() + 3600}
    payload.update(claims)
    head = _b64(header or {"alg": "HS256", "typ": "JWT"})
    body = _b64(payload)
    if signature is None:
        signature = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256)
            .digest()).rstrip(b"=").decode()
    return f"{head}.{body}.{signature}"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def hosted(db_url):
    """An instance with Supabase configured, as it would run when deployed."""
    app = create_app(db_url, auth=Auth(url=PROJECT, anon_key="anon", jwt_secret=SECRET))
    app.config.update(TESTING=True)
    return app


@pytest.fixture()
def local(db_url):
    """An instance with no Supabase, as the double-click launchers run it."""
    conn = open_db(db_url)
    property_id = create_property(conn, "Rose Cottage")
    create_room(conn, property_id, "Garden Room")
    conn.close()

    app = create_app(db_url, auth=Auth(url="", anon_key="", jwt_secret=""))
    app.config.update(TESTING=True)
    return app


# --------------------------------------------------------------- local mode

def test_local_mode_needs_no_sign_in(local):
    """The app is reachable only from the machine it runs on, so there is
    nobody to tell apart."""
    client = local.test_client()
    assert client.get("/api/auth-config").get_json()["enabled"] is False
    assert client.get("/api/bootstrap").status_code == 200


# -------------------------------------------------------------- hosted mode

def test_hosted_mode_refuses_an_unsigned_request(hosted):
    response = hosted.test_client().get("/api/bootstrap")
    assert response.status_code == 401


def test_hosted_mode_accepts_a_valid_token(hosted):
    response = hosted.test_client().get("/api/bootstrap", headers=bearer(make_token()))
    assert response.status_code == 200
    assert response.get_json()["user"]["email"] == "ada@example.invalid"


def test_the_sign_in_screen_can_be_read_before_signing_in(hosted):
    """It carries its own translations, or the owner is asked to sign in by a
    screen they may not be able to read."""
    body = hosted.test_client().get("/api/auth-config?locale=fr").get_json()
    assert body["enabled"] is True
    assert body["url"] == PROJECT
    assert body["i18n"]["strings"]["auth.password"] == "Mot de passe"


def test_the_jwt_secret_is_never_sent_to_the_browser(hosted):
    body = hosted.test_client().get("/api/auth-config").get_data(as_text=True)
    assert SECRET not in body


# ----------------------------------------------------------------- forgery

@pytest.mark.parametrize("token,why", [
    (make_token(secret="not-the-secret"), "signed with the wrong secret"),
    (make_token(exp=time.time() - 60), "expired"),
    (make_token(aud="anon"), "not an authenticated audience"),
    (make_token(header={"alg": "none", "typ": "JWT"}, signature=""), "alg: none"),
    (make_token(header={"alg": "HS512", "typ": "JWT"}), "algorithm swapped"),
    ("nonsense", "not a token at all"),
])
def test_forged_tokens_are_refused(hosted, token, why):
    assert hosted.test_client().get(
        "/api/bootstrap", headers=bearer(token)).status_code == 401, why


def test_alg_none_cannot_sign_itself():
    """The classic JWT forgery: trusting the algorithm the token declares."""
    auth = Auth(url=PROJECT, jwt_secret=SECRET)
    with pytest.raises(AuthError):
        auth.verify(make_token(header={"alg": "none", "typ": "JWT"}, signature=""))


# --------------------------------------------------------------- isolation

def test_each_owner_gets_their_own_property(hosted):
    client = hosted.test_client()
    first = client.get("/api/bootstrap", headers=bearer(make_token(sub="owner-1")))
    second = client.get("/api/bootstrap", headers=bearer(make_token(sub="owner-2")))

    assert first.get_json()["property"]["id"] != second.get_json()["property"]["id"]


def test_one_owner_cannot_see_anothers_bookings(hosted):
    client = hosted.test_client()
    ada, bob = bearer(make_token(sub="owner-1")), bearer(make_token(sub="owner-2"))

    room = client.get("/api/bootstrap", headers=ada).get_json()["rooms"][0]["id"]
    created = client.post("/api/bookings", headers={**ada, "Idempotency-Key": "k1"},
                          json={"room_id": room, "checkin": "2026-06-01",
                                "checkout": "2026-06-03", "guest_name": "Ada's guest"})
    assert created.status_code == 201

    mine = client.get("/api/agenda?start=2026-06-01&end=2026-06-30", headers=ada)
    theirs = client.get("/api/agenda?start=2026-06-01&end=2026-06-30", headers=bob)

    assert [s["guest_name"] for s in mine.get_json()["stays"]] == ["Ada's guest"]
    assert theirs.get_json()["stays"] == [], "another owner must see nothing"


def test_a_new_owner_lands_on_rooms_but_no_invented_guests(hosted):
    """Sample reservations in a real account are indistinguishable from a sync
    that has gone wrong."""
    body = hosted.test_client().get(
        "/api/bootstrap", headers=bearer(make_token(sub="fresh"))).get_json()
    assert len(body["rooms"]) == 3
    assert body["conflicts"] == 0

    stays = hosted.test_client().get(
        "/api/agenda?start=2026-01-01&end=2027-01-01",
        headers=bearer(make_token(sub="fresh"))).get_json()["stays"]
    assert stays == []


# ------------------------------------------------- the channel-facing edges

def test_the_calendar_feed_and_hook_do_not_require_a_sign_in(hosted, db_url):
    """Airbnb cannot sign in. Those endpoints carry their credential in the URL."""
    from bnb.db import create_channel

    client = hosted.test_client()
    client.get("/api/bootstrap", headers=bearer(make_token()))   # create the property

    conn = open_db(db_url)
    prop = conn.execute("SELECT id FROM property LIMIT 1").fetchone()["id"]
    room = conn.execute("SELECT id FROM room WHERE property_id = ? LIMIT 1",
                        (prop,)).fetchone()["id"]
    channel = create_channel(conn, prop, "airbnb", "Airbnb", room_id=room)
    tokens = conn.execute(
        "SELECT export_token, inbound_token FROM channel WHERE id = ?",
        (channel,)).fetchone()
    conn.close()

    assert client.get(f"/ical/{tokens['export_token']}.ics").status_code == 200
    assert client.post(f"/hooks/{tokens['inbound_token']}", json={
        "reference": "R1", "checkin": "2026-07-01", "checkout": "2026-07-02"}).status_code == 200


def test_an_unknown_feed_token_is_still_a_404_not_a_401(hosted):
    assert hosted.test_client().get("/ical/wrong.ics").status_code == 404


# ----------------------------------------------------------------- exposure

def test_binding_to_the_network_without_a_login_is_refused():
    """A guesthouse's Wi-Fi is shared with its guests."""
    with pytest.raises(SystemExit) as raised:
        guard_exposure("0.0.0.0", Auth(url="", anon_key="", jwt_secret=""))
    assert "Refusing to start" in str(raised.value)


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
def test_loopback_without_a_login_is_fine(host):
    guard_exposure(host, Auth(url="", anon_key="", jwt_secret=""))


def test_binding_to_the_network_with_a_login_is_fine():
    guard_exposure("0.0.0.0", Auth(url=PROJECT, anon_key="anon", jwt_secret=SECRET))


# ------------------------------------------------------ the scheduled sync

def test_the_scheduled_sync_needs_its_own_token(hosted):
    """A cron job cannot sign in as a person."""
    client = hosted.test_client()
    assert client.post("/api/cron/sync").status_code == 401
    assert client.post("/api/cron/sync",
                       headers={"X-Perch-Sync-Token": "wrong"}).status_code == 401


def test_the_scheduled_sync_runs_with_the_right_token(db_url):
    app = create_app(db_url, auth=Auth(url=PROJECT, anon_key="anon",
                                       jwt_secret=SECRET, sync_token="cron-secret"))
    app.config.update(TESTING=True)
    client = app.test_client()
    client.get("/api/bootstrap", headers=bearer(make_token()))   # make a property

    response = client.post("/api/cron/sync",
                           headers={"X-Perch-Sync-Token": "cron-secret"})
    assert response.status_code == 200
    assert len(response.get_json()["synced"]) == 1


def test_an_unconfigured_sync_token_refuses_everything(db_url):
    """A deployment that forgot to set one must be shut, not open."""
    app = create_app(db_url, auth=Auth(url=PROJECT, anon_key="anon",
                                       jwt_secret=SECRET, sync_token=""))
    app.config.update(TESTING=True)
    assert app.test_client().post(
        "/api/cron/sync", headers={"X-Perch-Sync-Token": ""}).status_code == 401
