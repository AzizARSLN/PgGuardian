"""Role-based access control tests: Viewer read-only + Admin/DBA write-allowed.

We deliberately use the JWT auth path (set a static secret) and send JWTs
so the require_role_OR_open guard enforces its rules. The DB is unreachable
so read endpoints will return 503 (not 403) — we assert only that
the role check doesn't reject them (i.e., status != 403).
"""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from jwt import encode

from pgguardian.api.app import create_app

JWT_SECRET = "role-guard-secret-abc-12345-a0123456789-very-long-pass"

UNREACHABLE = {
    "PGHOST": "127.0.0.1",
    "PGPORT": "55432",
    "PGDATABASE": "pgguardian_test",
    "PGUSER": "tester",
    "PGPASSWORD": "secret",
    "PGGUARDIAN_CONNECT_TIMEOUT": "1",
    "PGGUARDIAN_JWT_SECRET": JWT_SECRET,
    "PGGUARDIAN_ALLOW_WRITES": "1",
    "PGGUARDIAN_ALLOW_DANGEROUS": "1",
}


def _tok(role: str, user_id: int = 99, email: str = "u@local") -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return encode(
        {
            "sub": str(user_id),
            "email": email,
            "name": "Tester",
            "role": role,
            "password_must_change": False,
            "iat": int(now.timestamp()),
            "exp": int((now + dt.timedelta(hours=1)).timestamp()),
            "type": "access",
        },
        JWT_SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    for key, value in UNREACHABLE.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("PGGUARDIAN_API_TOKEN", raising=False)
    return TestClient(create_app())


def h(role: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {_tok(role)}"}


# --- Viewer allowed (read-only) endpoints should not return 403 ---


def test_viewer_accesses_diagnostics(client: TestClient) -> None:
    """Viewer hits /health/diagnose endpoints: must not be 403."""
    status = client.get("/api/v1/health", headers=h("Viewer")).status_code
    assert status != 403


def test_viewer_accesses_schemas(client: TestClient) -> None:
    """Viewer can access schemas endpoints."""
    status = client.get("/api/v1/schemas", headers=h("Viewer")).status_code
    assert status != 403


def test_viewer_accesses_databases(client: TestClient) -> None:
    """Viewer can list databases."""
    status = client.get("/api/v1/databases", headers=h("Viewer")).status_code
    assert status != 403


def test_viewer_accesses_replication(client: TestClient) -> None:
    """Viewer can list replication status."""
    status = client.get("/api/v1/replication", headers=h("Viewer")).status_code
    assert status != 403


def test_viewer_accesses_diagnose(client: TestClient) -> None:
    """Viewer can run diagnose endpoint."""
    status = client.post("/api/v1/diagnose", headers=h("Viewer"), json={}).status_code
    assert status != 403


# --- Viewer forbidden (mutation) endpoints must return 403 ---


def test_viewer_blocked_on_sql_execution(client: TestClient) -> None:
    """Viewer hits sql endpoint: 403."""
    res = client.post(
        "/api/v1/sql",
        headers=h("Viewer"),
        json={"sql": "SELECT 1"},
    )
    assert res.status_code == 403


def test_viewer_blocked_on_profiles_crud(client: TestClient) -> None:
    """Viewer cannot POST profiles."""
    res = client.post(
        "/api/v1/profiles",
        headers=h("Viewer"),
        json={
            "name": "prod",
            "host": "db.local",
            "database": "app",
            "username": "app",
            "password": "pw",
        },
    )
    assert res.status_code == 403


def test_viewer_blocked_on_roles_crud(client: TestClient) -> None:
    """Viewer cannot create roles."""
    res = client.post(
        "/api/v1/roles",
        headers=h("Viewer"),
        json={"name": "app_user", "confirm": True},
    )
    assert res.status_code == 403


def test_viewer_blocked_on_query_cancel(client: TestClient) -> None:
    """Viewer cannot cancel queries."""
    res = client.post(
        "/api/v1/queries/123/cancel",
        headers=h("Viewer"),
        json={"confirm": True, "dry_run": True},
    )
    assert res.status_code == 403


def test_viewer_blocked_on_maintenance_ops(client: TestClient) -> None:
    """Viewer cannot trigger vacuum."""
    res = client.post(
        "/api/v1/maintenance/vacuum",
        headers=h("Viewer"),
        json={"confirm": True, "dry_run": True},
    )
    assert res.status_code == 403


def test_viewer_blocked_on_config_patch(client: TestClient) -> None:
    """Viewer cannot patch postgresql config."""
    res = client.patch(
        "/api/v1/config/shared_buffers",
        headers=h("Viewer"),
        json={"value": "256MB", "confirm": True},
    )
    assert res.status_code == 403


# --- DBA / Admin can hit mutation endpoints (role check passes, DB returns 503/400). ---


def test_dba_allowed_snapshots_prune_role_check(client: TestClient) -> None:
    """DBA can reach snapshots prune (role check passes; 400 for missing params)."""
    status = client.post(
        "/api/v1/snapshots/prune",
        headers=h("DBA"),
        json={},
    ).status_code
    assert status != 403


def test_admin_allowed_backups_restore_role_check(client: TestClient) -> None:
    """Admin can hit backups endpoint (role check passes)."""
    status = client.post(
        "/api/v1/backups",
        headers=h("Admin"),
        json={"confirm": True, "dry_run": True},
    ).status_code
    assert status != 403


def test_no_auth_header_401_when_jwt_mode(client: TestClient) -> None:
    """With JWT mode on (secret set, no legacy api token), missing header on Admin endpoint -> 401."""
    res = client.get("/api/v1/users")
    assert res.status_code == 401


def test_bad_jwt_signature_401(client: TestClient) -> None:
    """Token signed with wrong secret on Admin endpoint -> 401."""
    bad = encode(
        {"sub": "1", "email": "a@b.c", "role": "Admin", "exp": 9999999999},
        "different-secret",
        algorithm="HS256",
    )
    res = client.get("/api/v1/users", headers={"Authorization": f"Bearer {bad}"})
    assert res.status_code == 401
