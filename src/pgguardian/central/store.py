"""pgGuardian's own metadata: users, sessions and the operation log.

The web deployment keeps this in PostgreSQL — the ambient ``PGGUARDIAN_DATABASE``
that also holds ``pgguardian_users``. The desktop build is self-contained and
keeps the very same tables in a local SQLite file (stdlib only, no server).

Pick the backend with ``PGGUARDIAN_CENTRAL_BACKEND`` (``postgres`` | ``sqlite``);
the SQLite file defaults to ``~/.config/pgguardian/central.db`` and can be moved
with ``PGGUARDIAN_CENTRAL_DB_FILE``.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from pgguardian.config.settings import get_settings
from pgguardian.database.connection import DbClient

_USERS_COLUMNS = "id, email, full_name, app_role, is_active, password_must_change, created_at, last_login"

# Timestamps are stored as UTC text so lexicographic comparison matches time order.
_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS pgguardian_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    app_role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    password_must_change INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_central_users_email ON pgguardian_users (lower(email));
CREATE TABLE IF NOT EXISTS pgguardian_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES pgguardian_users (id) ON DELETE CASCADE,
    refresh_hash TEXT NOT NULL,
    user_agent TEXT,
    ip_addr TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_central_sessions_user ON pgguardian_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_central_sessions_hash ON pgguardian_sessions (refresh_hash);
CREATE TABLE IF NOT EXISTS pgguardian_operation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor_email TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    command TEXT,
    target TEXT,
    database_name TEXT,
    profile TEXT,
    status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'cancelled')),
    error TEXT,
    duration_ms INTEGER,
    op_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_central_oplog_time ON pgguardian_operation_log (occurred_at DESC);
CREATE TABLE IF NOT EXISTS pgguardian_license (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    license_key TEXT NOT NULL,
    email TEXT,
    plan TEXT,
    issued_at TEXT,
    expires_at TEXT,
    activated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


# docker/init.sql creates this table for the web deployment; an older database
# may predate it, so the first access self-heals once per process.
_LICENSE_DDL = """
CREATE TABLE IF NOT EXISTS pgguardian_license (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    license_key TEXT NOT NULL,
    email TEXT,
    plan TEXT,
    issued_at TEXT,
    expires_at TEXT,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""
_license_lock = threading.Lock()
_license_ready = False


def _ensure_license_table(client: DbClient) -> None:
    """Create the license table once per process (Postgres backend)."""
    global _license_ready
    if _license_ready:
        return
    with _license_lock:
        if _license_ready:
            return
        client.execute_raw(_LICENSE_DDL)
        _license_ready = True


# docker/init.sql creates this table for the web deployment; an older database
# may predate it, so the first write self-heals once per process (idempotent).
_OPERATION_LOG_DDL = """
CREATE TABLE IF NOT EXISTS pgguardian_operation_log (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_email TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    command TEXT,
    target TEXT,
    database_name TEXT,
    profile TEXT,
    status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'cancelled')),
    error TEXT,
    duration_ms INTEGER,
    op_id TEXT
)
"""
_oplog_lock = threading.Lock()
_oplog_ready = False


def _ensure_operation_log(client: DbClient) -> None:
    """Create the operation-log table once per process (Postgres backend)."""
    global _oplog_ready
    if _oplog_ready:
        return
    with _oplog_lock:
        if _oplog_ready:
            return
        client.execute_raw(_OPERATION_LOG_DDL)
        _oplog_ready = True


def default_db_path() -> Path:
    """Location of the self-contained metadata database."""
    return Path.home() / ".config" / "pgguardian" / "central.db"


def _ts(value: datetime | str | None) -> str | None:
    """Normalise a timestamp to SQLite's ``YYYY-MM-DD HH:MM:SS`` text form."""
    if value is None or isinstance(value, str):
        return value
    return value.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


class CentralStore(Protocol):
    """Users, sessions and the operation log, whichever backend is configured."""

    def count_users(self) -> int: ...

    def find_user_by_email(self, email: str) -> dict[str, Any] | None: ...

    def get_user(self, user_id: int) -> dict[str, Any] | None: ...

    def get_active_user(self, user_id: int) -> dict[str, Any] | None: ...

    def get_password_hash(self, user_id: int) -> str | None: ...

    def user_exists(self, user_id: int) -> bool: ...

    def list_users(self, search: str | None = None) -> list[dict[str, Any]]: ...

    def email_taken(self, email: str, exclude_id: int | None = None) -> bool: ...

    def create_user(
        self,
        *,
        email: str,
        full_name: str,
        password_hash: str,
        app_role: str,
        is_active: bool,
        password_must_change: bool,
    ) -> int: ...

    def update_user(self, user_id: int, fields: dict[str, Any]) -> None: ...

    def deactivate_user(self, user_id: int) -> None: ...

    def set_password(self, user_id: int, password_hash: str, must_change: bool | None) -> None: ...

    def touch_last_login(self, user_id: int) -> None: ...

    def create_session(
        self,
        *,
        user_id: int,
        refresh_hash: str,
        user_agent: str | None,
        ip_addr: str | None,
        expires_at: datetime,
    ) -> None: ...

    def find_session(self, refresh_hash: str) -> dict[str, Any] | None: ...

    def expire_session_soon(self, session_id: int, seconds: int) -> None: ...

    def delete_session(self, refresh_hash: str) -> None: ...

    def delete_user_sessions(self, user_id: int) -> None: ...

    def insert_operation(self, values: dict[str, Any]) -> None: ...

    def list_operations(
        self,
        *,
        limit: int,
        offset: int,
        action: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]: ...

    def get_license(self) -> dict[str, Any] | None: ...

    def set_license(
        self,
        *,
        license_key: str,
        email: str | None,
        plan: str | None,
        issued_at: str | None,
        expires_at: str | None,
    ) -> None: ...

    def delete_license(self) -> None: ...


class SqliteCentralStore:
    """Self-contained metadata in a single local SQLite file (desktop build)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._ready = False

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._ensure()
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _ensure(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            self._path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self._path))
            try:
                conn.executescript(_SQLITE_SCHEMA)
                conn.commit()
            finally:
                conn.close()
            self._ready = True

    def count_users(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT count(*) AS c FROM pgguardian_users").fetchone()
        return int(row["c"])

    def find_user_by_email(self, email: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, email, full_name, password_hash, app_role, is_active, "
                "password_must_change FROM pgguardian_users WHERE lower(email) = lower(?)",
                (email.strip(),),
            ).fetchone()
        return dict(row) if row else None

    def get_user(self, user_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {_USERS_COLUMNS}, password_hash FROM pgguardian_users WHERE id = ?",
                (user_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_active_user(self, user_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, email, full_name, app_role, password_must_change FROM pgguardian_users "
                "WHERE id = ? AND is_active = 1",
                (user_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_password_hash(self, user_id: int) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT password_hash FROM pgguardian_users WHERE id = ? AND is_active = 1",
                (user_id,),
            ).fetchone()
        return str(row["password_hash"]) if row else None

    def user_exists(self, user_id: int) -> bool:
        with self._connect() as conn:
            return conn.execute(
                "SELECT id FROM pgguardian_users WHERE id = ?", (user_id,)
            ).fetchone() is not None

    def list_users(self, search: str | None = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if search:
                rows = conn.execute(
                    f"SELECT {_USERS_COLUMNS} FROM pgguardian_users "
                    "WHERE lower(email) LIKE lower(?) ORDER BY email",
                    (f"%{search}%",),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"SELECT {_USERS_COLUMNS} FROM pgguardian_users ORDER BY email"
                ).fetchall()
        return [dict(row) for row in rows]

    def email_taken(self, email: str, exclude_id: int | None = None) -> bool:
        sql = "SELECT 1 FROM pgguardian_users WHERE lower(email) = lower(?)"
        params: list[Any] = [email]
        if exclude_id is not None:
            sql += " AND id <> ?"
            params.append(exclude_id)
        with self._connect() as conn:
            return conn.execute(sql, tuple(params)).fetchone() is not None

    def create_user(
        self,
        *,
        email: str,
        full_name: str,
        password_hash: str,
        app_role: str,
        is_active: bool,
        password_must_change: bool,
    ) -> int:
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO pgguardian_users (email, full_name, password_hash, app_role, "
                "is_active, password_must_change) VALUES (?, ?, ?, ?, ?, ?)",
                (email, full_name, password_hash, app_role, int(is_active), int(password_must_change)),
            )
            return int(cursor.lastrowid or 0)

    def update_user(self, user_id: int, fields: dict[str, Any]) -> None:
        if not fields:
            return
        assignments = ", ".join(f"{column} = ?" for column in fields)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE pgguardian_users SET {assignments} WHERE id = ?",
                (*fields.values(), user_id),
            )

    def deactivate_user(self, user_id: int) -> None:
        self.update_user(user_id, {"is_active": False})

    def set_password(self, user_id: int, password_hash: str, must_change: bool | None) -> None:
        fields: dict[str, Any] = {"password_hash": password_hash}
        if must_change is not None:
            fields["password_must_change"] = must_change
        self.update_user(user_id, fields)

    def touch_last_login(self, user_id: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE pgguardian_users SET last_login = datetime('now') WHERE id = ?",
                (user_id,),
            )

    def create_session(
        self,
        *,
        user_id: int,
        refresh_hash: str,
        user_agent: str | None,
        ip_addr: str | None,
        expires_at: datetime,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO pgguardian_sessions (user_id, refresh_hash, user_agent, ip_addr, "
                "expires_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, refresh_hash, user_agent, ip_addr, _ts(expires_at)),
            )

    def find_session(self, refresh_hash: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT s.id, s.user_id, u.email, u.full_name, u.app_role, u.is_active, "
                "u.password_must_change FROM pgguardian_sessions s JOIN pgguardian_users u "
                "ON u.id = s.user_id WHERE s.refresh_hash = ? AND s.expires_at > datetime('now')",
                (refresh_hash,),
            ).fetchone()
        return dict(row) if row else None

    def expire_session_soon(self, session_id: int, seconds: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE pgguardian_sessions SET expires_at = "
                "MIN(expires_at, datetime('now', ?)) WHERE id = ?",
                (f"+{int(seconds)} seconds", session_id),
            )

    def delete_session(self, refresh_hash: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM pgguardian_sessions WHERE refresh_hash = ?", (refresh_hash,)
            )

    def delete_user_sessions(self, user_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM pgguardian_sessions WHERE user_id = ?", (user_id,))

    def insert_operation(self, values: dict[str, Any]) -> None:
        columns = (
            "actor_email",
            "actor_role",
            "action",
            "command",
            "target",
            "database_name",
            "profile",
            "status",
            "error",
            "duration_ms",
            "op_id",
        )
        placeholders = ", ".join("?" for _ in columns)
        with self._connect() as conn:
            conn.execute(
                f"INSERT INTO pgguardian_operation_log ({', '.join(columns)}) "
                f"VALUES ({placeholders})",
                tuple(values.get(column) for column in columns),
            )

    def list_operations(
        self,
        *,
        limit: int,
        offset: int,
        action: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if action:
            clauses.append("action = ?")
            params.append(action)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, occurred_at, actor_email, actor_role, action, command, target, "
                f"database_name, profile, status, error, duration_ms, op_id FROM pgguardian_operation_log{where} "
                "ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?",
                tuple(params),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_license(self) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT license_key, email, plan, issued_at, expires_at, activated_at "
                "FROM pgguardian_license WHERE id = 1"
            ).fetchone()
        return dict(row) if row else None

    def set_license(
        self,
        *,
        license_key: str,
        email: str | None,
        plan: str | None,
        issued_at: str | None,
        expires_at: str | None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO pgguardian_license "
                "(id, license_key, email, plan, issued_at, expires_at, activated_at) "
                "VALUES (1, ?, ?, ?, ?, ?, datetime('now')) "
                "ON CONFLICT(id) DO UPDATE SET license_key = excluded.license_key, "
                "email = excluded.email, plan = excluded.plan, issued_at = excluded.issued_at, "
                "expires_at = excluded.expires_at, activated_at = datetime('now')",
                (license_key, email, plan, issued_at, expires_at),
            )

    def delete_license(self) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM pgguardian_license WHERE id = 1")


class PostgresCentralStore:
    """Metadata in the ambient PostgreSQL database (web deployment).

    The SQL here is unchanged from the original inline queries so the existing
    web behaviour and its tests are preserved.
    """

    def __init__(self, client: DbClient) -> None:
        self._client = client

    @property
    def client(self) -> DbClient:
        return self._client

    def count_users(self) -> int:
        row = self._client.fetch_one("SELECT count(*) AS c FROM pgguardian_users")
        return int((row or {}).get("c", 0))

    def find_user_by_email(self, email: str) -> dict[str, Any] | None:
        return self._client.fetch_one(
            "SELECT id, email, full_name, password_hash, app_role, is_active, password_must_change "
            "FROM pgguardian_users WHERE lower(email) = %s",
            (email.lower().strip(),),
        )

    def get_user(self, user_id: int) -> dict[str, Any] | None:
        return self._client.fetch_one(
            f"SELECT {_USERS_COLUMNS}, password_hash FROM pgguardian_users WHERE id = %s",
            (user_id,),
        )

    def get_active_user(self, user_id: int) -> dict[str, Any] | None:
        return self._client.fetch_one(
            "SELECT id, email, full_name, app_role, password_must_change FROM pgguardian_users "
            "WHERE id = %s AND is_active = TRUE",
            (user_id,),
        )

    def get_password_hash(self, user_id: int) -> str | None:
        row = self._client.fetch_one(
            "SELECT password_hash FROM pgguardian_users WHERE id = %s AND is_active = TRUE",
            (user_id,),
        )
        return str(row["password_hash"]) if row else None  # type: ignore[index]

    def user_exists(self, user_id: int) -> bool:
        return (
            self._client.fetch_one(
                "SELECT id FROM pgguardian_users WHERE id = %s", (user_id,)
            )
            is not None
        )

    def list_users(self, search: str | None = None) -> list[dict[str, Any]]:
        if search:
            return self._client.fetch_all(
                f"SELECT {_USERS_COLUMNS} FROM pgguardian_users "
                "WHERE lower(email) LIKE lower(%s) ORDER BY email",
                (f"%{search}%",),
            )
        return self._client.fetch_all(
            f"SELECT {_USERS_COLUMNS} FROM pgguardian_users ORDER BY email"
        )

    def email_taken(self, email: str, exclude_id: int | None = None) -> bool:
        if exclude_id is None:
            row = self._client.fetch_one(
                "SELECT id FROM pgguardian_users WHERE lower(email) = lower(%s)", (email,)
            )
        else:
            row = self._client.fetch_one(
                "SELECT id FROM pgguardian_users WHERE lower(email) = lower(%s) AND id <> %s",
                (email, exclude_id),
            )
        return row is not None

    def create_user(
        self,
        *,
        email: str,
        full_name: str,
        password_hash: str,
        app_role: str,
        is_active: bool,
        password_must_change: bool,
    ) -> int:
        result = self._client.fetch_one(
            "INSERT INTO pgguardian_users (email, full_name, password_hash, app_role, is_active, "
            "password_must_change) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (email, full_name, password_hash, app_role, is_active, password_must_change),
        )
        return int(result["id"])  # type: ignore[index]

    def update_user(self, user_id: int, fields: dict[str, Any]) -> None:
        if not fields:
            return
        assignments = ", ".join(f"{column} = %s" for column in fields)
        self._client.execute_raw(
            f"UPDATE pgguardian_users SET {assignments} WHERE id = %s",
            (*fields.values(), user_id),
        )

    def deactivate_user(self, user_id: int) -> None:
        self._client.execute_raw(
            "UPDATE pgguardian_users SET is_active = FALSE WHERE id = %s", (user_id,)
        )

    def set_password(self, user_id: int, password_hash: str, must_change: bool | None) -> None:
        if must_change is None:
            self._client.execute_raw(
                "UPDATE pgguardian_users SET password_hash = %s WHERE id = %s",
                (password_hash, user_id),
            )
        else:
            self._client.execute_raw(
                "UPDATE pgguardian_users SET password_hash = %s, password_must_change = %s WHERE id = %s",
                (password_hash, must_change, user_id),
            )

    def touch_last_login(self, user_id: int) -> None:
        self._client.execute_raw(
            "UPDATE pgguardian_users SET last_login = now() WHERE id = %s", (user_id,)
        )

    def create_session(
        self,
        *,
        user_id: int,
        refresh_hash: str,
        user_agent: str | None,
        ip_addr: str | None,
        expires_at: datetime,
    ) -> None:
        self._client.execute_raw(
            "INSERT INTO pgguardian_sessions (user_id, refresh_hash, user_agent, ip_addr, expires_at) "
            "VALUES (%s, %s, %s, %s::inet, %s)",
            (user_id, refresh_hash, user_agent, ip_addr, expires_at),
        )

    def find_session(self, refresh_hash: str) -> dict[str, Any] | None:
        return self._client.fetch_one(
            "SELECT s.id, s.user_id, u.email, u.full_name, u.app_role, u.is_active, "
            "u.password_must_change FROM pgguardian_sessions s JOIN pgguardian_users u "
            "ON u.id = s.user_id WHERE s.refresh_hash = %s AND s.expires_at > now()",
            (refresh_hash,),
        )

    def expire_session_soon(self, session_id: int, seconds: int) -> None:
        self._client.execute_raw(
            "UPDATE pgguardian_sessions SET expires_at = LEAST(expires_at, now() + %s * interval '1 second')"
            " WHERE id = %s",
            (seconds, session_id),
        )

    def delete_session(self, refresh_hash: str) -> None:
        self._client.execute_raw(
            "DELETE FROM pgguardian_sessions WHERE refresh_hash = %s", (refresh_hash,)
        )

    def delete_user_sessions(self, user_id: int) -> None:
        self._client.execute_raw(
            "DELETE FROM pgguardian_sessions WHERE user_id = %s", (user_id,)
        )

    def insert_operation(self, values: dict[str, Any]) -> None:
        _ensure_operation_log(self._client)
        self._client.execute_raw(
            "INSERT INTO pgguardian_operation_log "
            "(actor_email, actor_role, action, command, target, database_name, profile, "
            " status, error, duration_ms, op_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                values.get("actor_email"),
                values.get("actor_role"),
                values.get("action"),
                values.get("command"),
                values.get("target"),
                values.get("database_name"),
                values.get("profile"),
                values.get("status"),
                values.get("error"),
                values.get("duration_ms"),
                values.get("op_id"),
            ),
        )

    def list_operations(
        self,
        *,
        limit: int,
        offset: int,
        action: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if action:
            clauses.append("action = %s")
            params.append(action)
        if status:
            clauses.append("status = %s")
            params.append(status)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        _ensure_operation_log(self._client)
        return self._client.fetch_all(
            "SELECT id, occurred_at, actor_email, actor_role, action, command, target, "
            "database_name, profile, status, error, duration_ms, op_id "
            f"FROM pgguardian_operation_log{where} "
            "ORDER BY occurred_at DESC, id DESC LIMIT %s OFFSET %s",
            tuple(params),
        )

    def get_license(self) -> dict[str, Any] | None:
        _ensure_license_table(self._client)
        return self._client.fetch_one(
            "SELECT license_key, email, plan, issued_at, expires_at, activated_at "
            "FROM pgguardian_license WHERE id = 1"
        )

    def set_license(
        self,
        *,
        license_key: str,
        email: str | None,
        plan: str | None,
        issued_at: str | None,
        expires_at: str | None,
    ) -> None:
        _ensure_license_table(self._client)
        self._client.execute_raw(
            "INSERT INTO pgguardian_license "
            "(id, license_key, email, plan, issued_at, expires_at, activated_at) "
            "VALUES (1, %s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET license_key = EXCLUDED.license_key, "
            "email = EXCLUDED.email, plan = EXCLUDED.plan, issued_at = EXCLUDED.issued_at, "
            "expires_at = EXCLUDED.expires_at, activated_at = now()",
            (license_key, email, plan, issued_at, expires_at),
        )

    def delete_license(self) -> None:
        _ensure_license_table(self._client)
        self._client.execute_raw("DELETE FROM pgguardian_license WHERE id = 1")


def ambient_db_client(settings: Any) -> DbClient:
    """DbClient for pgGuardian's own database, ignoring any selected profile.

    Users/sessions/operations live on the central ``PGGUARDIAN_*`` database;
    a profile header or saved profile must never redirect auth there, otherwise
    login fails with "Invalid credentials" against a database that simply does
    not have these tables.
    """
    from pgguardian.api.settings import ApiSettings

    assert isinstance(settings, ApiSettings)
    resolved = get_settings(
        host=settings.host,
        port=settings.port,
        database=settings.database,
        username=settings.username,
        password=settings.password,
        connection_string=None,
        active_profile=None,
    )
    resolved.connect_timeout = settings.connect_timeout
    resolved.query_timeout_ms = settings.query_timeout_ms
    parts = [
        f"host={settings.host}",
        f"port={settings.port}",
        f"dbname={settings.database}",
        f"user={settings.username}",
    ]
    if settings.password:
        parts.append(f"password={settings.password}")
    parts.append(f"connect_timeout={resolved.connect_timeout}")
    return DbClient(resolved, cli_connection_string=" ".join(parts))


def get_central_store(settings: Any) -> CentralStore:
    """Build the metadata store for the configured backend (default postgres)."""
    backend = (getattr(settings, "central_backend", None) or "postgres").strip().lower()
    if backend == "sqlite":
        configured = getattr(settings, "central_db_file", None)
        return SqliteCentralStore(Path(configured) if configured else default_db_path())
    return PostgresCentralStore(ambient_db_client(settings))
