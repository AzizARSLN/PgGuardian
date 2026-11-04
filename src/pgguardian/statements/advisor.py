"""Rule-based recommendations for one statement.

Each rule looks at metrics, syntax facts, plan nodes and catalog data and returns
codes with evidence. Wording lives in the UI so it can be translated.

Safety levels:
  safe         same results; applied to the suggested SQL
  conditional  same results if the listed precondition holds
  advisory     changes behaviour or needs judgement; a template, never merged
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from pgguardian.database.connection import DbClient
from pgguardian.statements.plan import PlanNode, casted_columns, filter_columns
from pgguardian.statements.sqlast import StatementFacts

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
BLOCK_SIZE = 8192
MIN_ROWS_FOR_INDEX = 10_000

_IN_LIST = re.compile(r"(\b[\w.\"]+)\s+IN\s*\(\s*\$\d+(?:\s*,\s*\$\d+)*\s*\)", re.I)
_ORM_ALIASES = (
    (re.compile(r"\bthis_\.|\b\w+\d+_\.\w+\d+_\b"), "hibernate"),
    (re.compile(r"\b[a-z]\d+_\d+\b|\bt\d+_r\d+\b"), "hibernate_or_sequelize"),
    (re.compile(r"\"Extent\d+\"|\bAS \"[a-z]\"\.|\"[a-z]\"\.\"[A-Z]"), "ef_core"),
    (re.compile(r"\b\w+_\d+\s+AS\s+\w+_\w+_\d+|\banon_\d+\b"), "sqlalchemy"),
    (re.compile(r"\"public\"\.\"\w+\"\.\"\w+\""), "prisma"),
)


@dataclass
class Recommendation:
    """One finding. ``code`` selects the text and application guide in the UI."""

    code: str
    severity: str
    safety: str
    evidence: dict[str, Any] = field(default_factory=dict)
    sql_rewrite: str | None = None
    ddl: str | None = None


@dataclass
class TableContext:
    """Catalog facts about one relation used by the plan."""

    schema: str
    name: str
    estimated_rows: float = 0
    size_bytes: int = 0
    seq_scan: int = 0
    idx_scan: int = 0
    indexes: list[list[str]] = field(default_factory=list)
    columns: dict[str, dict[str, Any]] = field(default_factory=dict)


def load_table_context(client: DbClient, schema: str, table: str) -> TableContext | None:
    row = client.fetch_one(
        "SELECT c.oid, c.reltuples::float8 AS est_rows, pg_table_size(c.oid) AS size_bytes,"
        " COALESCE(s.seq_scan, 0) AS seq_scan, COALESCE(s.idx_scan, 0) AS idx_scan"
        " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid"
        " WHERE n.nspname = %s AND c.relname = %s",
        (schema, table),
    )
    if not row:
        return None
    context = TableContext(
        schema=schema,
        name=table,
        estimated_rows=float(row["est_rows"] or 0),
        size_bytes=int(row["size_bytes"] or 0),
        seq_scan=int(row["seq_scan"] or 0),
        idx_scan=int(row["idx_scan"] or 0),
    )
    indexes = client.fetch_all(
        "SELECT (SELECT array_agg(a.attname ORDER BY k.ord)"
        "   FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)"
        "   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols"
        " FROM pg_index i WHERE i.indrelid = %s AND i.indisvalid",
        (row["oid"],),
    )
    context.indexes = [list(i["cols"]) for i in indexes if i["cols"]]
    columns = client.fetch_all(
        "SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull,"
        " st.n_distinct, st.null_frac FROM pg_attribute a"
        " LEFT JOIN pg_stats st ON st.schemaname = %s AND st.tablename = %s"
        "  AND st.attname = a.attname"
        " WHERE a.attrelid = %s AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        (schema, table, row["oid"]),
    )
    context.columns = {str(c["attname"]): dict(c) for c in columns}
    return context


def _quote(name: str) -> str:
    if re.fullmatch(r"[a-z_][a-z0-9_]*", name):
        return name
    return '"' + name.replace('"', '""') + '"'


def _selectivity(context: TableContext, column: str) -> float | None:
    """Fraction of rows one value matches, from pg_stats (negative n_distinct is a ratio)."""
    distinct = (context.columns.get(column) or {}).get("n_distinct")
    if distinct is None or not context.estimated_rows:
        return None
    distinct = float(distinct)
    if distinct < 0:
        return 1 / max(-distinct * context.estimated_rows, 1)
    return 1 / max(distinct, 1)


def _missing_index(nodes: list[PlanNode], tables: dict[str, TableContext]) -> list[Recommendation]:
    found: list[Recommendation] = []
    for node in nodes:
        if node.node_type != "Seq Scan" or not node.filter or not node.relation:
            continue
        context = tables.get(node.relation)
        if context is None or context.estimated_rows < MIN_ROWS_FOR_INDEX:
            continue
        equal, ranged = filter_columns(node.filter)
        equal = [c for c in equal if c in context.columns]
        ranged = [c for c in ranged if c in context.columns and c not in equal]
        if not equal and not ranged:
            continue
        selective = [(c, _selectivity(context, c)) for c in equal]
        equal = [c for c, s in sorted(selective, key=lambda p: p[1] if p[1] is not None else 1)]
        wanted = equal + ranged[:1]
        if any(index[: len(wanted)] == wanted for index in context.indexes):
            continue
        first = _selectivity(context, wanted[0])
        if first is not None and first > 0.1:
            continue
        name = f"idx_{node.relation}_{'_'.join(wanted)}"[:63]
        columns = ", ".join(_quote(c) for c in wanted)
        found.append(
            Recommendation(
                code="MISSING_INDEX",
                severity="high",
                safety="advisory",
                evidence={
                    "table": f"{context.schema}.{context.name}",
                    "estimated_rows": context.estimated_rows,
                    "size_bytes": context.size_bytes,
                    "seq_scan": context.seq_scan,
                    "idx_scan": context.idx_scan,
                    "filter": node.filter,
                    "columns": wanted,
                    "selectivity": first,
                },
                ddl=(
                    f"CREATE INDEX CONCURRENTLY {_quote(name)}"
                    f" ON {_quote(context.schema)}.{_quote(context.name)} ({columns});"
                ),
            )
        )
    return found


def _implicit_casts(nodes: list[PlanNode], tables: dict[str, TableContext]) -> list[Recommendation]:
    found: list[Recommendation] = []
    for node in nodes:
        context = tables.get(node.relation or "")
        if context is None:
            continue
        for column, cast in casted_columns(node.filter):
            info = context.columns.get(column)
            if info and any(index and index[0] == column for index in context.indexes):
                found.append(
                    Recommendation(
                        code="IMPLICIT_CAST",
                        severity="high",
                        safety="conditional",
                        evidence={
                            "table": context.name,
                            "column": column,
                            "column_type": info.get("data_type"),
                            "cast_type": cast,
                        },
                        sql_rewrite=f"{_quote(column)} = $1::{info.get('data_type')}",
                    )
                )
    return found


def _metric_rules(m: dict[str, Any]) -> list[Recommendation]:
    found: list[Recommendation] = []
    calls = int(m.get("calls") or 0)
    per_min = float(m.get("calls_per_min") or 0)
    rows_per_call = float(m.get("rows_per_call") or 0)
    mean = float(m.get("mean_ms") or 0)
    total = float(m.get("total_ms") or 0)
    load = float(m.get("load_pct") or 0)
    is_read = m.get("kind") in ("SELECT", "WITH", "VALUES", "TABLE")

    if is_read and calls >= 1000 and rows_per_call <= 1.5:
        found.append(
            Recommendation(
                "N_PLUS_1",
                "high" if load >= 5 else "medium",
                "advisory",
                {"calls": calls, "calls_per_min": per_min, "rows_per_call": rows_per_call},
            )
        )
    elif is_read and per_min >= 60 and load >= 1:
        found.append(
            Recommendation(
                "POLLING",
                "medium",
                "advisory",
                {"calls_per_min": per_min, "rows_per_call": rows_per_call, "load_pct": load},
            )
        )
    temp = int(m.get("temp_written") or 0)
    if temp > 0 and calls:
        found.append(
            Recommendation(
                "TEMP_SPILL",
                "medium",
                "advisory",
                {"temp_mb_per_call": round(temp * BLOCK_SIZE / calls / 1048576, 2)},
                sql_rewrite="SET LOCAL work_mem = '64MB';  -- inside the transaction, size to the spill",
            )
        )
    std = float(m.get("stddev_ms") or 0)
    if calls >= 10 and mean > 1 and std / mean > 2:
        found.append(
            Recommendation(
                "HIGH_VARIANCE",
                "medium",
                "advisory",
                {"mean_ms": mean, "stddev_ms": std, "min_ms": m.get("min_ms"), "max_ms": m.get("max_ms")},
            )
        )
    cache = m.get("cache_hit_pct")
    reads = int(m.get("blks_read") or 0)
    if cache is not None and float(cache) < 90 and calls and reads / calls > 100:
        found.append(
            Recommendation(
                "LOW_CACHE",
                "medium",
                "advisory",
                {"cache_hit_pct": float(cache), "blocks_read_per_call": round(reads / calls, 1)},
            )
        )
    wal = float(m.get("wal_bytes") or 0)
    if calls and wal / calls > 1048576:
        found.append(
            Recommendation(
                "WAL_HEAVY", "medium", "advisory", {"wal_mb_per_call": round(wal / calls / 1048576, 2)}
            )
        )
    jit = float(m.get("jit_ms") or 0)
    if total and jit / total > 0.1:
        found.append(
            Recommendation("JIT_OVERHEAD", "low", "advisory", {"jit_pct": round(100 * jit / total, 1)})
        )
    plan_ms = float(m.get("plan_ms") or 0)
    if plan_ms + total and plan_ms / (plan_ms + total) > 0.3:
        found.append(
            Recommendation(
                "PLAN_HEAVY",
                "medium",
                "advisory",
                {"plan_pct": round(100 * plan_ms / (plan_ms + total), 1)},
            )
        )
    return found


def _syntax_rules(
    m: dict[str, Any], f: StatementFacts, tables: dict[str, TableContext], query: str
) -> list[Recommendation]:
    found: list[Recommendation] = []
    rows_per_call = float(m.get("rows_per_call") or 0)
    if f.has_offset:
        found.append(
            Recommendation(
                "OFFSET_PAGING",
                "medium",
                "advisory",
                {},
                sql_rewrite=(
                    "-- needs a unique, indexed sort key; the cursor replaces the page number\n"
                    "SELECT ... FROM ... WHERE (sort_col, id) < ($1, $2)\n"
                    "ORDER BY sort_col DESC, id DESC LIMIT $3;"
                ),
            )
        )
    if f.has_star:
        rewrite = _expand_star(query, f, tables)
        found.append(
            Recommendation(
                "SELECT_STAR",
                "low",
                "conditional",
                {"table": f.star_table, "width": m.get("plan_width")},
                sql_rewrite=rewrite,
            )
        )
    if f.random_sort:
        found.append(
            Recommendation(
                "RANDOM_SORT",
                "medium",
                "advisory",
                {},
                sql_rewrite="SELECT ... FROM t TABLESAMPLE SYSTEM (1) LIMIT $1;  -- distribution differs",
            )
        )
    if f.largest_in_list > 100 or (f.largest_in_list >= 2 and m.get("variants")):
        found.append(
            Recommendation(
                "LARGE_IN",
                "medium",
                "safe",
                {
                    "list_size": f.largest_in_list,
                    "variants": len(m.get("variants") or []),
                    "column": f.in_column,
                },
                sql_rewrite=_collapse_in(query, tables, f),
            )
        )
    if f.functions_on_columns:
        found.append(
            Recommendation(
                "NON_SARGABLE", "medium", "conditional", {"expressions": f.functions_on_columns[:5]}
            )
        )
    if f.leading_wildcard:
        table = f.tables[0] if f.tables else "t"
        column = _quote(f.leading_wildcard[0])
        found.append(
            Recommendation(
                "LEADING_WILDCARD",
                "medium",
                "advisory",
                {"columns": f.leading_wildcard},
                ddl=(
                    "CREATE EXTENSION IF NOT EXISTS pg_trgm;\n"
                    f"CREATE INDEX CONCURRENTLY idx_{table}_{f.leading_wildcard[0]}_trgm"
                    f" ON {_quote(table)} USING gin ({column} gin_trgm_ops);"
                ),
            )
        )
    if f.not_in_subquery:
        found.append(Recommendation("NOT_IN_SUBQUERY", "medium", "conditional", {}))
    if f.correlated_subquery:
        found.append(Recommendation("CORRELATED_SUBQUERY", "medium", "advisory", {}))
    if f.count_compared_to_zero:
        found.append(
            Recommendation(
                "COUNT_FOR_EXISTS",
                "low",
                "conditional",
                {},
                sql_rewrite="SELECT EXISTS (SELECT 1 FROM ... WHERE ...);",
            )
        )
    if f.or_columns:
        found.append(Recommendation("OR_COLUMNS", "low", "advisory", {"columns": f.or_columns}))
    if f.materialized_cte:
        found.append(Recommendation("CTE_MATERIALIZED", "low", "conditional", {}))
    is_read = m.get("kind") in ("SELECT", "WITH")
    if is_read and not f.has_limit and not f.has_aggregate and rows_per_call >= 1000:
        found.append(Recommendation("NO_LIMIT", "medium", "advisory", {"rows_per_call": rows_per_call}))
    return found


def _expand_star(query: str, f: StatementFacts, tables: dict[str, TableContext]) -> str | None:
    context = tables.get(f.star_table or "")
    if context is None or not context.columns:
        return None
    columns = ", ".join(_quote(c) for c in context.columns)
    return re.sub(r"(\bSELECT\s+)\*", lambda m: m.group(1) + columns, query, count=1, flags=re.I)


def _collapse_in(query: str, tables: dict[str, TableContext], f: StatementFacts) -> str:
    column = f.in_column or ""
    data_type = next(
        (t.columns[column]["data_type"] for t in tables.values() if column in t.columns), None
    )
    cast = f"::{data_type}[]" if data_type else ""
    return _IN_LIST.sub(lambda m: f"{m.group(1)} = ANY($1{cast})", query, count=1)


def suggested_sql(query: str, recommendations: list[Recommendation]) -> tuple[str | None, list[str]]:
    """Apply only rewrites that keep results the same. Returns (sql, applied codes)."""
    applied: list[str] = []
    current = query
    for recommendation in recommendations:
        if recommendation.code == "LARGE_IN" and recommendation.sql_rewrite:
            current, applied = recommendation.sql_rewrite, applied + ["LARGE_IN"]
    for recommendation in recommendations:
        if recommendation.code == "SELECT_STAR" and recommendation.sql_rewrite:
            expanded = re.sub(
                r"(\bSELECT\s+)\*",
                lambda m, rewrite=recommendation.sql_rewrite: _star_columns(rewrite or "", m),
                current,
                count=1,
                flags=re.I,
            )
            if expanded != current:
                current, applied = expanded, applied + ["SELECT_STAR"]
    return (current if applied else None), applied


def _star_columns(rewrite: str, match: re.Match[str]) -> str:
    head = re.match(r"\s*SELECT\s+(.*?)\s+FROM\b", rewrite, re.I | re.S)
    return match.group(1) + (head.group(1) if head else "*")


def locate_in_code(query: str, facts: StatementFacts | None, sources: list[dict[str, Any]]) -> dict[str, Any]:
    """PgGuardian cannot read application source; give the DBA ways to find the caller."""
    comment = re.search(r"/\*(.*?)\*/", query, re.S)
    tags: dict[str, str] = {}
    if comment and "=" in comment.group(1):
        for key, value in re.findall(r"(\w+)='([^']*)'", comment.group(1)):
            tags[key] = value
    orm = next((name for pattern, name in _ORM_ALIASES if pattern.search(query)), None)
    tables = facts.tables if facts else []
    fragments = [
        match.group(0)
        for match in re.finditer(r"\b(?:FROM|JOIN|UPDATE|INTO)\s+[\w.\"]+", query, re.I)
    ][:3]
    return {
        "sqlcommenter": tags,
        "orm_hint": orm,
        "tables": tables,
        "search_terms": fragments,
        "applications": sorted({str(s["application_name"]) for s in sources if s.get("application_name")}),
        "clients": sorted({str(s["client_addr"]) for s in sources if s.get("client_addr")}),
    }


def build_recommendations(
    metrics: dict[str, Any],
    facts: StatementFacts | None,
    nodes: list[PlanNode],
    tables: dict[str, TableContext],
) -> list[Recommendation]:
    query = str(metrics.get("query") or "")
    enriched = dict(metrics)
    if nodes:
        enriched["plan_width"] = nodes[0].width
    found = _metric_rules(enriched)
    if facts is not None:
        found += _syntax_rules(enriched, facts, tables, query)
    found += _missing_index(nodes, tables)
    found += _implicit_casts(nodes, tables)
    return sorted(found, key=lambda r: SEVERITY_ORDER.get(r.severity, 3))


def to_dicts(recommendations: list[Recommendation]) -> list[dict[str, Any]]:
    return [asdict(r) for r in recommendations]
