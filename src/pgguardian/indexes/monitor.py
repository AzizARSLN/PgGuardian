"""Comprehensive index monitoring.

Layers, all read-only apart from what the operator triggers by hand:

1. inventory  — every index with validity flags, type, key columns and stats
2. usage      — scans vs. the statistics window (stats_reset awareness)
3. efficiency — buffer cache hit ratio and (when pgstattuple is present) bloat
4. findings   — duplicate, redundant, invalid, unused and missing candidates
5. advisory   — suggestions plus threshold-based alerts

Every query degrades to an empty result on failure, so a missing extension or a
restricted role never breaks the whole report.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.index import (
    DuplicateIndexGroup,
    IndexAlert,
    IndexDetail,
    IndexMonitorReport,
    IndexMonitorSummary,
    IndexSuggestion,
    MissingIndexCandidate,
    RedundantIndex,
)
from pgguardian.utils.formatting import to_float as _float
from pgguardian.utils.formatting import to_int as _int

UNUSED_REASON = (
    "Index has very few scans. This is only potentially unused: statistics may "
    "have been reset recently and workload patterns vary over time. Verify "
    "against a representative workload window before acting."
)

# Size of an unused index before it is worth calling out (bytes).
UNUSED_SUGGESTION_MIN_BYTES = 8 * 1024 * 1024


def _rows(client: DbClient, name: str, params: tuple = ()) -> list[dict]:
    """Run one diagnostic query, returning [] when it fails (best effort)."""
    try:
        sql = load_sql("indexes", name)
        return client.fetch_all(sql, params) if params else client.fetch_all(sql)
    except Exception:  # noqa: BLE001 — a missing extension must not break the report
        return []


def _key(schema: object, table: object, index: object) -> str:
    return f"{schema}.{table}.{index}"


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _qualified(schema: object, name: str) -> str:
    if schema:
        return f"{_quote(str(schema))}.{_quote(name)}"
    return _quote(name)


def _parse_dt(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _as_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def map_index_detail(
    row: dict,
    efficiency: dict[str, dict],
    bloat: dict[str, dict],
    max_scans: int,
) -> IndexDetail:
    """Map one inventory row to IndexDetail, merging efficiency and bloat."""
    schema = row.get("schema_name")
    table = row.get("table_name")
    name = str(row.get("index_name") or "unknown")
    size = _int(row.get("index_size_bytes"))
    key = _key(schema, table, name)

    cache = _float((efficiency.get(key) or {}).get("cache_hit_percent"))

    bloat_percent: float | None = None
    bloat_bytes = 0
    bloat_row = bloat.get(key)
    if bloat_row:
        density = _float(bloat_row.get("avg_leaf_density"))
        if density is not None:
            bloat_percent = round(max(0.0, 100.0 - density), 2)
            bloat_bytes = int(size * bloat_percent / 100.0)

    scans = _int(row.get("index_scans"))
    unused = scans <= max_scans
    return IndexDetail(
        schema_name=str(schema) if schema else None,
        table_name=str(table) if table else None,
        index_name=name,
        index_size_bytes=size,
        index_scans=scans,
        tuples_read=_int(row.get("tuples_read")),
        tuples_fetched=_int(row.get("tuples_fetched")),
        table_seq_scan=_int(row.get("table_seq_scan")),
        is_unique=bool(row.get("is_unique")),
        is_primary=bool(row.get("is_primary")),
        is_valid=bool(row.get("is_valid", True)),
        is_ready=bool(row.get("is_ready", True)),
        is_live=bool(row.get("is_live", True)),
        is_partial=bool(row.get("is_partial")),
        is_expression=bool(row.get("is_expression")),
        has_include=bool(row.get("has_include")),
        index_type=str(row.get("index_type")) if row.get("index_type") else None,
        key_columns=_as_list(row.get("key_columns")),
        definition=str(row.get("definition")) if row.get("definition") else None,
        cache_hit_percent=cache,
        bloat_percent=bloat_percent,
        bloat_bytes=bloat_bytes,
        potentially_unused=unused,
        reason=UNUSED_REASON if unused else None,
    )


def _map_duplicates(rows: list[dict], columns_by_index: dict[str, list[str]]) -> list[DuplicateIndexGroup]:
    groups: list[DuplicateIndexGroup] = []
    for row in rows:
        names = _as_list(row.get("index_names"))
        if len(names) < 2:
            continue
        schema = row.get("schema_name")
        table = row.get("table_name")
        keep = names[0]
        drop = names[1:]
        columns = columns_by_index.get(_key(schema, table, keep), [])
        groups.append(
            DuplicateIndexGroup(
                schema_name=str(schema) if schema else None,
                table_name=str(table) if table else None,
                columns=columns,
                predicate=str(row.get("predicate_signature") or "") or None,
                index_names=names,
                total_size_bytes=_int(row.get("total_size_bytes")),
                recommended_keep=keep,
                recommended_drop=drop,
            )
        )
    return groups


def _map_redundant(rows: list[dict]) -> list[RedundantIndex]:
    seen: set[str] = set()
    redundant: list[RedundantIndex] = []
    for row in rows:
        schema = row.get("schema_name")
        table = row.get("table_name")
        name = str(row.get("redundant_index") or "")
        if not name:
            continue
        dedupe_key = _key(schema, table, name)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        redundant.append(
            RedundantIndex(
                schema_name=str(schema) if schema else None,
                table_name=str(table) if table else None,
                index_name=name,
                covered_by=str(row.get("covered_by") or ""),
                size_bytes=_int(row.get("redundant_size_bytes")),
            )
        )
    return redundant


def _map_invalid(rows: list[dict]) -> list[IndexDetail]:
    invalid: list[IndexDetail] = []
    for row in rows:
        schema = row.get("schema_name")
        table = row.get("table_name")
        invalid.append(
            IndexDetail(
                schema_name=str(schema) if schema else None,
                table_name=str(table) if table else None,
                index_name=str(row.get("index_name") or "unknown"),
                index_size_bytes=_int(row.get("index_size_bytes")),
                is_valid=bool(row.get("is_valid", False)),
                is_ready=bool(row.get("is_ready", False)),
                is_live=bool(row.get("is_live", False)),
                definition=str(row.get("definition")) if row.get("definition") else None,
                reason="Index is invalid or not ready; the planner cannot use it.",
            )
        )
    return invalid


def _map_missing(rows: list[dict]) -> list[MissingIndexCandidate]:
    candidates: list[MissingIndexCandidate] = []
    for row in rows:
        schema = row.get("schema_name")
        table = row.get("table_name")
        seq_scan = _int(row.get("seq_scan"))
        seq_tup_read = _int(row.get("seq_tup_read"))
        idx_scan = _int(row.get("idx_scan"))
        # Only tables where sequential scans clearly dominate trigger a hint.
        if seq_tup_read <= 0 or seq_scan < 10:
            continue
        if seq_scan <= idx_scan:
            continue
        candidates.append(
            MissingIndexCandidate(
                schema_name=str(schema) if schema else None,
                table_name=str(table) if table else None,
                seq_scan=seq_scan,
                seq_tup_read=seq_tup_read,
                idx_scan=idx_scan,
                live_tuples=_int(row.get("live_tuples")),
                table_size_bytes=_int(row.get("table_size_bytes")),
                index_count=_int(row.get("index_count")),
            )
        )
    return candidates


def _indexes_per_table(indexes: list[IndexDetail]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for index in indexes:
        key = f"{index.schema_name}.{index.table_name}"
        counts[key] = counts.get(key, 0) + 1
    return counts


def _health_score(summary: IndexMonitorSummary) -> int:
    """A bounded 0-100 score weighting correctness, waste and efficiency."""
    score = 100.0
    score -= min(40.0, summary.invalid_count * 20.0)
    score -= min(20.0, summary.duplicate_group_count * 5.0)
    score -= min(15.0, summary.redundant_count * 3.0)
    score -= min(12.0, summary.bloated_count * 2.0)
    score -= min(10.0, summary.low_cache_hit_count * 1.0)
    if summary.total_size_bytes > 0:
        waste = (
            summary.unused_size_bytes
            + summary.duplicate_waste_bytes
            + summary.redundant_size_bytes
        )
        score -= min(25.0, 25.0 * waste / summary.total_size_bytes)
    return max(0, min(100, round(score)))


def build_suggestions(
    indexes: list[IndexDetail],
    duplicates: list[DuplicateIndexGroup],
    redundant: list[RedundantIndex],
    invalid: list[IndexDetail],
    missing: list[MissingIndexCandidate],
    bloat_warning_percent: float,
) -> list[IndexSuggestion]:
    """Turn the findings into ranked, actionable suggestions (pure)."""
    suggestions: list[IndexSuggestion] = []

    for index in invalid:
        suggestions.append(
            IndexSuggestion(
                kind="reindex_invalid",
                severity="critical",
                title=f"Rebuild invalid index {index.index_name}",
                detail=(
                    "This index is marked invalid/not-ready, so the planner ignores it "
                    "while it still consumes space and write time. Rebuilding it restores it."
                ),
                schema_name=index.schema_name,
                table_name=index.table_name,
                index_name=index.index_name,
                command=(
                    f"REINDEX INDEX CONCURRENTLY "
                    f"{_qualified(index.schema_name, index.index_name)};"
                ),
                confidence="high",
                estimated_reclaim_bytes=index.index_size_bytes,
                risk="caution",
            )
        )

    for group in duplicates:
        for name in group.recommended_drop:
            suggestions.append(
                IndexSuggestion(
                    kind="drop_duplicate",
                    severity="warning",
                    title=f"Drop duplicate index {name}",
                    detail=(
                        f"Identical to {group.recommended_keep} on "
                        f"{group.schema_name}.{group.table_name} "
                        f"({', '.join(group.columns) or 'same columns'}). Duplicates only "
                        "add write cost. Confirm nothing depends on the exact name first."
                    ),
                    schema_name=group.schema_name,
                    table_name=group.table_name,
                    index_name=name,
                    command=f"DROP INDEX CONCURRENTLY {_qualified(group.schema_name, name)};",
                    confidence="high",
                    risk="dangerous",
                )
            )

    for item in redundant:
        suggestions.append(
            IndexSuggestion(
                kind="drop_redundant",
                severity="warning",
                title=f"Drop redundant index {item.index_name}",
                detail=(
                    f"Key columns are a leading prefix of {item.covered_by} on "
                    f"{item.schema_name}.{item.table_name}, so it is usually covered. "
                    "Verify the workload does not rely on it alone."
                ),
                schema_name=item.schema_name,
                table_name=item.table_name,
                index_name=item.index_name,
                command=f"DROP INDEX CONCURRENTLY {_qualified(item.schema_name, item.index_name)};",
                confidence="medium",
                estimated_reclaim_bytes=item.size_bytes,
                risk="dangerous",
            )
        )

    for index in indexes:
        if (
            index.potentially_unused
            and index.index_size_bytes >= UNUSED_SUGGESTION_MIN_BYTES
            and not index.is_primary
            and not index.is_unique
        ):
            suggestions.append(
                IndexSuggestion(
                    kind="drop_unused",
                    severity="info",
                    title=f"Review unused index {index.index_name}",
                    detail=UNUSED_REASON,
                    schema_name=index.schema_name,
                    table_name=index.table_name,
                    index_name=index.index_name,
                    command=(
                        f"DROP INDEX CONCURRENTLY "
                        f"{_qualified(index.schema_name, index.index_name)};"
                    ),
                    confidence="low",
                    estimated_reclaim_bytes=index.index_size_bytes,
                    risk="dangerous",
                )
            )

    for index in indexes:
        if index.bloat_percent is not None and index.bloat_percent >= bloat_warning_percent:
            suggestions.append(
                IndexSuggestion(
                    kind="reindex_bloat",
                    severity="warning" if index.bloat_percent < 50 else "critical",
                    title=f"Reindex bloated index {index.index_name}",
                    detail=(
                        f"Estimated bloat {index.bloat_percent:.0f}% "
                        f"({index.bloat_bytes} bytes). A concurrent reindex reclaims the "
                        "space without blocking writes."
                    ),
                    schema_name=index.schema_name,
                    table_name=index.table_name,
                    index_name=index.index_name,
                    command=(
                        f"REINDEX INDEX CONCURRENTLY "
                        f"{_qualified(index.schema_name, index.index_name)};"
                    ),
                    confidence="medium",
                    estimated_reclaim_bytes=index.bloat_bytes,
                    risk="caution",
                )
            )

    for candidate in missing:
        suggestions.append(
            IndexSuggestion(
                kind="create_missing",
                severity="info",
                title=f"Possible missing index on {candidate.table_name}",
                detail=(
                    f"{candidate.seq_scan} sequential scans read {candidate.seq_tup_read} rows "
                    f"while only {candidate.idx_scan} index scans ran. Review the workload "
                    "(pg_stat_statements) and consider an index on the filtered/join columns. "
                    "PgGuardian never creates indexes automatically."
                ),
                schema_name=candidate.schema_name,
                table_name=candidate.table_name,
                confidence="low",
                risk="caution",
            )
        )

    order = {"critical": 0, "warning": 1, "info": 2}
    suggestions.sort(
        key=lambda s: (order.get(s.severity, 3), -s.estimated_reclaim_bytes)
    )
    return suggestions


def evaluate_alerts(
    summary: IndexMonitorSummary,
    indexes: list[IndexDetail],
    duplicates: list[DuplicateIndexGroup],
    missing: list[MissingIndexCandidate],
    *,
    bloat_warning_percent: float,
    bloat_critical_percent: float,
    cache_hit_warning: float,
    unused_size_warning_bytes: int,
    indexes_per_table_warning: int,
    stats_age_hours: float | None,
) -> list[IndexAlert]:
    """Evaluate threshold rules against the report (pure)."""
    alerts: list[IndexAlert] = []

    if summary.invalid_count > 0:
        alerts.append(
            IndexAlert(
                code="invalid_indexes",
                level="critical",
                title="Invalid indexes present",
                detail=(
                    f"{summary.invalid_count} index(es) are invalid or not ready and are "
                    "ignored by the planner. Rebuild them with REINDEX CONCURRENTLY."
                ),
                metric="invalid_count",
                value=float(summary.invalid_count),
                threshold=0.0,
            )
        )

    if summary.duplicate_group_count > 0:
        alerts.append(
            IndexAlert(
                code="duplicate_indexes",
                level="warning",
                title="Duplicate indexes",
                detail=(
                    f"{summary.duplicate_group_count} group(s) of identical indexes waste "
                    "space and slow down writes."
                ),
                metric="duplicate_group_count",
                value=float(summary.duplicate_group_count),
                threshold=0.0,
            )
        )

    if summary.unused_size_bytes >= unused_size_warning_bytes:
        alerts.append(
            IndexAlert(
                code="unused_index_size",
                level="warning",
                title="Large amount of space in unused indexes",
                detail=(
                    "Potentially-unused indexes account for a large share of index storage. "
                    "Confirm over a full workload cycle before dropping."
                ),
                metric="unused_size_bytes",
                value=float(summary.unused_size_bytes),
                threshold=float(unused_size_warning_bytes),
            )
        )

    if summary.bloat_known:
        worst = max((i.bloat_percent or 0.0) for i in indexes) if indexes else 0.0
        if worst >= bloat_critical_percent:
            alerts.append(
                IndexAlert(
                    code="index_bloat",
                    level="critical",
                    title="Severe index bloat",
                    detail=f"An index is about {worst:.0f}% bloated. Consider REINDEX CONCURRENTLY.",
                    metric="bloat_percent",
                    value=worst,
                    threshold=bloat_critical_percent,
                )
            )
        elif worst >= bloat_warning_percent:
            alerts.append(
                IndexAlert(
                    code="index_bloat",
                    level="warning",
                    title="Index bloat detected",
                    detail=f"An index is about {worst:.0f}% bloated.",
                    metric="bloat_percent",
                    value=worst,
                    threshold=bloat_warning_percent,
                )
            )

    for index in indexes:
        if (
            index.cache_hit_percent is not None
            and index.index_scans > 0
            and index.cache_hit_percent < cache_hit_warning
        ):
            alerts.append(
                IndexAlert(
                    code="low_cache_hit",
                    level="warning",
                    title=f"Low cache-hit ratio on {index.index_name}",
                    detail=(
                        f"Only {index.cache_hit_percent:.1f}% of index reads hit shared buffers "
                        "— the working set may exceed shared_buffers."
                    ),
                    metric="cache_hit_percent",
                    value=index.cache_hit_percent,
                    threshold=cache_hit_warning,
                    target=f"{index.schema_name}.{index.table_name}.{index.index_name}",
                )
            )
            break  # one representative alert is enough

    if summary.max_indexes_on_table >= indexes_per_table_warning:
        alerts.append(
            IndexAlert(
                code="too_many_indexes",
                level="warning",
                title="Table with many indexes",
                detail=(
                    f"A table carries {summary.max_indexes_on_table} indexes; every write "
                    "must maintain all of them."
                ),
                metric="max_indexes_on_table",
                value=float(summary.max_indexes_on_table),
                threshold=float(indexes_per_table_warning),
            )
        )

    if missing:
        alerts.append(
            IndexAlert(
                code="missing_index_candidates",
                level="info",
                title="Sequential-scan heavy tables",
                detail=(
                    f"{len(missing)} table(s) are read mostly by sequential scans. Review "
                    "them for a possible index."
                ),
                metric="missing_candidate_count",
                value=float(len(missing)),
            )
        )

    if stats_age_hours is not None and stats_age_hours < 24:
        alerts.append(
            IndexAlert(
                code="stats_recently_reset",
                level="info",
                title="Statistics were reset recently",
                detail=(
                    f"pg_stat counters were reset about {stats_age_hours:.1f} hour(s) ago, so "
                    "'unused index' verdicts are not yet reliable."
                ),
                metric="stats_age_hours",
                value=round(stats_age_hours, 2),
                threshold=24.0,
            )
        )

    order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order.get(a.level, 3))
    return alerts


def collect_monitor(client: DbClient, limit: int = 500, max_scans: int | None = None) -> IndexMonitorReport:
    """Build the full index-monitoring report (read-only, degrades gracefully)."""
    settings = client.settings
    threshold = settings.unused_index_max_scans if max_scans is None else max_scans
    bound = max(1, min(limit, 5000))

    context = _rows(client, "context")
    database = str(context[0].get("database") or settings.database) if context else settings.database
    stats_reset = _parse_dt(context[0].get("stats_reset")) if context else None
    stats_age_hours: float | None = None
    if stats_reset is not None:
        now = datetime.now(stats_reset.tzinfo or UTC)
        stats_age_hours = max(0.0, (now - stats_reset).total_seconds() / 3600.0)

    inventory_rows = _rows(client, "inventory", (bound,))
    efficiency = {
        _key(r.get("schema_name"), r.get("table_name"), r.get("index_name")): r
        for r in _rows(client, "efficiency", (bound,))
    }
    bloat = {
        _key(r.get("schema_name"), r.get("table_name"), r.get("index_name")): r
        for r in _rows(client, "bloat", (bound,))
    }
    indexes = [map_index_detail(row, efficiency, bloat, threshold) for row in inventory_rows]
    columns_by_index = {
        _key(i.schema_name, i.table_name, i.index_name): i.key_columns for i in indexes
    }

    duplicates = _map_duplicates(_rows(client, "duplicates", (bound,)), columns_by_index)
    redundant = _map_redundant(_rows(client, "redundant", (bound,)))
    invalid = _map_invalid(_rows(client, "invalid", (bound,)))
    missing = _map_missing(_rows(client, "missing", (bound,)))

    unused = [i for i in indexes if i.potentially_unused]
    bloated = [
        i for i in indexes if i.bloat_percent is not None and i.bloat_percent >= settings.index_bloat_warning_percent
    ]
    low_cache_hit = [
        i
        for i in indexes
        if i.cache_hit_percent is not None
        and i.index_scans > 0
        and i.cache_hit_percent < settings.index_cache_hit_warning
    ]
    counts = _indexes_per_table(indexes)

    summary = IndexMonitorSummary(
        total_indexes=len(indexes),
        total_size_bytes=sum(i.index_size_bytes for i in indexes),
        unused_count=len(unused),
        unused_size_bytes=sum(i.index_size_bytes for i in unused),
        invalid_count=len(invalid),
        duplicate_group_count=len(duplicates),
        duplicate_waste_bytes=sum(
            g.total_size_bytes for g in duplicates if g.recommended_drop
        ),
        redundant_count=len(redundant),
        redundant_size_bytes=sum(r.size_bytes for r in redundant),
        bloated_count=len(bloated),
        bloat_size_bytes=sum(i.bloat_bytes for i in bloated),
        bloat_known=any(i.bloat_percent is not None for i in indexes),
        missing_candidate_count=len(missing),
        low_cache_hit_count=len(low_cache_hit),
        max_indexes_on_table=max(counts.values(), default=0),
    )
    summary = summary.model_copy(update={"health_score": _health_score(summary)})

    suggestions = build_suggestions(
        indexes, duplicates, redundant, invalid, missing, settings.index_bloat_warning_percent
    )
    alerts = evaluate_alerts(
        summary,
        indexes,
        duplicates,
        missing,
        bloat_warning_percent=settings.index_bloat_warning_percent,
        bloat_critical_percent=settings.index_bloat_critical_percent,
        cache_hit_warning=settings.index_cache_hit_warning,
        unused_size_warning_bytes=settings.index_unused_size_warning_bytes,
        indexes_per_table_warning=settings.indexes_per_table_warning,
        stats_age_hours=stats_age_hours,
    )

    return IndexMonitorReport(
        taken_at=datetime.now(UTC),
        database=database,
        stats_reset=stats_reset,
        stats_age_hours=stats_age_hours,
        limit=bound,
        summary=summary,
        indexes=indexes,
        duplicates=duplicates,
        redundant=redundant,
        invalid=invalid,
        missing=missing,
        suggestions=suggestions,
        alerts=alerts,
    )
