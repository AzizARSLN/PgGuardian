"""Per-database statement metrics from pg_stat_statements.

Columns are read from the installed view instead of being inferred from the
server version: after pg_upgrade the extension can lag behind the server.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from psycopg import errors as pgerrors
from psycopg.sql import SQL, Composable, Identifier, Literal

from pgguardian.database.connection import DbClient

SORT_COLUMNS = {
    "total_time": "total_ms",
    "mean_time": "mean_ms",
    "calls": "calls",
    "calls_per_min": "calls_per_min",
    "rows_per_call": "rows_per_call",
    "io": "blks_read",
    "temp": "temp_written",
    "wal": "wal_bytes",
    "load": "load_pct",
}

_WRITE_PREFIX = r"^\s*(/\*.*?\*/\s*)*(select|with|insert|update|delete|merge|values|table)\y"
_KIND = re.compile(r"^\s*(?:/\*.*?\*/\s*)*([a-zA-Z]+)", re.S)
_IN_LIST = re.compile(r"\bIN\s*\(\s*\$\d+(?:\s*,\s*\$\d+)*\s*\)", re.I)


def _exists(columns: set[str], *names: str) -> str | None:
    return next((name for name in names if name in columns), None)


def status(client: DbClient) -> dict[str, Any]:
    """Report whether statement metrics can be read on the connected database."""
    db = client.fetch_one(
        "SELECT current_database() AS database,"
        " current_setting('server_version_num')::int AS server_version_num"
    ) or {}
    result: dict[str, Any] = {
        "database": db.get("database"),
        "server_version_num": db.get("server_version_num"),
        "state": "ok",
        "extension_version": None,
        "schema": None,
        "columns": [],
        "stats_since": None,
        "dealloc": None,
        "track_planning": None,
        "warnings": [],
    }
    ext = client.fetch_one(
        "SELECT n.nspname AS schema, e.extversion AS version FROM pg_extension e"
        " JOIN pg_namespace n ON n.oid = e.extnamespace"
        " WHERE e.extname = 'pg_stat_statements'"
    )
    if not ext:
        result["state"] = "not_installed"
        return result
    schema = str(ext["schema"])
    result["schema"] = schema
    result["extension_version"] = ext["version"]
    rows = client.fetch_all(
        "SELECT attname FROM pg_attribute WHERE attrelid = format('%%I.pg_stat_statements', %s::text)"
        "::regclass AND attnum > 0 AND NOT attisdropped",
        (schema,),
    )
    result["columns"] = [str(row["attname"]) for row in rows]
    try:
        client.fetch_one(
            SQL("SELECT queryid FROM {}.pg_stat_statements LIMIT 1").format(Identifier(schema))
        )
    except pgerrors.ObjectNotInPrerequisiteState:
        result["state"] = "not_preloaded"
        return result
    role = client.fetch_one(
        "SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)"
        " OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS full_access"
    )
    if not (role or {}).get("full_access"):
        result["warnings"].append("limited_privilege")
    planning = client.fetch_one(
        "SELECT current_setting('pg_stat_statements.track_planning', true) AS v"
    )
    result["track_planning"] = (planning or {}).get("v") == "on"
    has_info = client.fetch_one(
        "SELECT to_regclass(format('%%I.pg_stat_statements_info', %s::text)) IS NOT NULL AS ok",
        (schema,),
    )
    if (has_info or {}).get("ok"):
        info = client.fetch_one(
            SQL("SELECT dealloc, stats_reset FROM {}.pg_stat_statements_info").format(
                Identifier(schema)
            )
        ) or {}
        result["dealloc"] = info.get("dealloc")
        result["stats_since"] = info.get("stats_reset")
        if int(info.get("dealloc") or 0) > 0:
            result["warnings"].append("evictions")
    else:
        result["warnings"].append("no_reset_time")
    return result


def _metric_query(info: dict[str, Any]) -> Composable:
    columns = set(info["columns"])

    def col(*names: str) -> Composable:
        found = _exists(columns, *names)
        return Identifier(found) if found else SQL("NULL::float8")

    since = _exists(columns, "stats_since")
    reset = info.get("stats_since")
    window_start: Composable = (
        SQL("COALESCE(since, {})").format(Literal(reset)) if since or reset else SQL("NULL::timestamptz")
    )
    toplevel = SQL(" AND toplevel") if "toplevel" in columns else SQL("")
    return SQL(
        """
        WITH s AS (
          SELECT queryid::text AS queryid, max(query) AS query,
                 array_agg(DISTINCT userid::regrole::text) AS users,
                 sum(calls)::bigint AS calls,
                 sum({total})::float8 AS total_ms,
                 min({min_t})::float8 AS min_ms,
                 max({max_t})::float8 AS max_ms,
                 sqrt(greatest(
                   sum(calls * ({std}^2 + {mean}^2)) / nullif(sum(calls), 0)
                   - (sum({total}) / nullif(sum(calls), 0))^2, 0))::float8 AS stddev_ms,
                 sum(rows)::bigint AS rows_total,
                 sum(shared_blks_hit)::bigint AS blks_hit,
                 sum(shared_blks_read)::bigint AS blks_read,
                 sum(shared_blks_dirtied)::bigint AS blks_dirtied,
                 sum(temp_blks_written)::bigint AS temp_written,
                 sum({wal})::float8 AS wal_bytes,
                 sum({plan})::float8 AS plan_ms,
                 sum({blk_read})::float8 AS io_read_ms,
                 sum({jit})::float8 AS jit_ms,
                 min({since}) AS since
          FROM {schema}.pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND queryid IS NOT NULL{toplevel}
          GROUP BY queryid
        )
        SELECT s.*,
               total_ms / nullif(calls, 0) AS mean_ms,
               rows_total::float8 / nullif(calls, 0) AS rows_per_call,
               100.0 * blks_hit / nullif(blks_hit + blks_read, 0) AS cache_hit_pct,
               100.0 * total_ms / nullif(sum(total_ms) OVER (), 0) AS load_pct,
               calls / nullif(extract(epoch FROM now() - {window_start}) / 60, 0)
                 AS calls_per_min,
               sum(total_ms) OVER () AS db_total_ms,
               sum(calls) OVER () AS db_total_calls
        FROM s
        """
    ).format(
        total=col("total_exec_time", "total_time"),
        min_t=col("min_exec_time", "min_time"),
        max_t=col("max_exec_time", "max_time"),
        std=col("stddev_exec_time", "stddev_time"),
        mean=col("mean_exec_time", "mean_time"),
        wal=col("wal_bytes"),
        plan=col("total_plan_time"),
        blk_read=col("shared_blk_read_time", "blk_read_time"),
        jit=_jit_expression(columns),
        since=col("stats_since") if since else SQL("NULL::timestamptz"),
        schema=Identifier(info["schema"]),
        toplevel=toplevel,
        window_start=window_start,
    )


def _jit_expression(columns: set[str]) -> Composable:
    parts = [
        name
        for name in (
            "jit_generation_time",
            "jit_inlining_time",
            "jit_optimization_time",
            "jit_emission_time",
        )
        if name in columns
    ]
    if not parts:
        return SQL("NULL::float8")
    return SQL(" + ").join(Identifier(name) for name in parts)


def _clean(row: dict[str, Any]) -> dict[str, Any]:
    cleaned = {k: float(v) if isinstance(v, Decimal) else v for k, v in row.items()}
    cleaned.pop("db_total_ms", None)
    cleaned.pop("db_total_calls", None)
    match = _KIND.match(str(cleaned.get("query") or ""))
    cleaned["kind"] = match.group(1).upper() if match else "OTHER"
    cleaned["fingerprint"] = fingerprint(str(cleaned.get("query") or ""))
    return cleaned


def fingerprint(query: str) -> str:
    """Collapse IN lists and whitespace so variants of one statement group together."""
    collapsed = _IN_LIST.sub("IN (...)", query)
    return re.sub(r"\s+", " ", collapsed).strip().lower()


def list_statements(
    client: DbClient,
    info: dict[str, Any],
    *,
    sort: str = "calls",
    descending: bool = True,
    limit: int = 100,
    offset: int = 0,
    min_calls: int = 2,
    search: str | None = None,
    user: str | None = None,
    include_utility: bool = False,
) -> dict[str, Any]:
    """Statements of the current database with totals, excluding our own probes."""
    filters: list[Composable] = [
        SQL("query NOT ILIKE {}").format(Literal("%pg_stat_statements%")),
        SQL("calls >= {}").format(Literal(min_calls)),
    ]
    if search:
        filters.append(SQL("query ILIKE {}").format(Literal(f"%{search}%")))
    if user:
        filters.append(SQL("{} = ANY(users)").format(Literal(user)))
    if not include_utility:
        filters.append(SQL("query ~* {}").format(Literal(_WRITE_PREFIX)))
    base = _metric_query(info)
    query = SQL(
        "SELECT * FROM ({base}) m WHERE {where} ORDER BY {sort} {direction} NULLS LAST"
        " LIMIT {limit} OFFSET {offset}"
    ).format(
        base=base,
        where=SQL(" AND ").join(filters),
        sort=Identifier(SORT_COLUMNS[sort]),
        direction=SQL("DESC" if descending else "ASC"),
        limit=Literal(limit),
        offset=Literal(offset),
    )
    rows = client.fetch_all(query)
    count = client.fetch_one(
        SQL("SELECT count(*) AS n, max(db_total_ms) AS total_ms, max(db_total_calls) AS calls"
            " FROM ({base}) m WHERE {where}").format(base=base, where=SQL(" AND ").join(filters))
    ) or {}
    return {
        "totals": {
            "statements": int(count.get("n") or 0),
            "total_ms": float(count.get("total_ms") or 0),
            "calls": int(count.get("calls") or 0),
        },
        "items": [_clean(row) for row in rows],
    }


def get_statement(client: DbClient, info: dict[str, Any], queryid: str) -> dict[str, Any] | None:
    """One statement, with IN-list variants and the sessions currently running it."""
    base = _metric_query(info)
    row = client.fetch_one(
        SQL("SELECT * FROM ({base}) m WHERE queryid = {qid}").format(
            base=base, qid=Literal(queryid)
        )
    )
    if row is None:
        return None
    statement = _clean(row)
    others = client.fetch_all(
        SQL("SELECT queryid, query, calls, total_ms FROM ({base}) m WHERE queryid <> {qid}"
            " ORDER BY total_ms DESC NULLS LAST LIMIT 1000").format(base=base, qid=Literal(queryid))
    )
    statement["variants"] = [
        {"queryid": o["queryid"], "calls": o["calls"], "total_ms": o["total_ms"]}
        for o in others
        if fingerprint(str(o["query"])) == statement["fingerprint"]
    ]
    statement["sources"] = _sources(client, queryid, int(info.get("server_version_num") or 0))
    return statement


def _sources(client: DbClient, queryid: str, version: int) -> list[dict[str, Any]]:
    # query_id exists from PG14 and needs compute_query_id. Query text is left out
    # on purpose: it holds real parameter values.
    if version < 140000:
        return []
    try:
        return client.fetch_all(
            "SELECT application_name, client_addr::text AS client_addr, usename,"
            " count(*)::int AS sessions FROM pg_stat_activity WHERE query_id = %s::bigint"
            " GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 20",
            (queryid,),
        )
    except Exception:
        return []
