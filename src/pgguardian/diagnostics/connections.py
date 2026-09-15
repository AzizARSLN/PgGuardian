"""Connection diagnostics over pg_stat_activity."""

from __future__ import annotations

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.connection import (
    ConnectionInfo,
    ConnectionReport,
    ConnectionSummary,
    compute_usage_percent,
)
from pgguardian.utils.formatting import to_float as _float


def _text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None


def map_connection(row: dict) -> ConnectionInfo:
    """Map a ``connections/list`` row to ConnectionInfo (pure)."""
    return ConnectionInfo(
        pid=int(row.get("pid") or 0),
        user=_text(row.get("username")),
        database=_text(row.get("database")),
        client_address=_text(row.get("client_address")),
        application_name=_text(row.get("application_name")),
        backend_type=_text(row.get("backend_type")),
        state=_text(row.get("state")),
        wait_event_type=_text(row.get("wait_event_type")),
        wait_event=_text(row.get("wait_event")),
        query_duration_seconds=_float(row.get("query_duration_seconds")),
        transaction_duration_seconds=_float(row.get("transaction_duration_seconds")),
        query=_text(row.get("query")),
    )


def summarize_connections(rows: list[dict], max_connections: int) -> ConnectionSummary:
    """Build a summary from raw rows (pure, safe for empty input)."""
    by_state: dict[str, int] = {}
    for row in rows:
        state = str(row.get("state") or "unknown")
        by_state[state] = by_state.get(state, 0) + 1
    total = sum(by_state.values())
    waiting = sum(1 for row in rows if row.get("wait_event_type") is not None)
    return ConnectionSummary(
        current_connections=total,
        max_connections=max_connections or 0,
        usage_percent=compute_usage_percent(total, max_connections or 0),
        active=by_state.get("active", 0),
        idle=by_state.get("idle", 0),
        idle_in_transaction=by_state.get("idle in transaction", 0),
        waiting=waiting,
        by_state=by_state,
    )


def collect_connections(client: DbClient, limit: int = 20) -> ConnectionReport:
    """Fetch the connection list plus summary; degrades to empty on failure."""
    summary = ConnectionSummary()
    connections: list[ConnectionInfo] = []
    try:
        row = client.fetch_one(load_sql("connections", "summary"))
        if row:
            max_conn = int(row.get("max_connections") or 0)
            total = int(row.get("total_connections") or 0)
            summary = ConnectionSummary(
                current_connections=total,
                max_connections=max_conn,
                usage_percent=compute_usage_percent(total, max_conn),
                active=int(row.get("active_connections") or 0),
                idle=int(row.get("idle_connections") or 0),
                idle_in_transaction=int(row.get("idle_in_transaction") or 0),
                waiting=int(row.get("waiting_connections") or 0),
                by_state={
                    "active": int(row.get("active_connections") or 0),
                    "idle": int(row.get("idle_connections") or 0),
                    "idle in transaction": int(row.get("idle_in_transaction") or 0),
                },
            )
    except Exception:
        pass
    try:
        rows = client.fetch_all(load_sql("connections", "list"), (limit,))
        connections = [map_connection(dict(row)) for row in rows]
    except Exception:
        connections = []
    return ConnectionReport(summary=summary, connections=connections)
