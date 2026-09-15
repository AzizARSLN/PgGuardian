"""Live integration tests against a real PostgreSQL.

Run with a reachable database, e.g.::

    docker compose up -d
    set PGGUARDIAN_TEST_CONNECTION_STRING=host=localhost port=5432 dbname=pgguardian user=pgguardian password=pgguardian
    pytest tests/integration

Without ``PGGUARDIAN_TEST_CONNECTION_STRING`` every test is skipped —
production databases are never touched by default.
"""

from __future__ import annotations

import os

import pytest

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics import connections as connections_diag
from pgguardian.diagnostics import diagnose as diagnose_diag
from pgguardian.diagnostics import health as health_diag
from pgguardian.diagnostics import indexes as indexes_diag
from pgguardian.diagnostics import locks as locks_diag
from pgguardian.diagnostics import maintenance as maintenance_diag
from pgguardian.diagnostics import queries as queries_diag
from pgguardian.diagnostics import storage as storage_diag

CONNINFO = os.getenv("PGGUARDIAN_TEST_CONNECTION_STRING", "")

pytestmark = pytest.mark.skipif(
    not CONNINFO, reason="PGGUARDIAN_TEST_CONNECTION_STRING not set; skipping live tests."
)


@pytest.fixture
def live_client() -> DbClient:
    return DbClient(PgGuardianSettings(connection_string=CONNINFO))


def test_live_health(live_client: DbClient) -> None:
    report = health_diag.collect_health(live_client)
    assert report.checks, "expected health checks from a live database"
    assert 0 <= report.score <= 100
    assert report.status in ("HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN")
    assert report.database != "unknown"


def test_live_connections(live_client: DbClient) -> None:
    report = connections_diag.collect_connections(live_client)
    assert report.summary.max_connections > 0
    assert report.summary.current_connections >= 1


def test_live_queries(live_client: DbClient) -> None:
    active = queries_diag.collect_active_queries(live_client)
    assert active.count >= 0
    long_running = queries_diag.collect_long_running_queries(live_client, min_seconds=3600)
    assert long_running.count >= 0


def test_live_locks_storage_indexes_maintenance(live_client: DbClient) -> None:
    locks = locks_diag.collect_locks(live_client)
    assert locks.summary.total_locks >= 0
    storage = storage_diag.collect_storage(live_client)
    assert storage.databases, "expected at least the current database"
    indexes = indexes_diag.collect_indexes(live_client)
    assert indexes.count >= 0
    maintenance = maintenance_diag.collect_maintenance(live_client)
    assert maintenance.summary.tables_total >= 0


def test_live_diagnose_returns_findings_list(live_client: DbClient) -> None:
    findings = diagnose_diag.collect_findings(live_client)
    assert isinstance(findings, list)


def test_live_api_health_and_sql(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from fastapi.testclient import TestClient

    from pgguardian.api.app import create_app

    monkeypatch.setenv("PGGUARDIAN_CONNECTION_STRING", CONNINFO)
    monkeypatch.setenv("PGGUARDIAN_SNAPSHOTS_FILE", str(tmp_path / "snapshots.db"))
    api = TestClient(create_app())

    health = api.get("/api/v1/health")
    assert health.status_code == 200
    assert 0 <= health.json()["score"] <= 100

    result = api.post("/api/v1/sql", json={"sql": "SELECT 1 AS one"})
    assert result.status_code == 200
    assert result.json()["rows"] == [[1]]

    snapshot = api.post("/api/v1/snapshots")
    assert snapshot.status_code == 200
    assert snapshot.json()["id"] >= 1
    listed = api.get("/api/v1/snapshots")
    assert listed.status_code == 200
    assert len(listed.json()) >= 1

    databases = api.get("/api/v1/databases")
    assert databases.status_code == 200
    assert any(db["name"] == "pgguardian" for db in databases.json())
