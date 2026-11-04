"""Sequence exhaustion check (read-only)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient


def collect_sequences(client: DbClient, limit: int = 5000) -> list[dict]:
    """Sequences with usage percent, most exhausted first; unused ones report 0."""
    sql = """
    SELECT schemaname AS schema_name, sequencename AS sequence_name,
           last_value, max_value,
           CASE WHEN max_value > 0 AND last_value IS NOT NULL
                THEN last_value::double precision / max_value::double precision * 100
                ELSE 0 END AS usage_percent
    FROM pg_sequences ORDER BY usage_percent DESC NULLS LAST LIMIT %s
    """
    try:
        return client.fetch_all(sql, (limit,))
    except Exception:
        return []
