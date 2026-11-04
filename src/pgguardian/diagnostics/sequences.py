"""Sequence exhaustion check (read-only)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient

# Largest value each sequence data type can address. A sequence cannot be given a
# MAXVALUE beyond its own type, so callers use these to reject impossible raises.
INTEGER_LIMITS: dict[str, int] = {
    "smallint": 2**15 - 1,
    "integer": 2**31 - 1,
    "bigint": 2**63 - 1,
}


def collect_sequences(client: DbClient, limit: int = 5000) -> list[dict]:
    """Sequences with an exhaustion status, most critical first.

    ``status`` mirrors the SQL the DBAs run by hand:
    ``MAXIMUMA_ULASTI`` (last value reached the ceiling), ``MAXIMUMA_YAKLASIYOR``
    (>= 90% consumed), ``MINIMUNA_ULASTI`` (descending sequence at its floor) and
    ``NORMAL``. Only sequences that have been used at least once are returned.
    """
    sql = """
    SELECT schemaname AS schema_name, sequencename AS sequence_name,
           data_type, start_value, min_value, max_value, increment_by, last_value,
           cycle,
           CASE
               WHEN increment_by > 0 AND last_value >= max_value THEN 'MAXIMUMA_ULASTI'
               WHEN increment_by > 0 AND last_value >= max_value * 0.90
                   THEN 'MAXIMUMA_YAKLASIYOR'
               WHEN increment_by < 0 AND last_value <= min_value THEN 'MINIMUNA_ULASTI'
               ELSE 'NORMAL'
           END AS status,
           CASE WHEN max_value > 0 AND last_value IS NOT NULL
                THEN last_value::double precision / max_value::double precision * 100
                ELSE 0 END AS usage_percent
    FROM pg_sequences
    WHERE last_value IS NOT NULL
    ORDER BY CASE WHEN last_value >= max_value THEN 1 ELSE 2 END,
             usage_percent DESC NULLS LAST,
             sequencename
    LIMIT %s
    """
    return client.fetch_all(sql, (limit,))
