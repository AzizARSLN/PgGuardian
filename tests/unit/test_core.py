"""Unit tests for configuration, models, exit codes and pure diagnostics."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from pgguardian.config.settings import PgGuardianSettings, get_settings
from pgguardian.diagnostics.connections import map_connection, summarize_connections
from pgguardian.diagnostics.health import build_overview_checks, short_version
from pgguardian.diagnostics.indexes import mark_potentially_unused
from pgguardian.diagnostics.locks import map_lock
from pgguardian.diagnostics.maintenance import evaluate_table_status, map_table
from pgguardian.diagnostics.queries import map_query
from pgguardian.models.connection import ConnectionReport, compute_usage_percent
from pgguardian.models.diagnostic import DiagnosticFinding
from pgguardian.models.finding import (
    EXIT_CRITICAL,
    EXIT_ERROR,
    EXIT_OK,
    EXIT_WARNING,
    Severity,
    exit_code_for,
    worst_severity,
)
from pgguardian.models.health import HealthCheck, HealthReport
from pgguardian.models.index import IndexInfo
from pgguardian.models.lock import LockInfo, build_blocking_chains
from pgguardian.models.maintenance import dead_tuple_percent


def healthy_overview() -> dict:
    return {
        "server_version": "PostgreSQL 16.10 on x86_64-pc-linux-gnu",
        "database_name": "pgguardian",
        "uptime_seconds": 86400,
        "database_size_bytes": 1073741824,
        "max_connections": 200,
        "total_connections": 10,
        "idle_in_transaction": 0,
        "cache_hit_ratio_percent": 99.2,
        "xact_commit": 1000,
        "xact_rollback": 5,
        "deadlocks": 0,
        "temp_files": 0,
        "temp_bytes": 0,
    }


def test_settings_defaults() -> None:
    settings = PgGuardianSettings()
    assert settings.host == "localhost"
    assert settings.port == 5432
    assert settings.connection_usage_warning == 80.0
    assert settings.long_query_warning_seconds == 60
    assert settings.dead_tuple_warning_percent == 10.0


def test_settings_env_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGGUARDIAN_HOST", "db.internal")
    monkeypatch.setenv("PGGUARDIAN_PORT", "5433")
    settings = PgGuardianSettings()
    assert settings.host == "db.internal"
    assert settings.port == 5433


def test_get_settings_cli_overrides_win(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGGUARDIAN_HOST", "from-env")
    settings = get_settings(host="from-cli", port=None)
    assert settings.host == "from-cli"


def test_short_version() -> None:
    assert short_version("PostgreSQL 16.10 on x86_64-pc-linux-gnu") == "16.10"
    assert short_version("garbage") == "unknown"


def test_healthy_overview_all_ok_or_info() -> None:
    checks = build_overview_checks(healthy_overview(), PgGuardianSettings())
    assert checks
    assert all(c.severity in (Severity.OK, Severity.INFO) for c in checks)


def test_connection_usage_critical() -> None:
    overview = {**healthy_overview(), "total_connections": 196}
    checks = build_overview_checks(overview, PgGuardianSettings())
    usage = next(c for c in checks if c.name == "connection_usage")
    assert usage.severity == Severity.CRITICAL


def test_low_cache_hit_ratio_warning() -> None:
    overview = {**healthy_overview(), "cache_hit_ratio_percent": 93.0}
    checks = build_overview_checks(overview, PgGuardianSettings())
    cache = next(c for c in checks if c.name == "cache_hit_ratio")
    assert cache.severity == Severity.WARNING


def test_compute_usage_percent_edges() -> None:
    assert compute_usage_percent(0, 100) == 0.0
    assert compute_usage_percent(50, 100) == 50.0
    assert compute_usage_percent(10, 0) == 0.0
    assert compute_usage_percent(0, 0) == 0.0


def test_dead_tuple_percent_edges() -> None:
    assert dead_tuple_percent(90, 10) == 10.0
    assert dead_tuple_percent(0, 0) == 0.0
    assert dead_tuple_percent(None, None) == 0.0


def test_evaluate_table_status() -> None:
    settings = PgGuardianSettings()
    assert evaluate_table_status(0.0, settings) == Severity.OK
    assert evaluate_table_status(15.0, settings) == Severity.WARNING
    assert evaluate_table_status(45.0, settings) == Severity.CRITICAL


def test_map_table_nulls() -> None:
    table = map_table({"table_name": "orders"}, PgGuardianSettings())
    assert table.live_tuples == 0
    assert table.dead_tuple_percent == 0.0
    assert table.status == Severity.OK
    assert table.last_vacuum is None


def test_exit_codes() -> None:
    assert exit_code_for(Severity.OK) == EXIT_OK
    assert exit_code_for(Severity.INFO) == EXIT_OK
    assert exit_code_for(Severity.WARNING) == EXIT_WARNING
    assert exit_code_for(Severity.UNKNOWN) == EXIT_WARNING
    assert exit_code_for(Severity.CRITICAL) == EXIT_CRITICAL
    assert EXIT_ERROR == 3


def test_worst_severity() -> None:
    assert worst_severity([]) == Severity.UNKNOWN
    assert worst_severity([Severity.OK, Severity.INFO]) == Severity.INFO
    assert worst_severity([Severity.WARNING, Severity.UNKNOWN]) == Severity.UNKNOWN
    assert worst_severity([Severity.WARNING, Severity.CRITICAL]) == Severity.CRITICAL


def test_models_frozen() -> None:
    check = HealthCheck(name="x", status=Severity.OK, severity=Severity.OK)
    with pytest.raises(ValidationError):
        check.score = 5  # type: ignore[attr-defined]


def test_finding_serialization() -> None:
    finding = DiagnosticFinding(
        code="LONG_RUNNING_QUERY",
        severity=Severity.WARNING,
        title="Slow",
        description="Runs long",
        recommendation="Check plan.",
    )
    dumped = finding.model_dump(mode="json")
    assert dumped["code"] == "LONG_RUNNING_QUERY"
    assert dumped["severity"] == "WARNING"
    restored = DiagnosticFinding.model_validate(dumped)
    assert restored == finding


def test_health_report_worst_severity() -> None:
    report = HealthReport(
        checks=[
            HealthCheck(name="a", status=Severity.OK, severity=Severity.OK),
            HealthCheck(name="b", status=Severity.WARNING, severity=Severity.WARNING),
        ],
        score=90,
        status="DEGRADED",
    )
    assert report.worst_severity() == Severity.WARNING


def test_summarize_connections_empty() -> None:
    summary = summarize_connections([], 100)
    assert summary.current_connections == 0
    assert summary.usage_percent == 0.0
    assert summary.by_state == {}


def test_map_connection_nulls() -> None:
    info = map_connection({"pid": 123})
    assert info.pid == 123
    assert info.state is None
    assert info.query is None


def test_map_query_and_lock_nulls() -> None:
    query = map_query({"pid": 1})
    assert query.duration_seconds is None
    lock = map_lock({"blocking_pid": 1, "blocked_pid": 2})
    assert lock.relation is None
    assert lock.blocking_duration_seconds is None


def test_blocking_chains() -> None:
    locks = [
        LockInfo(blocking_pid=123, blocked_pid=456),
        LockInfo(blocking_pid=456, blocked_pid=789),
    ]
    assert build_blocking_chains(locks) == ["PID 123 -> PID 456 -> PID 789"]
    assert build_blocking_chains([]) == []


def test_mark_potentially_unused() -> None:
    info = IndexInfo(index_name="idx_a", index_scans=3)
    flagged = mark_potentially_unused(info, 50)
    assert flagged.potentially_unused is True
    assert flagged.reason is not None
    busy = mark_potentially_unused(IndexInfo(index_name="idx_b", index_scans=5000), 50)
    assert busy.potentially_unused is False


def test_connection_report_json_roundtrip() -> None:
    report = ConnectionReport()
    restored = ConnectionReport.model_validate(report.model_dump(mode="json"))
    assert restored == report
