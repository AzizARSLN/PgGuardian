"""API tests without a database: routing, auth, safety gates, sanitization."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pgguardian.api.app import create_app

UNREACHABLE = {
    "PGHOST": "127.0.0.1",
    "PGPORT": "55432",
    "PGDATABASE": "pgguardian_test",
    "PGUSER": "tester",
    "PGPASSWORD": "secret-test-pw-xyz",
    "PGGUARDIAN_CONNECT_TIMEOUT": "1",
}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    for key, value in UNREACHABLE.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("PGGUARDIAN_API_TOKEN", raising=False)
    monkeypatch.delenv("PGGUARDIAN_ALLOW_WRITES", raising=False)
    monkeypatch.delenv("PGGUARDIAN_ALLOW_DANGEROUS", raising=False)
    return TestClient(create_app())


def test_meta_endpoints_need_no_db(client: TestClient) -> None:
    assert client.get("/healthz").status_code == 200
    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["service"] == "pgguardian"


def test_unreachable_db_is_503_without_secrets(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 503
    assert "secret-test-pw-xyz" not in response.text
    assert "Unable to connect" in response.text


def test_openapi_schema_lists_routes(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    for expected in [
        "/api/v1/health",
        "/api/v1/diagnose",
        "/api/v1/connections",
        "/api/v1/queries/active",
        "/api/v1/locks",
        "/api/v1/storage",
        "/api/v1/indexes",
        "/api/v1/maintenance",
        "/api/v1/report",
        "/api/v1/sql",
        "/api/v1/profiles",
        "/api/v1/snapshots",
        "/api/v1/databases",
        "/api/v1/schemas",
        "/api/v1/roles",
        "/api/v1/queries/{pid}/cancel",
        "/api/v1/maintenance/vacuum",
        "/api/v1/config",
        "/api/v1/replication",
        "/api/v1/backups",
    ]:
        assert expected in paths, expected


def test_token_auth_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in UNREACHABLE.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("PGGUARDIAN_API_TOKEN", "tok123")
    app_client = TestClient(create_app())
    assert app_client.get("/api/v1/health").status_code == 401
    assert app_client.get("/healthz").status_code == 200
    authed = app_client.get("/api/v1/health", headers={"Authorization": "Bearer tok123"})
    assert authed.status_code == 503  # auth passed, DB unreachable
    wrong = app_client.get("/api/v1/health", headers={"Authorization": "Bearer wrong"})
    assert wrong.status_code == 401


def test_mutations_blocked_without_opt_in(client: TestClient) -> None:
    assert client.post("/api/v1/queries/123/cancel", json={"confirm": True}).status_code == 403
    assert client.post("/api/v1/queries/123/terminate", json={"confirm": True}).status_code == 403
    assert client.post("/api/v1/databases", json={"name": "x", "confirm": True}).status_code == 403
    assert client.post("/api/v1/maintenance/vacuum", json={"confirm": True}).status_code == 403
    assert client.post("/api/v1/backups", json={"confirm": True}).status_code == 403


def test_mutations_need_confirm(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    response = client.post("/api/v1/queries/123/cancel", json={})
    assert response.status_code == 400
    assert "confirm" in response.text


def test_dry_run_needs_no_db(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    response = client.post("/api/v1/queries/123/cancel", json={"confirm": False, "dry_run": True})
    assert response.status_code == 200
    assert "pg_cancel_backend(123)" in response.text


def test_sql_guards(client: TestClient) -> None:
    # Multi-statement rejected without touching the DB.
    multi = client.post("/api/v1/sql", json={"sql": "SELECT 1; SELECT 2"})
    assert multi.status_code == 400
    # Write statement refused in default readonly mode.
    write = client.post("/api/v1/sql", json={"sql": "DROP TABLE t"})
    assert write.status_code == 403
    # Read statement passes classification, then fails on unreachable DB.
    read = client.post("/api/v1/sql", json={"sql": "SELECT 1"})
    assert read.status_code == 503
    assert "secret-test-pw-xyz" not in read.text
    # Dry-run classifies without executing.
    dry = client.post("/api/v1/sql", json={"sql": "SELECT 1", "dry_run": True})
    assert dry.status_code == 200
    assert dry.json()["risk"] == "READ"


def test_sql_row_cap_validation(client: TestClient) -> None:
    over = client.post("/api/v1/sql", json={"sql": "SELECT 1", "max_rows": 99999})
    assert over.status_code == 422


def test_database_drop_system_refused(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    monkeypatch.setenv("PGGUARDIAN_ALLOW_DANGEROUS", "1")
    response = client.request(
        "DELETE",
        "/api/v1/databases/postgres",
        json={"confirm": True, "confirm_name": "postgres", "dry_run": True},
    )
    assert response.status_code == 400
    assert "system database" in response.text


def test_role_validation(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    bad = client.post("/api/v1/roles", json={"name": "bad name!", "confirm": True})
    assert bad.status_code == 400
    reserved = client.post("/api/v1/roles", json={"name": "pg_shadow", "confirm": True})
    assert reserved.status_code == 400
    grant = client.post(
        "/api/v1/roles/grants",
        json={
            "role": "app",
            "privilege": "MINDREAD",
            "object_type": "table",
            "object_name": "t",
            "confirm": True,
        },
    )
    assert grant.status_code == 400


def test_identifier_validation(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    response = client.get("/api/v1/schemas/evil;DROP/tables")
    assert response.status_code == 400


def test_config_change_blocked(client: TestClient) -> None:
    response = client.patch(
        "/api/v1/config/shared_buffers", json={"value": "256MB", "confirm": True}
    )
    assert response.status_code == 403


def test_profiles_crud_no_secrets(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in UNREACHABLE.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("PGGUARDIAN_PROFILES_FILE", str(tmp_path / "profiles.json"))
    api = TestClient(create_app())
    created = api.post(
        "/api/v1/profiles",
        json={
            "name": "prod",
            "host": "db.internal",
            "database": "app",
            "username": "app",
            "password": "s3cret",
        },
    )
    assert created.status_code == 200
    assert created.json()["password"] is None
    listed = api.get("/api/v1/profiles")
    assert [profile["name"] for profile in listed.json()] == ["prod"]
    assert api.delete("/api/v1/profiles/prod").status_code == 400
    assert api.delete("/api/v1/profiles/prod?confirm=true").status_code == 200
    assert api.get("/api/v1/profiles/missing").status_code == 404


def test_snapshots_empty_and_prune_guard(client: TestClient) -> None:
    assert client.get("/api/v1/snapshots").status_code == 200
    assert client.post("/api/v1/snapshots").status_code == 503  # no DB
    assert client.post("/api/v1/snapshots/prune").status_code == 400
