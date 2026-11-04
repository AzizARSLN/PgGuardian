"""Running expert-operation control: locate a long job and cancel it.

Long expert operations run with ``application_name = 'pgguardian-op:<op_id>'``
(see :mod:`pgguardian.api.ops`). These endpoints let the UI ask "is my
operation still running?", "is it blocked by a lock?" and "stop it" without
any server-side job registry.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.ops import op_application_name, validate_op_id
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_writes_allowed,
    require_confirm,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics import locks as locks_diag
from pgguardian.models.lock import LockInfo
from pgguardian.utils.formatting import to_int

router = APIRouter(prefix="/api/v1/ops", tags=["ops"])

_FIND_SQL = (
    "SELECT pid, state, query,"
    " EXTRACT(EPOCH FROM (now() - query_start))::float8 AS elapsed_seconds"
    " FROM pg_stat_activity"
    " WHERE application_name = %s AND pid <> pg_backend_pid()"
    " ORDER BY query_start DESC NULLS LAST"
    " LIMIT 1"
)


class OpStatus(BaseModel):
    """Whether an operation is still running and what is blocking it."""

    model_config = ConfigDict(frozen=True)

    op_id: str
    running: bool
    pid: int | None = None
    state: str | None = None
    elapsed_seconds: float | None = None
    query: str | None = None
    blocked_by: list[LockInfo] = Field(default_factory=list)


class OpCancelResult(BaseModel):
    """Outcome of an operation-cancel call."""

    model_config = ConfigDict(frozen=True)

    op_id: str
    action: str = "op.cancel"
    pid: int | None = None
    signal_sent: bool = False
    running: bool = False


def _find_pid(client: DbClient, app: str) -> dict | None:
    return client.fetch_one(_FIND_SQL, (app,))


@router.get("/{op_id}", response_model=OpStatus)
def get_op_status(
    op_id: str,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> OpStatus:
    """Is ``op_id`` still running, and which backends are blocking it?"""
    op_id = validate_op_id(op_id)
    app = op_application_name(op_id)
    with mapped_errors(settings):
        client.ping()
        row = _find_pid(client, app)
    if row is None:
        return OpStatus(op_id=op_id, running=False)
    pid = to_int(row.get("pid"))
    blocked: list[LockInfo] = []
    try:
        report = locks_diag.collect_locks(client)
        blocked = [lock for lock in report.locks if lock.blocked_pid == pid]
    except Exception:  # noqa: BLE001 — lock info is advisory, never fail the status call
        blocked = []
    elapsed = row.get("elapsed_seconds")
    return OpStatus(
        op_id=op_id,
        running=True,
        pid=pid,
        state=str(row.get("state")) if row.get("state") else None,
        elapsed_seconds=float(elapsed) if elapsed is not None else None,
        query=str(row.get("query")) if row.get("query") else None,
        blocked_by=blocked,
    )


@router.post("/{op_id}/cancel", response_model=DryRunResult | OpCancelResult)
def cancel_op(
    op_id: str,
    body: MutationRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | OpCancelResult:
    """Cancel a running expert operation: pg_cancel_backend (MAINTENANCE)."""
    op_id = validate_op_id(op_id)
    ensure_writes_allowed(settings, "op.cancel")
    app = op_application_name(op_id)
    with mapped_errors(settings):
        client.ping()
        row = _find_pid(client, app)
    pid = to_int((row or {}).get("pid")) if row else 0
    if body.dry_run:
        return DryRunResult(
            action="op.cancel",
            risk=RiskLevel.MAINTENANCE,
            sql=[f"SELECT pg_cancel_backend(<pid of {op_id}>)"] if pid else [],
            target=op_id,
            note="dry_run: nothing was executed"
            if pid
            else "op is not running; nothing to cancel",
        )
    # Nothing running: the operation already finished (or was stopped).
    if not pid:
        return OpCancelResult(op_id=op_id, pid=None, signal_sent=False, running=False)
    require_confirm(body, "op.cancel")
    with mapped_errors(settings):
        if pid == to_int((client.fetch_one("SELECT pg_backend_pid() AS pid") or {}).get("pid")):
            raise HTTPException(status_code=409, detail="Refusing to cancel your own backend.")
        result = client.fetch_one("SELECT pg_cancel_backend(%s) AS cancelled", (pid,))
    sent = bool((result or {}).get("cancelled", False))
    audit("op.cancel", op_id, RiskLevel.MAINTENANCE, settings)
    return OpCancelResult(op_id=op_id, pid=pid, signal_sent=sent, running=True)
