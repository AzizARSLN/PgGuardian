"""Maintenance diagnostics: VACUUM / ANALYZE / autovacuum state."""

from __future__ import annotations

from datetime import datetime

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.finding import Severity
from pgguardian.models.maintenance import (
    MaintenanceReport,
    MaintenanceSummary,
    TableMaintenance,
    dead_tuple_percent,
)
from pgguardian.utils.formatting import to_int as _int


def _timestamp(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def evaluate_table_status(dead_pct: float, settings: PgGuardianSettings) -> Severity:
    """Map a dead-tuple percentage to a severity (pure)."""
    if dead_pct >= settings.dead_tuple_critical_percent:
        return Severity.CRITICAL
    if dead_pct >= settings.dead_tuple_warning_percent:
        return Severity.WARNING
    return Severity.OK


def map_table(row: dict, settings: PgGuardianSettings) -> TableMaintenance:
    """Map a maintenance row to TableMaintenance (pure)."""
    live = _int(row.get("live_tuples"))
    dead = _int(row.get("dead_tuples"))
    pct = dead_tuple_percent(live, dead)
    return TableMaintenance(
        schema_name=str(row.get("schema_name")) if row.get("schema_name") else None,
        table_name=str(row.get("table_name") or "unknown"),
        live_tuples=live,
        dead_tuples=dead,
        dead_tuple_percent=pct,
        last_vacuum=_timestamp(row.get("last_vacuum")),
        last_autovacuum=_timestamp(row.get("last_autovacuum")),
        last_analyze=_timestamp(row.get("last_analyze")),
        last_autoanalyze=_timestamp(row.get("last_autoanalyze")),
        vacuum_count=_int(row.get("vacuum_count")),
        autovacuum_count=_int(row.get("autovacuum_count")),
        analyze_count=_int(row.get("analyze_count")),
        autoanalyze_count=_int(row.get("autoanalyze_count")),
        status=evaluate_table_status(pct, settings),
    )


def collect_maintenance(client: DbClient, limit: int = 20) -> MaintenanceReport:
    """Per-table maintenance plus summary; degrades to empty on failure."""
    settings = client.settings
    tables: list[TableMaintenance] = []
    summary = MaintenanceSummary()
    try:
        for row in client.fetch_all(load_sql("maintenance", "tables"), (limit,)):
            tables.append(map_table(dict(row), settings))
    except Exception:
        tables = []
    try:
        summary_row = client.fetch_one(load_sql("maintenance", "summary"))
        if summary_row:
            live = _int(summary_row.get("total_live_tuples"))
            dead = _int(summary_row.get("total_dead_tuples"))
            summary = MaintenanceSummary(
                total_live_tuples=live,
                total_dead_tuples=dead,
                dead_tuple_percent=dead_tuple_percent(live, dead),
                tables_total=_int(summary_row.get("tables_total")),
                tables_never_vacuumed=_int(summary_row.get("tables_never_vacuumed")),
                tables_never_analyzed=_int(summary_row.get("tables_never_analyzed")),
                autovacuum_workers=_int(summary_row.get("autovacuum_workers")),
            )
    except Exception:
        pass
    return MaintenanceReport(summary=summary, tables=tables, limit=limit)
