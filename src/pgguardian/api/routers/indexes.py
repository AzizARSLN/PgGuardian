"""Index monitoring endpoints: deep report, findings, alerts and trend history.

Read endpoints mirror the ``pgguardian index-monitor`` collector; the write
endpoints only record a local trend point (they never touch the database).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.api.ops import op_application_name, validate_op_id
from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.indexes.history import IndexHistoryStore
from pgguardian.indexes.monitor import collect_monitor
from pgguardian.models.index import (
    IndexAlert,
    IndexCreateProgress,
    IndexMonitorPoint,
    IndexMonitorReport,
)
from pgguardian.utils.formatting import to_float, to_int

read_router = APIRouter(prefix="/api/v1/indexes", tags=["indexes"])
router = APIRouter(prefix="/api/v1/indexes", tags=["indexes"])


def _preflight(client: DbClient) -> None:
    settings = client.settings
    with mapped_errors(settings):
        client.ping()


def _parse_dt(value: object) -> datetime | None:
    """Best-effort conversion of a driver value to ``datetime``."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def collect_create_progress(client: DbClient, op_id: str | None = None) -> list[IndexCreateProgress]:
    """Live CREATE INDEX / REINDEX progress (optionally for one ``op_id``)."""
    app = op_application_name(op_id) if op_id else None
    rows = client.fetch_all(load_sql("indexes", "create_progress"), (app, app))
    result: list[IndexCreateProgress] = []
    for row in rows:
        elapsed = row.get("elapsed_seconds")
        blocking = row.get("blocking_pids") or []
        result.append(
            IndexCreateProgress(
                pid=to_int(row.get("pid")),
                database_name=str(row["database_name"]) if row.get("database_name") else None,
                table_name=str(row["table_name"]) if row.get("table_name") else None,
                index_name=str(row["index_name"]) if row.get("index_name") else None,
                command=str(row["command"]) if row.get("command") else None,
                phase=str(row["phase"]) if row.get("phase") else None,
                lockers_total=to_int(row.get("lockers_total")),
                lockers_done=to_int(row.get("lockers_done")),
                blocks_total=to_int(row.get("blocks_total")),
                blocks_done=to_int(row.get("blocks_done")),
                tuples_total=to_int(row.get("tuples_total")),
                tuples_done=to_int(row.get("tuples_done")),
                partitions_total=to_int(row.get("partitions_total")),
                partitions_done=to_int(row.get("partitions_done")),
                elapsed_seconds=to_float(elapsed) if elapsed is not None else None,
                started_at=_parse_dt(row.get("query_start")),
                wait_event_type=str(row["wait_event_type"]) if row.get("wait_event_type") else None,
                wait_event=str(row["wait_event"]) if row.get("wait_event") else None,
                username=str(row["username"]) if row.get("username") else None,
                application_name=str(row["application_name"]) if row.get("application_name") else None,
                client_addr=str(row["client_addr"]) if row.get("client_addr") else None,
                state=str(row["state"]) if row.get("state") else None,
                blocking_pids=[to_int(pid) for pid in blocking],
                query=str(row["query"]) if row.get("query") else None,
            )
        )
    return result


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


@read_router.get("/create-progress", response_model=list[IndexCreateProgress])
def get_create_progress(
    op_id: str | None = None, client: DbClient = Depends(resolve_client)
) -> list[IndexCreateProgress]:
    """Live CREATE INDEX / REINDEX progress from ``pg_stat_progress_create_index``.

    Pass ``?op_id=`` to follow one pgGuardian operation; omit it to list every
    index build currently running on the server.
    """
    tracked = validate_op_id(op_id) if op_id else None
    _preflight(client)
    with mapped_errors(client.settings):
        return collect_create_progress(client, tracked)


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
