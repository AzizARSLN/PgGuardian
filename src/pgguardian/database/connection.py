"""Central database connection factory (psycopg 3).

All connections are short-lived, read-only in practice (PgGuardian only ever
issues SELECT-style diagnostic queries) and created through context managers
so the lifecycle is always correctly handled.

Connection-string precedence:
1. ``--connection-string`` CLI option
2. ``PGGUARDIAN_CONNECTION_STRING`` environment variable
3. Standard PostgreSQL variables (``PGHOST``/``PGPORT``/``PGDATABASE``/
   ``PGUSER``/``PGPASSWORD``) combined with CLI ``--host``/``--port``/...
   options (explicit CLI options win over the ``PG*`` variables).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import sql as pgsql
from psycopg.rows import dict_row

from pgguardian.config.settings import PgGuardianSettings


@dataclass(frozen=True)
class ConnectionParams:
    """Resolved, log-safe connection parameters (password kept out of repr)."""

    host: str
    port: int
    database: str
    username: str
    password: str | None
    connect_timeout: int
    query_timeout_ms: int

    def __repr__(self) -> str:
        return (
            f"ConnectionParams(host={self.host!r}, port={self.port!r}, "
            f"database={self.database!r}, username={self.username!r}, "
            "password='***', "
            f"connect_timeout={self.connect_timeout!r}, "
            f"query_timeout_ms={self.query_timeout_ms!r})"
        )


class ConnectionError(RuntimeError):
    """Raised when a connection to PostgreSQL cannot be established."""


def resolve_connection_string(
    settings: PgGuardianSettings,
    cli_connection_string: str | None = None,
) -> str:
    """Resolve the effective libpq connection string without ever logging it."""
    if cli_connection_string:
        return cli_connection_string
    if settings.connection_string:
        return settings.connection_string

    if settings.active_profile:
        # A saved profile is authoritative: ambient PG* variables must not
        # silently redirect it to a different server/database.
        password = settings.password or os.getenv("PGPASSWORD", "")
        host = settings.host
        port = str(settings.port)
        database = settings.database
        username = settings.username
    else:
        host = os.getenv("PGHOST", settings.host)
        port = os.getenv("PGPORT", str(settings.port))
        database = os.getenv("PGDATABASE", settings.database)
        username = os.getenv("PGUSER", settings.username)
        password = os.getenv("PGPASSWORD", settings.password or "")

    if password:
        return (
            f"host={host} port={port} dbname={database} "
            f"user={username} password={password} "
            f"connect_timeout={settings.connect_timeout}"
        )
    return (
        f"host={host} port={port} dbname={database} "
        f"user={username} connect_timeout={settings.connect_timeout}"
    )


def build_connection_params(settings: PgGuardianSettings) -> ConnectionParams:
    """Build log-safe params for display/diagnostics (password excluded)."""
    if settings.active_profile:
        host, port, database, username = (
            settings.host,
            settings.port,
            settings.database,
            settings.username,
        )
    else:
        host = os.getenv("PGHOST", settings.host)
        port = int(os.getenv("PGPORT", str(settings.port)))
        database = os.getenv("PGDATABASE", settings.database)
        username = os.getenv("PGUSER", settings.username)
    return ConnectionParams(
        host=host,
        port=int(port),
        database=database,
        username=username,
        password=None,
        connect_timeout=settings.connect_timeout,
        query_timeout_ms=settings.query_timeout_ms,
    )


def _statement_options(settings: PgGuardianSettings) -> str:
    # statement_timeout gives us query timeout + effective cancellation.
    return f"-c statement_timeout={int(settings.query_timeout_ms)}ms"


@contextmanager
def get_connection(
    settings: PgGuardianSettings,
    cli_connection_string: str | None = None,
    *,
    statement_timeout: bool = True,
) -> Iterator[psycopg.Connection[dict[str, Any]]]:
    """Yield a fresh psycopg connection; always closed afterwards.

    ``statement_timeout=False`` disables the statement timeout for explicit
    long-running expert operations (VACUUM, REINDEX, backups) on large
    databases. Diagnostics always keep it enabled.
    """
    conninfo = resolve_connection_string(settings, cli_connection_string)
    options = _statement_options(settings) if statement_timeout else None
    try:
        if options is None:
            conn = psycopg.connect(
                conninfo,
                autocommit=True,
                connect_timeout=settings.connect_timeout,
                row_factory=dict_row,
            )
        else:
            conn = psycopg.connect(
                conninfo,
                autocommit=True,
                connect_timeout=settings.connect_timeout,
                options=options,
                row_factory=dict_row,
            )
    except Exception as exc:
        raise ConnectionError("Unable to connect to PostgreSQL.") from exc
    try:
        yield conn
    finally:
        conn.close()


class DbClient:
    """Thin read-only query helper with per-call connections.

    A new short-lived connection per call keeps the lifecycle trivially
    correct and avoids any shared/global connection state.
    """

    def __init__(
        self,
        settings: PgGuardianSettings,
        cli_connection_string: str | None = None,
        *,
        statement_timeout: bool = True,
    ) -> None:
        self._settings = settings
        self._cli_connection_string = cli_connection_string
        self._statement_timeout = statement_timeout

    @property
    def settings(self) -> PgGuardianSettings:
        return self._settings

    def _connection(self) -> AbstractContextManager[psycopg.Connection[dict[str, Any]]]:
        return get_connection(
            self._settings, self._cli_connection_string, statement_timeout=self._statement_timeout
        )

    def fetch_all(self, sql: str, params: tuple[object, ...] | None = None) -> list[dict]:
        """Run a read-only SELECT and return rows as plain dicts."""
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params or ())
                rows = cur.fetchall()
                return [dict(row) for row in rows]

    def fetch_one(self, sql: str, params: tuple[object, ...] | None = None) -> dict | None:
        """Run a SELECT expected to return a single row (or None)."""
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params or ())
                row = cur.fetchone()
                return dict(row) if row is not None else None

    def execute_raw(
        self, query: str | pgsql.SQL | pgsql.Composed, params: tuple[object, ...] | None = None
    ) -> str:
        """Execute one composed/DDL statement; returns the command status string."""
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params or ())
                return cur.statusmessage or ""

    def ping(self) -> tuple[str, int]:
        """Return ``(server_version, server_version_num)`` for compatibility checks."""
        row = self.fetch_one("SELECT version() AS version")
        version = str((row or {}).get("version", ""))
        return version, parse_server_version_num(version)


def parse_server_version_num(version_string: str) -> int:
    """Parse ``PostgreSQL 16.4 ...`` into a comparable int like 160004."""
    import re

    match = re.search(r"PostgreSQL\s+(\d+)(?:\.(\d+))?", version_string)
    if not match:
        return 0
    major = int(match.group(1))
    minor = int(match.group(2) or 0)
    return major * 10000 + minor
