"""Index monitoring endpoints: deep report, findings, alerts and trend history.

Read endpoints mirror the ``pgguardian index-monitor`` collector; the write
endpoints only record a local trend point (they never touch the database).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.database.connection import DbClient
from pgguardian.indexes.history import IndexHistoryStore
from pgguardian.indexes.monitor import collect_monitor
from pgguardian.models.index import (
    IndexAlert,
    IndexMonitorPoint,
    IndexMonitorReport,
)

read_router = APIRouter(prefix="/api/v1/indexes", tags=["indexes"])
router = APIRouter(prefix="/api/v1/indexes", tags=["indexes"])


def _preflight(client: DbClient) -> None:
    settings = client.settings
    with mapped_errors(settings):
        client.ping()


@read_router.get("/monitor", response_model=IndexMonitorReport)
def get_monitor(
    limit: int = 500, client: DbClient = Depends(resolve_client)
) -> IndexMonitorReport:
    """Full index-monitoring report: inventory, findings, suggestions and alerts."""
    _preflight(client)
    with mapped_errors(client.settings):
        return collect_monitor(client, limit=min(limit, 5000))


@read_router.get("/alerts", response_model=list[IndexAlert])
def get_alerts(
    limit: int = 500, client: DbClient = Depends(resolve_client)
) -> list[IndexAlert]:
    """Threshold alerts from a fresh index-monitoring pass."""
    _preflight(client)
    with mapped_errors(client.settings):
        return collect_monitor(client, limit=min(limit, 5000)).alerts


@read_router.get("/history", response_model=list[IndexMonitorPoint])
def get_history(
    profile: str | None = None, database: str | None = None, limit: int = 100
) -> list[IndexMonitorPoint]:
    """Stored index-monitor trend points (newest first)."""
    return IndexHistoryStore().list(
        profile=profile, database=database, limit=min(limit, 5000)
    )


@router.post("/snapshot", response_model=IndexMonitorReport)
def take_snapshot(
    profile: str | None = None, client: DbClient = Depends(resolve_client)
) -> IndexMonitorReport:
    """Collect the current index report and record a local trend point."""
    _preflight(client)
    with mapped_errors(client.settings):
        report = collect_monitor(client)
        IndexHistoryStore().save_report(report, profile=profile)
        return report


@router.post("/prune")
def prune_history(keep_days: int = 90, confirm: bool = False) -> dict:
    """Delete index-history points older than ``keep_days`` (needs ``?confirm=true``)."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pruning history needs ?confirm=true.")
    removed = IndexHistoryStore().prune(keep_days=keep_days)
    return {"removed": removed, "keep_days": keep_days}
