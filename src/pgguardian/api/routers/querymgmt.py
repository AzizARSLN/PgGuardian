"""Backend control endpoints: cancel/terminate (guarded, never automatic)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.utils.formatting import to_int

router = APIRouter(prefix="/api/v1/queries", tags=["querymgmt"])


class BackendActionResult(BaseModel):
    """Outcome of a cancel/terminate call."""

    model_config = ConfigDict(frozen=True)

    pid: int
    action: str
    signal_sent: bool


def _self_pid(client: DbClient) -> int:
    row = client.fetch_one("SELECT pg_backend_pid() AS pid")
    return to_int((row or {}).get("pid"))


@router.post("/{pid}/cancel", response_model=DryRunResult | BackendActionResult)
def cancel_backend(
    pid: int,
    body: MutationRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | BackendActionResult:
    """Cancel a running query: pg_cancel_backend (MAINTENANCE)."""
    ensure_writes_allowed(settings, "query.cancel")
    if pid <= 0:
        raise HTTPException(status_code=400, detail="PID must be positive.")
    if body.dry_run:
        return DryRunResult(
            action="query.cancel",
            risk=RiskLevel.MAINTENANCE,
            sql=[f"SELECT pg_cancel_backend({pid})"],
            target=str(pid),
        )
    require_confirm(body, "query.cancel")
    with mapped_errors(settings):
        client.ping()
        if pid == _self_pid(client):
            raise HTTPException(status_code=409, detail="Refusing to cancel your own backend.")
        row = client.fetch_one("SELECT pg_cancel_backend(%s) AS cancelled", (pid,))
    sent = bool((row or {}).get("cancelled", False))
    audit("query.cancel", str(pid), RiskLevel.MAINTENANCE, settings)
    return BackendActionResult(pid=pid, action="cancel", signal_sent=sent)


@router.post("/{pid}/terminate", response_model=DryRunResult | BackendActionResult)
def terminate_backend(
    pid: int,
    body: MutationRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | BackendActionResult:
    """Terminate a backend: pg_terminate_backend (DANGEROUS, confirm_name=pid)."""
    ensure_dangerous_allowed(settings, "query.terminate")
    if pid <= 0:
        raise HTTPException(status_code=400, detail="PID must be positive.")
    if body.dry_run:
        return DryRunResult(
            action="query.terminate",
            risk=RiskLevel.DANGEROUS,
            sql=[f"SELECT pg_terminate_backend({pid})"],
            target=str(pid),
        )
    require_confirm(body, "query.terminate", target=str(pid))
    with mapped_errors(settings):
        client.ping()
        if pid == _self_pid(client):
            raise HTTPException(status_code=409, detail="Refusing to terminate your own backend.")
        row = client.fetch_one("SELECT pg_terminate_backend(%s) AS terminated", (pid,))
    sent = bool((row or {}).get("terminated", False))
    audit("query.terminate", str(pid), RiskLevel.DANGEROUS, settings)
    return BackendActionResult(pid=pid, action="terminate", signal_sent=sent)
