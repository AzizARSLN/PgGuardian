"""Turn parsed report data into findings with work for each role.

A finding keeps a code and values; wording comes from catalog.py at read time, so
the saved analysis can be shown and exported in any language. Everything is derived
from the report by rules, nothing leaves this machine.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from typing import Any

import sqlglot
from sqlglot import exp

from pgguardian.pgbadger.parser import duration_ms, size_bytes, to_int

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
QUERY_FINDING_LIMIT = 15
MIN_QUERY_SHARE = 0.5
WIDE_SELECT_COLUMNS = 25
MANY_JOINS = 6
HOUR_MS = 3_600_000

# First match wins. Unlisted ERROR and FATAL lines end up in OTHER_ERRORS.
EVENT_RULES: list[tuple[str, str]] = [
    (r"reached maximum value of sequence", "SEQUENCE_EXHAUSTED"),
    (r"deadlock detected", "DEADLOCK"),
    (r"out of memory|no space left|could not (extend|write)", "RESOURCE_EXHAUSTED"),
    (r"too many clients|remaining connection slots", "TOO_MANY_CONNECTIONS"),
    (r"still waiting for", "LOCK_WAITS"),
    (r"canceling statement due to lock timeout", "LOCK_TIMEOUT"),
    (r"current transaction is aborted", "TX_ABORTED"),
    (r"duplicate key value", "DUPLICATE_KEY"),
    (r"canceling statement due to user request", "USER_CANCEL"),
    (r"canceling statement due to statement timeout", "STATEMENT_TIMEOUT"),
    (r"cannot analyze non-tables", "ANALYZE_NON_TABLES"),
    (
        r"(relation|column|function) .* does not exist|syntax error|must appear in the GROUP BY"
        r"|is not unique|already in use",
        "SQL_ERRORS",
    ),
    (
        r"violates (not-null|foreign key|check) constraint|value too long|cannot truncate",
        "DATA_ERRORS",
    ),
    (r"idle-in-transaction timeout", "IDLE_TX_TIMEOUT"),
    (r"idle-session timeout", "IDLE_SESSION_TIMEOUT"),
    (r"connection reset by peer|broken pipe|connection to client lost", "CLIENT_DISCONNECTS"),
    (r"canceling authentication due to timeout|password authentication failed", "AUTH_PROBLEMS"),
    (r"terminating (background worker|connection) .*administrator command", "ADMIN_TERMINATIONS"),
]


def format_duration(ms: float) -> str:
    seconds = int(ms // 1000)
    if seconds < 60:
        return f"{ms / 1000:.1f} s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    if hours < 48:
        return f"{hours} h {minutes % 60} min"
    return f"{hours // 24} d {hours % 24} h"


def format_size(value: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024:
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} TiB"


def _fingerprint(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip().lower()


def _sql_id(sql: str) -> str:
    return hashlib.sha256(_fingerprint(sql).encode()).hexdigest()[:10]


def _peak_hour(hours: list[dict[str, Any]]) -> str | None:
    if not hours:
        return None
    return max(hours, key=lambda h: (h.get("ms") or 0, h.get("count") or 0))["hour"] + ":00"


def _window_hours(parsed: dict[str, Any]) -> float:
    def clock(value: str) -> float | None:
        match = re.search(r"(\d{2}):(\d{2}):(\d{2})$", value or "")
        if not match:
            return None
        return int(match[1]) + int(match[2]) / 60 + int(match[3]) / 3600

    first, last = clock(parsed.get("first_query", "")), clock(parsed.get("last_query", ""))
    if first is None or last is None:
        return 0
    same_day = (parsed.get("first_query") or "")[:10] == (parsed.get("last_query") or "")[:10]
    return last - first if same_day and last > first else 0


def classify_app(name: str) -> str:
    lowered = (name or "").lower()
    if not lowered or lowered == "unknown":
        return "unknown"
    if "test" in lowered:
        return "test"
    if lowered.startswith(("pg_dump", "pgbackrest", "pg_basebackup", "barman", "pg_restore")):
        return "backup"
    if lowered.startswith(("pg_cron", "pgagent")):
        return "job"
    if lowered.startswith(("dbeaver", "psql", "pgadmin", "datagrip", "navicat")):
        return "tool"
    return "application"


def _parseable(sql: str) -> str:
    """pgBadger's normalized text as valid SQL.

    A literal fits everywhere a parameter can stand ("?" is an operator here), and
    pgBadger prints lists as IN (...) and concatenation as | |.
    """
    text = re.sub(r"\(\s*\.\.\.\s*\)", "(?)", sql).replace("| |", "||")
    return text.replace("?", " '0' ")


def statement_traits(sql: str) -> dict[str, Any]:
    """What a normalized statement looks like, from its syntax tree."""
    traits: dict[str, Any] = {"traits": [], "tables": [], "index": []}
    lowered = _fingerprint(sql)
    if lowered.startswith(("call ", "select * from ")) and "(" in lowered[:80] and " join " not in lowered:
        if lowered.startswith("call "):
            traits["traits"].append("ROUTINE")
            traits["tables"] = [lowered[5:].split("(")[0].strip()]
            return traits
    try:
        tree = sqlglot.parse_one(
            _parseable(sql), dialect="postgres", error_level=sqlglot.ErrorLevel.IGNORE
        )
    except Exception:
        traits["traits"].append("UNPARSED")
        return traits
    if tree is None:
        return traits
    cte_names = {cte.alias for cte in tree.find_all(exp.CTE)}
    tables = [t for t in tree.find_all(exp.Table) if t.name and t.name not in cte_names]
    traits["tables"] = sorted({t.name.lower() for t in tables})
    selected = tree if isinstance(tree, exp.Select) else tree.find(exp.Select)
    found: list[str] = []
    if isinstance(selected, exp.Select):
        columns = len(selected.expressions)
        traits["columns"] = columns
        if columns >= WIDE_SELECT_COLUMNS or any(e.is_star for e in selected.expressions):
            found.append("WIDE_SELECT")
        if selected.args.get("distinct") is not None:
            found.append("DISTINCT")
        expressions = [e.unalias() for e in selected.expressions]
        is_count = len(expressions) == 1 and isinstance(expressions[0], exp.Count)
        if is_count:
            found.append("COUNT_ONLY")
        aggregated = selected.find(exp.AggFunc) is not None or bool(selected.args.get("group"))
        limited = selected.args.get("limit") is not None
        if not limited and not aggregated and not _filters_on_id(selected):
            found.append("NO_LIMIT")
        if selected.args.get("offset") is not None:
            found.append("OFFSET")
    joins = len(list(tree.find_all(exp.Join)))
    comma_tables = max(len(tables) - joins - 1, 0)
    traits["joins"] = joins + comma_tables
    if traits["joins"] >= MANY_JOINS:
        found.append("MANY_JOINS")
    if any(
        isinstance(s, exp.Select) and s.parent_select is not None for s in tree.find_all(exp.Select)
    ):
        found.append("SUBQUERIES")
    where_nodes = list(tree.find_all(exp.Where))
    for where in where_nodes:
        for compare in where.find_all(exp.EQ, exp.GT, exp.GTE, exp.LT, exp.LTE, exp.Like, exp.ILike):
            left = compare.this
            if isinstance(left, (exp.Func, exp.Cast)) and left.find(exp.Column) is not None:
                if "FUNC_ON_COLUMN" not in found:
                    found.append("FUNC_ON_COLUMN")
            if isinstance(compare, (exp.Like, exp.ILike)) and "TEXT_SEARCH" not in found:
                found.append("TEXT_SEARCH")
        if where.find(exp.Or) is not None and "OR_CONDITION" not in found:
            found.append("OR_CONDITION")
    if re.search(r"\bfrom\s+\S+\s+t\d+\b|\bt\d+\.\w+", lowered):
        found.append("ORM_GENERATED")
    traits["traits"] = found
    traits["index"] = _index_candidates(tree, tables)
    return traits


def _filters_on_id(select: exp.Select) -> bool:
    where = select.args.get("where")
    if where is None:
        return False
    return any(
        isinstance(compare.this, exp.Column) and compare.this.name.lower() in ("id", "kodu")
        for compare in where.find_all(exp.EQ)
    )


def _index_candidates(tree: exp.Expression, tables: list[exp.Table]) -> list[dict[str, Any]]:
    """Columns compared to a parameter, equality first. Candidates, never conclusions."""
    aliases = {t.alias_or_name.lower(): t.name.lower() for t in tables}
    only = tables[0].name.lower() if len(tables) == 1 else None
    wanted: dict[str, dict[str, list[str]]] = {}
    for where in tree.find_all(exp.Where):
        for compare in where.find_all(exp.EQ, exp.GT, exp.GTE, exp.LT, exp.LTE):
            if compare.find_ancestor(exp.Or) is not None:
                continue
            left, right = compare.this, compare.expression
            if isinstance(right, exp.Column) and not isinstance(left, exp.Column):
                left, right = right, left
            if not isinstance(left, exp.Column) or isinstance(right, exp.Column):
                continue
            if right.find(exp.Column) is not None:
                continue
            table = aliases.get(left.table.lower()) if left.table else only
            if not table:
                continue
            kind = "equal" if isinstance(compare, exp.EQ) else "range"
            bucket = wanted.setdefault(table, {"equal": [], "range": []})
            if left.name.lower() not in bucket[kind]:
                bucket[kind].append(left.name.lower())
    candidates = []
    for table, columns in wanted.items():
        ordered = columns["equal"][:3] + [c for c in columns["range"][:1] if c not in columns["equal"]]
        if ordered and ordered != ["id"]:
            candidates.append({"table": table, "columns": ordered})
    return candidates


def _collect_statements(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """time consuming + frequent + slow + temp lists merged by statement."""
    merged: dict[str, dict[str, Any]] = {}
    for source in ("time_consuming", "most_frequent", "normalized_slowest"):
        for row in parsed.get(source, []):
            if not row.get("sql"):
                continue
            item = merged.setdefault(_fingerprint(row["sql"]), {**row, "sources": []})
            item["sources"].append(source)
    for row in parsed.get("temp_most", []):
        if row.get("sql"):
            item = merged.setdefault(
                _fingerprint(row["sql"]),
                {**row, "total_ms": 0, "calls": 0, "avg_ms": 0, "max_ms": 0, "sources": []},
            )
            item["temp_bytes"] = row.get("total_bytes", 0)
            item["temp_count"] = row.get("count", 0)
    return sorted(merged.values(), key=lambda s: s.get("total_ms", 0), reverse=True)


def _query_findings(
    parsed: dict[str, Any], lookup: Callable[[str], dict[str, Any] | None] | None
) -> list[dict[str, Any]]:
    total = parsed.get("total_query_ms") or 1
    findings = []
    for statement in _collect_statements(parsed):
        apps = statement.get("apps") or []
        names = [a["name"] for a in apps]
        if names and all(classify_app(n) == "backup" for n in names):
            continue  # Reported together as BACKUP_WINDOW.
        share = 100 * statement.get("total_ms", 0) / total
        has_temp = statement.get("temp_bytes", 0) > 0
        if (share < MIN_QUERY_SHARE and not has_temp) or len(findings) >= QUERY_FINDING_LIMIT:
            continue
        shape = statement_traits(statement["sql"])
        traits = list(shape["traits"])
        calls = statement.get("calls", 0)
        if calls >= 300:
            traits.append("REPEATED")
        if has_temp:
            traits.append("TEMP_SPILL")
        if names and any(classify_app(n) == "job" for n in names):
            traits.append("SCHEDULED_JOB")
        severity = "high" if share >= 5 else "medium" if share >= 1 or has_temp else "low"
        index = _verified_indexes(shape["index"], lookup)
        tables = shape["tables"]
        findings.append(
            {
                "id": f"q_{_sql_id(statement['sql'])}",
                "code": "QUERY_LOAD",
                "severity": severity,
                "category": "query",
                "sort": -share,
                "values": {
                    "tables": ", ".join(tables[:4]) + (" ..." if len(tables) > 4 else "") or "-",
                    "share": f"{share:.1f}",
                    "total": format_duration(statement.get("total_ms", 0)),
                    "calls": f"{calls:,}",
                    "avg": format_duration(statement.get("avg_ms", 0)),
                    "max": format_duration(statement.get("max_ms", 0)),
                    "peak": _peak_hour(statement.get("hours") or []) or "-",
                    "apps": ", ".join(names[:5]) or "-",
                    "users": ", ".join(u["name"] for u in (statement.get("users") or [])[:3]) or "-",
                    "temp": format_size(statement.get("temp_bytes", 0)) if has_temp else "",
                },
                "traits": traits,
                "sql": statement["sql"],
                "index": index,
            }
        )
    return findings


def _verified_indexes(
    candidates: list[dict[str, Any]], lookup: Callable[[str], dict[str, Any] | None] | None
) -> list[dict[str, Any]]:
    """Check candidates against the selected profile's catalog when it has the table."""
    result = []
    for candidate in candidates:
        table, columns = candidate["table"], candidate["columns"]
        info = None
        if lookup is not None:
            try:
                info = lookup(table)
            except Exception:
                info = None
        status = "unverified"
        schema = None
        rows = None
        if info:
            schema, rows = info.get("schema"), info.get("rows")
            existing = info.get("indexes") or []
            covered = any(index[: len(columns)] == columns for index in existing)
            leading = any(index and index[0] == columns[0] for index in existing)
            status = "covered" if covered else "partial" if leading else "missing"
        if status == "covered":
            result.append({**candidate, "status": status, "schema": schema, "ddl": None})
            continue
        target = f"{schema}.{table}" if schema else table
        name = f"idx_{table}_{'_'.join(columns)}"[:63]
        result.append(
            {
                **candidate,
                "status": status,
                "schema": schema,
                "rows": rows,
                "ddl": f"CREATE INDEX CONCURRENTLY {name} ON {target} ({', '.join(columns)});",
            }
        )
    return result


