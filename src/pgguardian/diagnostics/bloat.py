"""Bloat estimation (lightweight, based on dead tuples and fillfactor)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient


def collect_bloat(client: DbClient, limit: int = 20) -> list[dict]:
    """Estimate bloat via dead tuples and size, degrades to empty."""
    sql = """
    SELECT schemaname AS schema_name, relname AS table_name,
           n_live_tup AS live_tuples, n_dead_tup AS dead_tuples,
           pg_total_relation_size(relid) AS total_size_bytes
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000
    ORDER BY n_dead_tup DESC LIMIT %s
    """
    try:
        return client.fetch_all(sql, (limit,))
    except Exception:
        return []
