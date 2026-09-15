"""Query diagnostics over pg_stat_activity (no pg_stat_statements dependency)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.query import QueryInfo, QueryReport


def map_query(row: dict) -> QueryInfo:
    """Map an active/long-running row to QueryInfo (pure)."""
    duration = row.get("duration_seconds")
    try:
        duration_value = float(duration) if duration is not None else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        duration_value = None
    return QueryInfo(
        pid=int(row.get("pid") or 0),
        duration_seconds=duration_value,
        user=str(row.get("username")) if row.get("username") else None,
        database=str(row.get("database")) if row.get("database") else None,
        state=str(row.get("state")) if row.get("state") else None,
        wait_event_type=str(row.get("wait_event_type")) if row.get("wait_event_type") else None,
        wait_event=str(row.get("wait_event")) if row.get("wait_event") else None,
        query=str(row.get("query")) if row.get("query") else None,
    )


def collect_active_queries(client: DbClient, limit: int = 20) -> QueryReport:
    """Currently active backends ordered by duration; empty on failure."""
    try:
        rows = client.fetch_all(load_sql("queries", "active"), (limit,))
        queries = [map_query(dict(row)) for row in rows]
    except Exception:
        queries = []
    return QueryReport(kind="active", limit=limit, count=len(queries), queries=queries)


def collect_long_running_queries(
    client: DbClient, min_seconds: int = 60, limit: int = 20
) -> QueryReport:
    """Queries running longer than ``min_seconds``; empty on failure."""
    try:
        rows = client.fetch_all(load_sql("queries", "long_running"), (min_seconds, limit))
        queries = [map_query(dict(row)) for row in rows]
    except Exception:
        queries = []
    return QueryReport(kind="long-running", limit=limit, count=len(queries), queries=queries)
