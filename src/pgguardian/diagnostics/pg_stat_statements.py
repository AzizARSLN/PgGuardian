"""pg_stat_statements diagnostics (optional extension, degrades gracefully)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient


def collect_pg_stat_statements(client: DbClient, limit: int = 20) -> list[dict]:
    """Top queries by total_time from pg_stat_statements, or empty if unavailable."""
    # Use parameterized limit, handle missing extension gracefully
    sql = """
    SELECT query, calls, total_exec_time, mean_exec_time, rows
    FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT %s
    """
    # Fallback for older pg_stat_statements column names (total_time vs total_exec_time)
    try:
        return client.fetch_all(sql, (limit,))
    except Exception:
        try:
            fallback = """
            SELECT query, calls, total_time AS total_exec_time, mean_time AS mean_exec_time, rows
            FROM pg_stat_statements ORDER BY total_time DESC LIMIT %s
            """
            return client.fetch_all(fallback, (limit,))
        except Exception:
            return []
