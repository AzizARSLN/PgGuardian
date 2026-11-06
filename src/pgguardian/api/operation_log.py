"""Persistent operation log for expert maintenance actions.

Every expert action (VACUUM/ANALYZE/REINDEX/DROP INDEX/ALTER SEQUENCE) is
recorded in pgGuardian's **own** database — the ambient ``PGGUARDIAN_DATABASE``
that also holds users/sessions — so an operator can review what ran, on which
object, by whom, how long it took and how it ended (ok/failed/cancelled).

Recording is best-effort: a logging failure must never break the operation it
describes, so every write is wrapped and only logged locally.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

from pgguardian.api.deps import resolve_auth_client
from pgguardian.api.settings import ApiSettings

logger = logging.getLogger("pgguardian.operation_log")

_TABLE = "pgguardian_operation_log"

# The table is created by docker/init.sql; this DDL makes an existing
# deployment self-heal on first write (idempotent, needs CREATE privilege).
_DDL = f"""
CREATE TABLE IF NOT EXISTS {_TABLE} (
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

_ensure_lock = threading.Lock()
_ensured = False


class OperationLogEntry(BaseModel):
    """One recorded operation-log row."""

    model_config = ConfigDict(frozen=True)

    id: int
    occurred_at: datetime
    actor_email: str | None = None
    actor_role: str | None = None
    action: str
    command: str | None = None
    target: str | None = None
    database_name: str | None = None
    profile: str | None = None
    status: str
    error: str | None = None
    duration_ms: int | None = None
    op_id: str | None = None


def _central_client(settings: ApiSettings):
    """A DbClient for pgGuardian's own DB (users/sessions/operations live here)."""
    return resolve_auth_client(settings)


def _ensure_table(client) -> None:
    """Create the log table once per process (idempotent)."""
    global _ensured
    if _ensured:
        return
    with _ensure_lock:
        if _ensured:
            return
        client.execute_raw(_DDL)
        _ensured = True


def record_operation(
    settings: ApiSettings,
    *,
    action: str,
    status: str,
    command: str | None = None,
    target: str | None = None,
    database: str | None = None,
    profile: str | None = None,
    error: str | None = None,
    duration_ms: int | None = None,
    op_id: str | None = None,
    claims: dict[str, Any] | None = None,
) -> None:
    """Append one operation-log row (best effort; never raises)."""
    actor_email = claims.get("email") if claims else None
    actor_role = claims.get("role") if claims else None
    try:
        client = _central_client(settings)
        _ensure_table(client)
        client.execute_raw(
            f"INSERT INTO {_TABLE} "
            "(actor_email, actor_role, action, command, target, database_name, profile, "
            " status, error, duration_ms, op_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                actor_email,
                actor_role,
                action,
                command,
                target,
                database,
                profile,
                status,
                error,
                duration_ms,
                op_id,
            ),
        )
    except Exception as exc:  # noqa: BLE001 - logging must never break the action
        logger.warning("Could not record operation log for %s: %s", action, exc)


def list_operations(
    settings: ApiSettings,
    *,
    limit: int = 100,
    offset: int = 0,
    action: str | None = None,
    status: str | None = None,
) -> list[OperationLogEntry]:
    """Return the most recent operation-log rows (newest first)."""
    client = _central_client(settings)
    _ensure_table(client)
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
    rows = client.fetch_all(
        "SELECT id, occurred_at, actor_email, actor_role, action, command, target, "
        "database_name, profile, status, error, duration_ms, op_id "
        f"FROM {_TABLE}{where} "
        "ORDER BY occurred_at DESC, id DESC LIMIT %s OFFSET %s",
        tuple(params),
    )
    return [OperationLogEntry(**row) for row in rows]


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


@contextmanager
def logged_operation(
    settings: ApiSettings,
    claims: dict[str, Any] | None,
    *,
    action: str,
    command: str,
    target: str | None,
    database: str | None,
    profile: str | None,
    op_id: str | None,
) -> Iterator[None]:
    """Time an action and record its outcome (ok / failed / cancelled).

    A ``499`` is the operator pressing "Durdur" (client abort); it is logged as
    ``cancelled`` rather than a failure so the history stays meaningful.
    """
    started = time.perf_counter()
    base: dict[str, Any] = {
        "action": action,
        "command": command,
        "target": target,
        "database": database,
        "profile": profile,
        "op_id": op_id,
        "claims": claims,
    }
    try:
        yield
    except HTTPException as exc:
        record_operation(
            settings,
            status="cancelled" if exc.status_code == 499 else "failed",
            error=str(exc.detail),
            duration_ms=_elapsed_ms(started),
            **base,
        )
        raise
    except Exception as exc:  # noqa: BLE001 - record then re-raise unchanged
        record_operation(
            settings,
            status="failed",
            error=str(exc),
            duration_ms=_elapsed_ms(started),
            **base,
        )
        raise
    else:
        record_operation(
            settings, status="ok", duration_ms=_elapsed_ms(started), **base
        )
