"""Sequence exhaustion check (read-only)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient


def collect_sequences(client: DbClient, limit: int = 100) -> list[dict]:
    """Sequences with usage percent, degrades to empty if unavailable."""
    sql = """
    SELECT sequence_schema AS schema_name, sequence_name,
           last_value, max_value,
           CASE WHEN max_value > 0 THEN (last_value::double precision / max_value::double precision * 100)
                ELSE 0 END AS usage_percent
    FROM information_schema.sequences
    ORDER BY usage_percent DESC LIMIT %s
    """
    try:
        return client.fetch_all(sql, (limit,))
    except Exception:
        # Fallback to pg_sequences
        try:
            fallback = """
            SELECT schemaname AS schema_name, sequencename AS sequence_name,
                   last_value, max_value,
                   CASE WHEN max_value > 0 THEN (last_value::double precision / max_value::double precision * 100)
                        ELSE 0 END AS usage_percent
            FROM pg_sequences ORDER BY usage_percent DESC LIMIT %s
            """
            return client.fetch_all(fallback, (limit,))
        except Exception:
            return []
