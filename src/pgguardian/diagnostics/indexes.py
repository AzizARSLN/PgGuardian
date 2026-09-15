"""Index diagnostics over pg_stat_user_indexes.

Low scan counts are surfaced as *potentially* unused: statistics may have
been reset recently and workloads vary over time, so PgGuardian never
claims an index is definitively unused.
"""

from __future__ import annotations

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.index import IndexInfo, IndexReport
from pgguardian.utils.formatting import to_int as _int

POTENTIALLY_UNUSED_REASON = (
    "Index has very few scans. This is only potentially unused: statistics "
    "may have been reset recently and workload patterns vary over time. "
    "Verify against a representative workload window before acting."
)


def mark_potentially_unused(index: IndexInfo, max_scans: int) -> IndexInfo:
    """Flag low-scan indexes as potentially unused (pure)."""
    if index.index_scans <= max_scans:
        return index.model_copy(
            update={"potentially_unused": True, "reason": POTENTIALLY_UNUSED_REASON}
        )
    return index


def map_index(row: dict, max_scans: int) -> IndexInfo:
    """Map an index-usage row to IndexInfo (pure)."""
    info = IndexInfo(
        schema_name=str(row.get("schema_name")) if row.get("schema_name") else None,
        table_name=str(row.get("table_name")) if row.get("table_name") else None,
        index_name=str(row.get("index_name") or "unknown"),
        index_size_bytes=_int(row.get("index_size_bytes")),
        index_scans=_int(row.get("index_scans")),
        tuples_read=_int(row.get("tuples_read")),
        tuples_fetched=_int(row.get("tuples_fetched")),
    )
    return mark_potentially_unused(info, max_scans)


def collect_indexes(client: DbClient, limit: int = 20, max_scans: int | None = None) -> IndexReport:
    """Index usage plus low-usage candidates; degrades to empty on failure."""
    settings: PgGuardianSettings = client.settings
    threshold = settings.unused_index_max_scans if max_scans is None else max_scans
    indexes: list[IndexInfo] = []
    candidates: list[IndexInfo] = []
    try:
        for row in client.fetch_all(load_sql("indexes", "usage"), (limit,)):
            info = map_index(dict(row), threshold)
            indexes.append(info)
            if info.potentially_unused:
                candidates.append(info)
    except Exception:
        indexes = []
    if not candidates:
        try:
            for row in client.fetch_all(load_sql("indexes", "low_usage"), (threshold, limit)):
                info = map_index(dict(row), threshold)
                if info.potentially_unused and all(
                    existing.index_name != info.index_name for existing in candidates
                ):
                    candidates.append(info)
        except Exception:
            pass
    return IndexReport(
        limit=limit, count=len(indexes), indexes=indexes, potentially_unused=candidates
    )