def _event_findings(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for event in parsed.get("events", []):
        message = event["message"]
        code = next(
            (name for pattern, name in EVENT_RULES if re.search(pattern, message, re.I)), None
        )
        if code is None:
            if not re.match(r"(ERROR|FATAL|PANIC)", message):
                continue
            code = "OTHER_ERRORS"
        group = groups.setdefault(code, {"count": 0, "messages": [], "hours": {}})
        group["count"] += event["count"]
        group["messages"].append(f"{event['count']:,} x {message}")
        for hour in event.get("hours", []):
            group["hours"][hour["hour"]] = group["hours"].get(hour["hour"], 0) + hour["count"]
    severity = {
        "SEQUENCE_EXHAUSTED": "critical",
        "RESOURCE_EXHAUSTED": "critical",
        "TOO_MANY_CONNECTIONS": "critical",
        "DEADLOCK": "high",
        "LOCK_WAITS": "high",
        "LOCK_TIMEOUT": "high",
        "TX_ABORTED": "high",
        "DUPLICATE_KEY": "medium",
        "SQL_ERRORS": "medium",
        "DATA_ERRORS": "medium",
        "USER_CANCEL": "medium",
        "STATEMENT_TIMEOUT": "medium",
        "IDLE_TX_TIMEOUT": "medium",
        "ANALYZE_NON_TABLES": "low",
    }
    findings = []
    for code, group in groups.items():
        peak = max(group["hours"], key=group["hours"].get) if group["hours"] else "-"
        findings.append(
            {
                "id": f"e_{code.lower()}",
                "code": code,
                "severity": severity.get(code, "low"),
                "category": "event",
                "sort": -group["count"],
                "values": {
                    "count": f"{group['count']:,}",
                    "peak": f"{peak}:00" if peak != "-" else "-",
                },
                "messages": group["messages"][:6],
            }
        )
    return findings


def _load_breakdown(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    for app in parsed.get("by_app", []):
        kind = classify_app(app["name"])
        bucket = totals.setdefault(kind, {"kind": kind, "ms": 0, "count": 0, "apps": []})
        bucket["ms"] += app["ms"]
        bucket["count"] += app["count"]
        bucket["apps"].append(app["name"])
    overall = sum(b["ms"] for b in totals.values()) or 1
    rows = sorted(totals.values(), key=lambda b: b["ms"], reverse=True)
    for row in rows:
        row["share"] = round(100 * row["ms"] / overall, 1)
        row["duration"] = format_duration(row["ms"])
        row["apps"] = row["apps"][:8]
    return rows


def _global_findings(parsed: dict[str, Any], breakdown: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    stats = parsed.get("stats", {})
    total = parsed.get("total_query_ms") or 1

    def add(code: str, severity: str, category: str, sort: float, **values: Any) -> dict[str, Any]:
        finding = {
            "id": f"g_{code.lower()}",
            "code": code,
            "severity": severity,
            "category": category,
            "sort": sort,
            "values": values,
        }
        findings.append(finding)
        return finding

    by_kind = {row["kind"]: row for row in breakdown}
    test = by_kind.get("test")
    if test and test["share"] >= 1:
        add(
            "TEST_APP_ON_PRODUCTION",
            "high",
            "load",
            -test["share"],
            apps=", ".join(test["apps"]),
            share=test["share"],
            total=test["duration"],
            count=f"{test['count']:,}",
        )
    backup = by_kind.get("backup")
    if backup and backup["share"] >= 5:
        slowest = [s for s in parsed.get("slowest_single", []) if classify_app(s["app"]) == "backup"]
        worst = slowest[0] if slowest else {}
        add(
            "BACKUP_LOAD",
            "high" if backup["share"] >= 15 else "medium",
            "load",
            -backup["share"],
            apps=", ".join(backup["apps"]),
            share=backup["share"],
            total=backup["duration"],
            longest=format_duration(worst.get("ms", 0)),
            table=_copy_table(worst.get("sql", "")),
        )
    unknown = by_kind.get("unknown")
    if unknown and unknown["share"] >= 1:
        add("UNNAMED_APPLICATION", "low", "load", -unknown["share"], share=unknown["share"], total=unknown["duration"])
    tools = by_kind.get("tool")
    if tools and tools["count"] > 0:
        add("ADHOC_TOOLS", "low", "load", 0, apps=", ".join(tools["apps"][:5]), count=f"{tools['count']:,}")

    window = _window_hours(parsed)
    if window > 0:
        average = total / (window * HOUR_MS)
        if average >= 5:
            add(
                "HIGH_CONCURRENT_LOAD",
                "high" if average >= 20 else "medium",
                "load",
                -average,
                average=f"{average:.1f}",
                total=format_duration(total),
                hours=f"{window:.1f}",
            )

    locks = parsed.get("locks", [])
    lock_ms = sum(lock["ms"] for lock in locks)
    if lock_ms >= 60_000:
        waiting = parsed.get("waiting_most", [])
        finding = add(
            "LOCK_CONTENTION",
            "high",
            "locks",
            -lock_ms / 60_000,
            total=format_duration(lock_ms),
            count=f"{sum(lock['count'] for lock in locks):,}",
            tables=", ".join(_written_tables(waiting)[:6]) or "-",
            apps=", ".join(sorted({w["app"] for w in waiting if w.get("app")})[:6]) or "-",
        )
        finding["sql"] = waiting[0]["sql"] if waiting else None

    temp_count = to_int(stats.get("Number temporary file", ""))
    temp_avg = size_bytes(stats.get("Average size of temporary file", ""))
    if temp_count:
        add(
            "TEMP_FILES",
            "medium" if temp_avg >= 50 * 1024**2 else "low",
            "server",
            -temp_count,
            count=f"{temp_count:,}",
            max=stats.get("Max size of temporary file", "-"),
            avg=stats.get("Average size of temporary file", "-"),
        )

    checkpoints = parsed.get("checkpoints", {})
    buffers = checkpoints.get("buffers", {})
    wal = checkpoints.get("wal", {})
    distance = checkpoints.get("distance", {})
    write_seconds = _number(next((v for k, v in buffers.items() if "write time" in k.lower()), ""))
    write_label = next((k for k in buffers if "write time" in k.lower()), "")
    if write_label or wal:
        write_seconds = _number(write_label) or write_seconds
    causes = checkpoints.get("causes", {})
    forced = sum(count for cause, count in causes.items() if cause != "time" and "immediate" not in cause)
    if forced or write_seconds >= 900:
        add(
            "CHECKPOINT_PRESSURE",
            "medium",
            "server",
            -write_seconds,
            write=f"{write_seconds:.0f}",
            forced=forced,
            scheduled=causes.get("time", 0),
            wal=_first_figure(wal),
            distance=_first_figure(distance),
        )

    ddl = next((t["count"] for t in parsed.get("by_type", []) if t["type"] == "DDL"), 0)
    queries = sum(t["count"] for t in parsed.get("by_type", [])) or 1
    if 100 * ddl / queries >= 1:
        add("DDL_IN_WORKLOAD", "medium", "load", 0, count=f"{ddl:,}", share=f"{100 * ddl / queries:.1f}")

    blind = []
    if to_int(stats.get("Total number of connections", "0")) == 0:
        blind.append("log_connections")
    if to_int(stats.get("Total number of sessions", "0")) == 0:
        blind.append("log_disconnections")
    if to_int(stats.get("Total number of automatic vacuums", "0")) == 0:
        blind.append("log_autovacuum_min_duration")
    minimum = min(
        (s.get("min_ms", 0) for s in parsed.get("time_consuming", []) if s.get("min_ms")), default=0
    )
    if blind or minimum:
        add(
            "LOG_BLIND_SPOTS",
            "medium" if blind else "low",
            "observability",
            1,
            settings=", ".join(blind) or "-",
            threshold=format_duration(minimum) if minimum else "-",
        )

    ratio = next((v for k, v in parsed.get("prepared", {}).items() if "bind vs prepare" in k), "")
    if ratio and _number(ratio) == 0 and duration_ms(stats.get("Prepare/parse total duration", "")) == 0:
        add("NO_PREPARED_STATEMENTS", "low", "load", 2)
    return findings


def _number(value: str) -> float:
    match = re.search(r"[\d,]*\.?\d+", value or "")
    return float(match.group(0).replace(",", "")) if match else 0.0


def _first_figure(figures: dict[str, str]) -> str:
    for label, value in figures.items():
        if value and "date" not in label.lower():
            return f"{label}: {value}"
        if "peak" in label.lower():
            return label
    return next(iter(figures), "-")


def _copy_table(sql: str) -> str:
    match = re.match(r"\s*copy\s+([\w.\"]+)", sql or "", re.I)
    return match.group(1) if match else "-"


def _written_tables(rows: list[dict[str, Any]]) -> list[str]:
    counts: dict[str, int] = {}
    for row in rows:
        match = re.search(r"\b(?:update|into|from)\s+([\w.\"]+)", row.get("sql", ""), re.I)
        if match:
            name = match.group(1).lower()
            counts[name] = counts.get(name, 0) + 1
    return sorted(counts, key=counts.get, reverse=True)


def analyse(
    parsed: dict[str, Any], lookup: Callable[[str], dict[str, Any] | None] | None = None
) -> dict[str, Any]:
    """Findings sorted by urgency, plus the summary numbers of the report."""
    breakdown = _load_breakdown(parsed)
    findings = (
        _global_findings(parsed, breakdown) + _query_findings(parsed, lookup) + _event_findings(parsed)
    )
    findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f.get("sort", 0)))
    for finding in findings:
        finding.pop("sort", None)
    queries = _query_findings_total_share(parsed)
    stats = parsed.get("stats", {})
    return {
        "summary": {
            "first_query": parsed.get("first_query"),
            "last_query": parsed.get("last_query"),
            "version": parsed.get("version"),
            "queries": stats.get("Number of queries", "-"),
            "normalized": stats.get("Number of unique normalized queries", "-"),
            "total_duration": format_duration(parsed.get("total_query_ms", 0)),
            "peak": stats.get("Query peak", "-"),
            "events": stats.get("Number of events", "-"),
            "temp_files": stats.get("Number temporary file", "-"),
            "top10_share": queries,
            "databases": [
                {"name": d["name"], "count": d["count"], "duration": format_duration(d["ms"])}
                for d in parsed.get("by_database", [])
            ],
            "load": breakdown,
            "lock_wait": format_duration(sum(lock["ms"] for lock in parsed.get("locks", []))),
        },
        "findings": findings,
    }


def _query_findings_total_share(parsed: dict[str, Any]) -> float:
    total = parsed.get("total_query_ms") or 1
    top = [
        row
        for row in parsed.get("time_consuming", [])
        if not all(classify_app(a["name"]) == "backup" for a in (row.get("apps") or [{"name": "x"}]))
    ][:10]
    return round(100 * sum(row.get("total_ms", 0) for row in top) / total, 1)
