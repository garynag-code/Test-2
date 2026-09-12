"""Logging in, via Supabase Auth.

Perch runs in two modes and the difference matters:

* **Local mode** — no Supabase configured. The app is bound to the machine it
  runs on, the owner is the only person who can reach it, and there is no login
  because there is nobody to distinguish them from. This is what the
  double-click launchers use.
* **Hosted mode** — ``SUPABASE_URL`` is set. Every request must carry a valid
  Supabase access token, and each owner sees only their own property.

The app refuses to start in a configuration that is neither: binding to a
network address without a login would put guests' names, emails and phone
numbers in front of anyone on the same Wi-Fi, which in a guesthouse means the
guests themselves. See ``guard_exposure``.

No cryptography dependency is needed. Supabase's HS256 tokens are verified with
``hmac`` from the standard library; projects using asymmetric signing keys are
verified by asking Supabase directly, with a short cache so it is not a round
trip per request.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

# Addresses that mean "this machine only".
LOOPBACK = {"127.0.0.1", "localhost", "::1", ""}

# How long a remotely-verified token is trusted before we ask Supabase again.
REMOTE_CACHE_SECONDS = 60

# Tolerance for clock skew between us and Supabase, in seconds.
LEEWAY = 10


class AuthError(Exception):
    """The request did not carry a usable identity."""


@dataclass
class User:
    id: str
    email: str | None = None
    role: str | None = None


def _b64url(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


class Auth:
    """Verifies bearer tokens, or waves everything through in local mode."""

    def __init__(self, *, url: str | None = None, anon_key: str | None = None,
                 jwt_secret: str | None = None, sync_token: str | None = None):
        self.url = (url or os.environ.get("SUPABASE_URL") or "").rstrip("/")
        self.anon_key = anon_key or os.environ.get("SUPABASE_ANON_KEY") or ""
        self.jwt_secret = jwt_secret or os.environ.get("SUPABASE_JWT_SECRET") or ""
        # A machine credential for the scheduled sync. A cron job cannot sign
        # in as a person, and channels that are never polled are the one
        # failure that silently brings double bookings back.
        self.sync_token = sync_token or os.environ.get("PERCH_SYNC_TOKEN") or ""
        self._cache: dict[str, tuple[float, User]] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.url)

    def client_config(self) -> dict:
        """What the browser needs in order to sign in.

        The anon key is designed to be public — it identifies the project, and
        it is Supabase's row-level security, not its secrecy, that protects
        data. The JWT secret is never sent anywhere.
        """
        return {"enabled": self.enabled, "url": self.url, "anon_key": self.anon_key}

    # -- verification ---------------------------------------------------------

    def verify(self, token: str | None) -> User:
        if not self.enabled:
            return User(id="local", email=None, role="owner")
        if not token:
            raise AuthError("not signed in")

        if self.jwt_secret:
            return self._verify_locally(token)
        return self._verify_with_supabase(token)

    def _verify_locally(self, token: str) -> User:
        try:
            header_b64, payload_b64, signature_b64 = token.split(".")
            header = json.loads(_b64url(header_b64))
            payload = json.loads(_b64url(payload_b64))
        except (ValueError, json.JSONDecodeError) as exc:
            raise AuthError("malformed token") from exc

        # Only ever accept the algorithm we configured for. Trusting the
        # token's own header is the classic JWT forgery: a token claiming
        # "alg": "none" would otherwise verify itself.
        if header.get("alg") != "HS256":
            raise AuthError("unexpected token signing algorithm")

        expected = hmac.new(
            self.jwt_secret.encode("utf-8"),
            f"{header_b64}.{payload_b64}".encode("ascii"),
            hashlib.sha256,
        ).digest()
        actual = _b64url(signature_b64)
        if not hmac.compare_digest(expected, actual):
            raise AuthError("token signature does not match")

        expires = payload.get("exp")
        if not isinstance(expires, (int, float)) or expires + LEEWAY < time.time():
            raise AuthError("token has expired")

        audience = payload.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        if "authenticated" not in audiences:
            raise AuthError("token is not for a signed-in user")

        subject = payload.get("sub")
        if not subject:
            raise AuthError("token identifies no user")

        return User(id=str(subject), email=payload.get("email"),
                    role=payload.get("role"))

    def _verify_with_supabase(self, token: str) -> User:
        fingerprint = hashlib.sha256(token.encode("utf-8")).hexdigest()
        cached = self._cache.get(fingerprint)
        now = time.time()
        if cached and cached[0] > now:
            return cached[1]

        request = urllib.request.Request(
            f"{self.url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": self.anon_key},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise AuthError("token was rejected by Supabase") from exc
        except (urllib.error.URLError, OSError, ValueError) as exc:
            # Fail closed: if we cannot confirm who this is, we do not guess.
            raise AuthError("could not reach Supabase to check the sign-in") from exc

        if not body.get("id"):
            raise AuthError("Supabase returned no user")

        user = User(id=str(body["id"]), email=body.get("email"),
                    role=body.get("role"))
        self._cache[fingerprint] = (now + REMOTE_CACHE_SECONDS, user)
        return user

    def check_sync_token(self, presented: str | None) -> None:
        """Authorise the scheduled sync, or refuse it.

        Compared in constant time, and refused outright when unset so that a
        deployment which forgot to configure one is not wide open.
        """
        if not self.sync_token:
            raise AuthError("no scheduled-sync token is configured")
        if not presented or not hmac.compare_digest(self.sync_token, presented):
            raise AuthError("scheduled-sync token does not match")

    @staticmethod
    def token_from_header(header: str | None) -> str | None:
        if not header:
            return None
        parts = header.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
        return None


def guard_exposure(host: str, auth: Auth) -> None:
    """Refuse to serve guest data to a network with no login in front of it.

    A guesthouse's Wi-Fi is shared with its guests. Binding to it without
    authentication would publish every guest's name, email and phone number to
    everyone in the building, so this is a hard stop rather than a warning.
    """
    if auth.enabled or host in LOOPBACK:
        return
    raise SystemExit(
        "\n  Refusing to start.\n\n"
        f"  You asked Perch to listen on {host}, which makes it reachable by\n"
        "  other devices — but no login is configured, so anyone who can reach\n"
        "  it could read every guest's name, email and phone number.\n\n"
        "  Either:\n"
        "    - leave off --host to keep Perch on this computer only, or\n"
        "    - set SUPABASE_URL (and SUPABASE_ANON_KEY) to switch the login on.\n"
    )
