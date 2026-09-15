"""Unit tests for graceful degradation (failed queries → empty, never crash)."""

from __future__ import annotations

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics import connections as connections_diag
from pgguardian.diagnostics import indexes as indexes_diag
from pgguardian.diagnostics import locks as locks_diag
from pgguardian.diagnostics import maintenance as maintenance_diag
from pgguardian.diagnostics import queries as queries_diag
from pgguardian.diagnostics import storage as storage_diag


class FailingClient(DbClient):
    """DbClient stub whose queries always fail (simulates outage/permissions)."""

    def __init__(self) -> None:
        super().__init__(PgGuardianSettings(host="127.0.0.1", port=1))

    def fetch_all(self, sql: str, params: tuple[object, ...] | None = None) -> list[dict]:
        raise RuntimeError("simulated database error")

    def fetch_one(self, sql: str, params: tuple[object, ...] | None = None) -> dict | None:
        raise RuntimeError("simulated database error")


def test_collectors_degrade_to_empty() -> None:
    client = FailingClient()
    assert connections_diag.collect_connections(client).connections == []
    assert queries_diag.collect_active_queries(client).queries == []
    assert queries_diag.collect_long_running_queries(client).queries == []
    assert locks_diag.collect_locks(client).locks == []
    assert locks_diag.collect_locks(client).chains == []
    assert storage_diag.collect_storage(client).tables == []
    assert indexes_diag.collect_indexes(client).indexes == []
    assert maintenance_diag.collect_maintenance(client).tables == []


def test_health_degrades_to_unknown() -> None:
    from pgguardian.diagnostics import health as health_diag
    from pgguardian.models.finding import Severity

    report = health_diag.collect_health(FailingClient())
    assert report.checks
    assert all(check.severity == Severity.UNKNOWN for check in report.checks)
    assert report.status == "UNKNOWN"
