"""Maintenance models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from pgguardian.models.finding import Severity


class TableMaintenance(BaseModel):
    """VACUUM/ANALYZE state of one table."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str
    live_tuples: int = 0
    dead_tuples: int = 0
    dead_tuple_percent: float = 0.0
    last_vacuum: datetime | None = None
    last_autovacuum: datetime | None = None
    last_analyze: datetime | None = None
    last_autoanalyze: datetime | None = None
    vacuum_count: int = 0
    autovacuum_count: int = 0
    analyze_count: int = 0
    autoanalyze_count: int = 0
    status: Severity = Severity.OK


class MaintenanceSummary(BaseModel):
    """Cluster-wide maintenance rollup."""

    model_config = ConfigDict(frozen=True)

    total_live_tuples: int = 0
    total_dead_tuples: int = 0
    dead_tuple_percent: float = 0.0
    tables_total: int = 0
    tables_never_vacuumed: int = 0
    tables_never_analyzed: int = 0
    autovacuum_workers: int = 0


class MaintenanceReport(BaseModel):
    """Per-table maintenance plus summary."""

    model_config = ConfigDict(frozen=True)

    summary: MaintenanceSummary = Field(default_factory=MaintenanceSummary)
    tables: list[TableMaintenance] = Field(default_factory=list)
    limit: int = 20


def dead_tuple_percent(live: int | None, dead: int | None) -> float:
    """Dead-tuple ratio, safe against zero/NULL tuple counts."""
    live_count = live or 0
    dead_count = dead or 0
    total = live_count + dead_count
    if total <= 0:
        return 0.0
    return round((dead_count / total) * 100, 1)
