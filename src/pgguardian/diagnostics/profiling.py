"""Per-table profiling for data scientist use (nulls, distinct, avg width)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient


def profile_table(
    client: DbClient, schema: str, table: str, sample_limit: int = 1000
) -> list[dict]:
    """Profile columns: nulls, distinct, avg width (capped)."""
    # Use information_schema plus pg_stats for distinct if available
    sql = """
    SELECT column_name, data_type, is_nullable,
           (SELECT count(*) FROM information_schema.columns c2 WHERE c2.table_schema=%s AND c2.table_name=%s) AS total_cols
    FROM information_schema.columns
    WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position
    """
    try:
        cols = client.fetch_all(sql, (schema, table, schema, table))
    except Exception:
        return []
    result: list[dict] = []
    for col in cols:
        col_name = str(col.get("column_name"))
        # For each column, get null count and distinct via sampled query
        try:
            # Use safe quoted identifiers (validated upstream)
            safe_sql = f'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "{col_name}" IS NULL) AS nulls, COUNT(DISTINCT "{col_name}") AS distinct_cnt, AVG(LENGTH("{col_name}"::text))::int AS avg_width FROM "{schema}"."{table}"'
            stats = client.fetch_one(safe_sql)
            if stats:
                result.append(
                    {
                        "column": col_name,
                        "data_type": col.get("data_type"),
                        "nullable": col.get("is_nullable") == "YES",
                        "total": stats.get("total"),
                        "nulls": stats.get("nulls"),
                        "distinct": stats.get("distinct_cnt"),
                        "avg_width": stats.get("avg_width"),
                    }
                )
                if len(result) >= sample_limit:
                    break
        except Exception:
            result.append(
                {
                    "column": col_name,
                    "data_type": col.get("data_type"),
                    "nullable": col.get("is_nullable") == "YES",
                    "error": "unavailable",
                }
            )
    return result
