"""Shared fixtures.

Every ledger and sync test runs twice: once against SQLite (how Perch runs on
a guesthouse owner's own laptop) and once against PostgreSQL (how it runs on
Supabase).  Those are the same product, and the guarantee that the same room
cannot be sold twice has to hold identically on both — a port that is only
tested on one backend is a port that is only correct on one backend.

PostgreSQL tests are skipped unless PERCH_TEST_POSTGRES points at a database:

    PERCH_TEST_POSTGRES=postgresql://postgres@127.0.0.1:5433/perch_test
"""

from __future__ import annotations

import os
import uuid

import pytest

POSTGRES_ENV = "PERCH_TEST_POSTGRES"


def _postgres_base() -> str | None:
    return os.environ.get(POSTGRES_ENV) or None


@pytest.fixture(params=["sqlite", "postgres"])
def db_url(request, tmp_path):
    """A clean, empty database on each backend in turn.

    Each PostgreSQL test gets its own schema rather than its own database:
    creating a schema is near-instant, and dropping it afterwards guarantees no
    test can see another's rows.
    """
    if request.param == "sqlite":
        yield str(tmp_path / "perch-test.db")
        return

    base = _postgres_base()
    if not base:
        pytest.skip(f"set {POSTGRES_ENV} to run the PostgreSQL suite")

    import psycopg

    schema = f"perch_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')

    separator = "&" if "?" in base else "?"
    yield f"{base}{separator}options=-csearch_path%3D{schema}"

    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(f'DROP SCHEMA "{schema}" CASCADE')


@pytest.fixture()
def backend(db_url):
    """Which backend the current test is running against."""
    from bnb.sql import dialect_of

    return dialect_of(db_url)
