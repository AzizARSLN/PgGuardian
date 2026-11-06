"""Index models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class IndexInfo(BaseModel):
    """Usage statistics for one index.

    Low scan counts are reported as *potentially* unused only — statistics
    may have been reset recently and workloads vary over time.
    """

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str
    index_size_bytes: int = 0
    index_scans: int = 0
    tuples_read: int = 0
    tuples_fetched: int = 0
    potentially_unused: bool = False
    reason: str | None = None


class IndexReport(BaseModel):
    """Index usage listing plus low-usage candidates."""

    model_config = ConfigDict(frozen=True)

    limit: int = 20
    count: int = 0
    indexes: list[IndexInfo] = Field(default_factory=list)
    potentially_unused: list[IndexInfo] = Field(default_factory=list)


class IndexDetail(BaseModel):
    """One index with validity, type, key columns and usage/efficiency metrics.

    ``bloat_percent`` is only filled when the pgstattuple extension is
    available; otherwise it stays ``None`` rather than being estimated.
    """

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str
    index_size_bytes: int = 0
    index_scans: int = 0
    tuples_read: int = 0
    tuples_fetched: int = 0
    table_seq_scan: int = 0
    is_unique: bool = False
    is_primary: bool = False
    is_valid: bool = True
    is_ready: bool = True
    is_live: bool = True
    is_partial: bool = False
    is_expression: bool = False
    has_include: bool = False
    index_type: str | None = None
    key_columns: list[str] = Field(default_factory=list)
    definition: str | None = None
    cache_hit_percent: float | None = None
    bloat_percent: float | None = None
    bloat_bytes: int = 0
    potentially_unused: bool = False
    reason: str | None = None


class DuplicateIndexGroup(BaseModel):
    """Indexes on one table that share the same key columns and predicate."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    columns: list[str] = Field(default_factory=list)
    predicate: str | None = None
    index_names: list[str] = Field(default_factory=list)
    total_size_bytes: int = 0
    recommended_keep: str | None = None
    recommended_drop: list[str] = Field(default_factory=list)


class RedundantIndex(BaseModel):
    """An index whose key columns are a leading prefix of another index."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str
    covered_by: str
    size_bytes: int = 0


class MissingIndexCandidate(BaseModel):
    """A table read mostly by sequential scans with little index support."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    seq_scan: int = 0
    seq_tup_read: int = 0
    idx_scan: int = 0
    live_tuples: int = 0
    table_size_bytes: int = 0
    index_count: int = 0


class IndexSuggestion(BaseModel):
    """An actionable recommendation derived from the monitor report."""

    model_config = ConfigDict(frozen=True)

    # drop_unused | drop_duplicate | drop_redundant | reindex_bloat
    # | reindex_invalid | create_missing
    kind: str
    severity: str = "info"  # info | warning | critical
    title: str
    detail: str
    schema_name: str | None = None
    table_name: str | None = None
    index_name: str | None = None
    command: str | None = None
    confidence: str = "medium"  # low | medium | high
    estimated_reclaim_bytes: int = 0
    risk: str = "caution"  # safe | caution | dangerous


class IndexAlert(BaseModel):
    """A threshold breach or state problem surfaced as a notification."""

    model_config = ConfigDict(frozen=True)

    code: str
    level: str = "info"  # info | warning | critical
    title: str
    detail: str
    metric: str | None = None
    value: float | None = None
    threshold: float | None = None
    target: str | None = None


class IndexMonitorSummary(BaseModel):
    """Aggregate index health numbers for the KPI tiles and the trend."""

    model_config = ConfigDict(frozen=True)

    total_indexes: int = 0
    total_size_bytes: int = 0
    unused_count: int = 0
    unused_size_bytes: int = 0
    invalid_count: int = 0
    duplicate_group_count: int = 0
    duplicate_waste_bytes: int = 0
    redundant_count: int = 0
    redundant_size_bytes: int = 0
    bloated_count: int = 0
    bloat_size_bytes: int = 0
    bloat_known: bool = False
    missing_candidate_count: int = 0
    low_cache_hit_count: int = 0
    max_indexes_on_table: int = 0
    health_score: int = 100


class IndexMonitorReport(BaseModel):
    """Full index-monitoring payload: inventory, findings and alerts."""

    model_config = ConfigDict(frozen=True)

    taken_at: datetime
    database: str = "postgres"
    stats_reset: datetime | None = None
    stats_age_hours: float | None = None
    limit: int = 500
    summary: IndexMonitorSummary = Field(default_factory=IndexMonitorSummary)
    indexes: list[IndexDetail] = Field(default_factory=list)
    duplicates: list[DuplicateIndexGroup] = Field(default_factory=list)
    redundant: list[RedundantIndex] = Field(default_factory=list)
    invalid: list[IndexDetail] = Field(default_factory=list)
    missing: list[MissingIndexCandidate] = Field(default_factory=list)
    suggestions: list[IndexSuggestion] = Field(default_factory=list)
    alerts: list[IndexAlert] = Field(default_factory=list)


class IndexMonitorPoint(BaseModel):
    """One stored time-series point of index summary metrics."""

    model_config = ConfigDict(frozen=True)

    id: int = 0
    taken_at: datetime = Field(default_factory=datetime.utcnow)
    profile: str | None = None
    database: str = "postgres"
    total_indexes: int = 0
    total_size_bytes: int = 0
    unused_count: int = 0
    unused_size_bytes: int = 0
    invalid_count: int = 0
    duplicate_group_count: int = 0
    redundant_count: int = 0
    bloat_size_bytes: int = 0
    missing_candidate_count: int = 0
    low_cache_hit_count: int = 0
    health_score: int = 100
    critical_alerts: int = 0
    warning_alerts: int = 0
