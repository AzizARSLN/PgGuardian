"""Query diagnostics over pg_stat_activity (no pg_stat_statements dependency)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.query import QueryInfo, QueryReport

# Superusers implicitly inherit every role, so this is true for them too.
_READ_ALL_STATS_SQL = (
    "SELECT current_user::text AS db_role,"
    " pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS can_read_all_stats"
)


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


def collect_sessions(client: DbClient, limit: int = 500) -> dict:
    """All backends in any state, with their client address. Errors reach the caller.

    ``state_counts``/``total`` are counted over every session in the cluster, not
    just the returned rows, so the UI counters stay exact when the row list is
    capped. ``limited_visibility`` tells the caller that the connected role may
    not read other users' ``state`` (no superuser/``pg_read_all_stats``):
    PostgreSQL then masks ``state`` as NULL, and ``hidden_count`` says how many
    sessions that affects. ``db_role`` is that role, so the UI can hand out the
    exact GRANT statement that fixes the counters.
    """
    rows = client.fetch_all(load_sql("queries", "sessions"), (limit + 1,))
    counted = client.fetch_all(load_sql("queries", "session_counts"))
    state_counts = [
        {"state": row.get("state"), "count": int(row.get("count") or 0)} for row in counted
    ]
    # NULL state with a client backend = a real session whose state is masked.
    hidden_count = sum(
        int(row.get("client_count") or 0) for row in counted if row.get("state") is None
    )
    db_role, can_read_all_stats = _visibility_probe(client)
    return {
        "sessions": rows[:limit],
        "limit": limit,
        "truncated": len(rows) > limit,
        "state_counts": state_counts,
        "total": sum(item["count"] for item in state_counts),
        "limited_visibility": not can_read_all_stats,
        "hidden_count": hidden_count,
        "db_role": db_role,
    }


def _visibility_probe(client: DbClient) -> tuple[str | None, bool]:
    """The connected role and whether it may inspect every session's state.

    A probe failure must not break the screen, so it falls back to "visible".
    """
    try:
        row = client.fetch_one(_READ_ALL_STATS_SQL) or {}
    except Exception:  # noqa: BLE001
        return None, True
    db_role = row.get("db_role")
    return (str(db_role) if db_role else None), bool(row.get("can_read_all_stats"))


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
