"""Persistent operation log for expert maintenance actions.

Every expert action (VACUUM/ANALYZE/REINDEX/DROP INDEX/ALTER SEQUENCE) is
recorded in pgGuardian's **own** metadata store — the same backend that holds
users/sessions (PostgreSQL for the web deployment, SQLite for the desktop
build) — so an operator can review what ran, on which object, by whom, how
long it took and how it ended (ok/failed/cancelled).

Recording is best-effort: a logging failure must never break the operation it
describes, so every write is wrapped and only logged locally.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

from pgguardian.api.settings import ApiSettings
from pgguardian.central.store import CentralStore, get_central_store

logger = logging.getLogger("pgguardian.operation_log")


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


def _central_store(settings: ApiSettings) -> CentralStore:
    """Metadata store for pgGuardian's own DB (never the diagnosed server)."""
    return get_central_store(settings)


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
        store = _central_store(settings)
        store.insert_operation(
            {
                "actor_email": actor_email,
                "actor_role": actor_role,
                "action": action,
                "command": command,
                "target": target,
                "database_name": database,
                "profile": profile,
                "status": status,
                "error": error,
                "duration_ms": duration_ms,
                "op_id": op_id,
            }
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
    store = _central_store(settings)
    rows = store.list_operations(limit=limit, offset=offset, action=action, status=status)
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
