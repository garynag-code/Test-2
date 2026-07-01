"""SQLite persistence: connection management and schema.

A single embedded database file holds the whole general ledger. SQLite is
used with foreign keys enforced and amounts stored as integer cents so the
ledger has real relational integrity without a server to operate.

The schema is created idempotently and versioned via ``PRAGMA user_version``
so later phases can add migrations without rewriting existing databases.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Union

SCHEMA_VERSION = 1

_SCHEMA = """
-- The business whose books these are.
CREATE TABLE IF NOT EXISTS entity (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    name                    TEXT NOT NULL,
    industry                TEXT NOT NULL DEFAULT 'general',
    vat_registered          INTEGER NOT NULL DEFAULT 0,
    vat_number              TEXT,
    fy_start_month          INTEGER NOT NULL DEFAULT 3,   -- SA default: March
    functional_currency     TEXT NOT NULL DEFAULT 'ZAR',
    created_at              TEXT NOT NULL
);

-- Chart of accounts. One row per general-ledger account.
CREATE TABLE IF NOT EXISTS account (
    code            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN
                        ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
    subtype         TEXT,                       -- e.g. CURRENT_ASSET, COST_OF_SALES
    normal_side     TEXT NOT NULL CHECK (normal_side IN ('DR','CR')),
    is_bank         INTEGER NOT NULL DEFAULT 0,
    vat_applicable  INTEGER NOT NULL DEFAULT 1,
    active          INTEGER NOT NULL DEFAULT 1,
    parent_code     TEXT REFERENCES account(code),
    created_at      TEXT NOT NULL
);

-- A bank account whose statements feed the cashbook. Linked to a GL account.
CREATE TABLE IF NOT EXISTS bank_account (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    bank_name       TEXT,
    account_number  TEXT,
    gl_code         TEXT NOT NULL REFERENCES account(code),
    currency        TEXT NOT NULL DEFAULT 'ZAR',
    created_at      TEXT NOT NULL
);

-- A balanced double-entry journal entry (header). The ledger reference is a
-- human-facing sequential document number, e.g. CB000123.
CREATE TABLE IF NOT EXISTS journal_entry (
    id              INTEGER PRIMARY KEY,
    reference       TEXT NOT NULL UNIQUE,
    entry_date      TEXT NOT NULL,              -- ISO date (YYYY-MM-DD)
    description     TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'MANUAL',  -- CASHBOOK, MANUAL, ...
    source_ref      TEXT,                       -- e.g. bank statement reference
    reversed_by     INTEGER REFERENCES journal_entry(id),
    reverses        INTEGER REFERENCES journal_entry(id),
    created_at      TEXT NOT NULL
);

-- The individual debit/credit lines of a journal entry.
CREATE TABLE IF NOT EXISTS journal_line (
    id              INTEGER PRIMARY KEY,
    entry_id        INTEGER NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
    line_no         INTEGER NOT NULL,
    account_code    TEXT NOT NULL REFERENCES account(code),
    debit_cents     INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
    credit_cents    INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
    tax_code        TEXT NOT NULL DEFAULT 'NON' REFERENCES tax_code(code),
    tax_cents       INTEGER NOT NULL DEFAULT 0,
    memo            TEXT,
    CHECK (NOT (debit_cents > 0 AND credit_cents > 0))
);
CREATE INDEX IF NOT EXISTS ix_line_entry ON journal_line(entry_id);
CREATE INDEX IF NOT EXISTS ix_line_account ON journal_line(account_code);

-- South African VAT / tax codes.
CREATE TABLE IF NOT EXISTS tax_code (
    code            TEXT PRIMARY KEY,           -- STD, ZER, EXE, NON, CAP
    name            TEXT NOT NULL,
    rate_bps        INTEGER NOT NULL,           -- rate in basis points (1500 = 15%)
    input_account   TEXT REFERENCES account(code),
    output_account  TEXT REFERENCES account(code)
);

-- A single import of a bank statement file (for the audit trail).
CREATE TABLE IF NOT EXISTS statement_import (
    id              INTEGER PRIMARY KEY,
    bank_account_id INTEGER NOT NULL REFERENCES bank_account(id),
    filename        TEXT,
    file_sha256     TEXT,
    row_count       INTEGER NOT NULL DEFAULT 0,
    imported_at     TEXT NOT NULL
);

-- One line of a bank statement. ``external_id`` makes re-imports idempotent.
CREATE TABLE IF NOT EXISTS statement_line (
    id                INTEGER PRIMARY KEY,
    import_id         INTEGER NOT NULL REFERENCES statement_import(id),
    bank_account_id   INTEGER NOT NULL REFERENCES bank_account(id),
    txn_date          TEXT NOT NULL,
    description       TEXT NOT NULL,
    reference         TEXT,
    amount_cents      INTEGER NOT NULL,         -- +inflow / -outflow (bank view)
    external_id       TEXT NOT NULL UNIQUE,     -- unique transaction id
    status            TEXT NOT NULL DEFAULT 'UNALLOCATED'
                        CHECK (status IN ('UNALLOCATED','SUGGESTED','ALLOCATED')),
    suggested_code    TEXT REFERENCES account(code),
    suggested_tax     TEXT REFERENCES tax_code(code),
    suggested_conf    REAL,
    entry_id          INTEGER REFERENCES journal_entry(id),
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stmt_status ON statement_line(status);

-- Learned + seeded allocation rules: description pattern -> account.
CREATE TABLE IF NOT EXISTS allocation_rule (
    id              INTEGER PRIMARY KEY,
    match_type      TEXT NOT NULL CHECK (match_type IN ('EXACT','CONTAINS','REGEX')),
    pattern         TEXT NOT NULL,
    account_code    TEXT NOT NULL REFERENCES account(code),
    tax_code        TEXT NOT NULL DEFAULT 'NON' REFERENCES tax_code(code),
    origin          TEXT NOT NULL DEFAULT 'SEED' CHECK (origin IN ('SEED','LEARNED','AI')),
    priority        INTEGER NOT NULL DEFAULT 100,
    hits            INTEGER NOT NULL DEFAULT 0,
    last_used_at    TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (match_type, pattern, account_code)
);

-- Append-only audit log of every material action.
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY,
    ts              TEXT NOT NULL,
    actor           TEXT NOT NULL DEFAULT 'system',
    action          TEXT NOT NULL,
    object_type     TEXT,
    object_id       TEXT,
    detail          TEXT
);
"""


def connect(path: Union[str, Path]) -> sqlite3.Connection:
    """Open (creating if needed) the accounting database at *path*.

    ``":memory:"`` is accepted for tests. Foreign keys are enforced and rows
    come back as :class:`sqlite3.Row` so columns are addressable by name.
    """
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    _init_schema(conn)
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == 0:
        conn.executescript(_SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    # Future: elif version < SCHEMA_VERSION: run ordered migrations.
