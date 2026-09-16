"""Auth endpoint tests: login, logout, refresh, /me, change_password.

All DB access is mocked so tests run without PostgreSQL.
"""

from __future__ import annotations

import bcrypt
import pytest
from fastapi.testclient import TestClient
from jwt import encode

from pgguardian.api.app import create_app
from pgguardian.database.connection import DbClient

JWT_SECRET = "test-secret-do-not-use-in-prod-please"

UNREACHABLE = {
    "PGHOST": "127.0.0.1",
    "PGPORT": "55432",
    "PGDATABASE": "pgguardian_test",
    "PGUSER": "tester",
    "PGPASSWORD": "secret",
    "PGGUARDIAN_CONNECT_TIMEOUT": "1",
    "PGGUARDIAN_JWT_SECRET": JWT_SECRET,
}

TEST_PASSWORD = "secret1234"
TEST_HASH = bcrypt.hashpw(TEST_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
ADMIN_ROW = {
    "id": 1,
    "email": "admin@local",
    "full_name": "Admin User",
    "password_hash": TEST_HASH,
    "app_role": "Admin",
    "is_active": True,
    "password_must_change": False,
}
VIEWER_ROW = {
    "id": 2,
    "email": "viewer@local",
    "full_name": "Viewer User",
    "password_hash": TEST_HASH,
    "app_role": "Viewer",
    "is_active": True,
    "password_must_change": False,
}


def _make_access(user_id: int, email: str, role: str, name: str = "Tester") -> str:
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "name": name,
        "role": role,
        "password_must_change": False,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=12)).timestamp()),
        "type": "access",
    }
    return encode(payload, JWT_SECRET, algorithm="HS256")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    for key, value in UNREACHABLE.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("PGGUARDIAN_API_TOKEN", raising=False)
    return TestClient(create_app())


def test_login_success_returns_access_and_cookie(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Valid credentials -> access token body + HttpOnly refresh cookie."""
    def fake_fetch_one(self, sql, params=None):
        if "SELECT id, email, full_name, password_hash" in sql:
            return ADMIN_ROW
        if "SELECT count(*)" in sql:
            return {"c": 1}
        return {"id": 1}

    def fake_execute_raw(self, *args, **kwargs):
        return "OK"

    monkeypatch.setattr(DbClient, "fetch_one", fake_fetch_one)
    monkeypatch.setattr(DbClient, "fetch_all", lambda self, sql, params=None: [])
    monkeypatch.setattr(DbClient, "execute_raw", fake_execute_raw)

    res = client.post("/api/v1/auth/login", json={"email": "admin@local", "password": TEST_PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 43200
    assert body["access_token"]
    assert body["user"]["email"] == "admin@local"
    assert body["user"]["role"] == "Admin"
    assert "pgg_refresh" in res.cookies
    assert res.cookies.get("pgg_refresh")


def test_login_wrong_password_401(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Wrong password -> 401 with generic message."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: ADMIN_ROW)
    monkeypatch.setattr(DbClient, "fetch_all", lambda self, sql, params=None: [])
    monkeypatch.setattr(DbClient, "execute_raw", lambda self, *a, **kw: "OK")

    res = client.post("/api/v1/auth/login", json={"email": "admin@local", "password": "WRONG"})
    assert res.status_code == 401
    assert "Invalid" in res.json()["detail"]


def test_login_inactive_user_blocked(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Inactive accounts cannot log in."""
    disabled = {**ADMIN_ROW, "is_active": False}
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: disabled)
    monkeypatch.setattr(DbClient, "execute_raw", lambda self, *a, **kw: "OK")

    res = client.post("/api/v1/auth/login", json={"email": "admin@local", "password": TEST_PASSWORD})
    assert res.status_code == 401
    assert "disabled" in res.json()["detail"].lower()


def test_me_returns_user_from_jwt(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /me returns user data using the JWT claims."""
    token = _make_access(1, "admin@local", "Admin", "Admin User")
    fetched = {
        "id": 1,
        "email": "admin@local",
        "full_name": "Admin User",
        "app_role": "Admin",
        "password_must_change": False,
    }
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: fetched)
    monkeypatch.setattr(DbClient, "execute_raw", lambda self, *a, **kw: "OK")

    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "admin@local"
    assert body["role"] == "Admin"
    assert body["id"] == 1


def test_logout_clears_cookie_and_204(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /logout returns 204 and deletes the refresh cookie."""
    token = _make_access(1, "admin@local", "Admin")
    executed = []

    def fake_exec(self, sql, params=None):
        executed.append(sql)
        return "OK"

    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: None)
    monkeypatch.setattr(DbClient, "execute_raw", fake_exec)
    client.cookies.set("pgg_refresh", "some-refresh-value")

    res = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 204
    assert any("DELETE FROM pgguardian_sessions" in s for s in executed)


def test_refresh_with_cookie_issues_new_access(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /refresh exchanges a valid cookie for a new access token."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    refresh_token = encode(
        {
            "sub": "2",
            "email": "viewer@local",
            "role": "Viewer",
            "type": "refresh",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=7)).timestamp()),
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    session_row = {
        "id": 42,
        "user_id": 2,
        "email": "viewer@local",
        "full_name": "Viewer User",
        "app_role": "Viewer",
        "is_active": True,
        "password_must_change": False,
    }
    calls = []

    def fake_fetch(self, sql, params=None):
        calls.append(sql)
        if "SELECT s.id, s.user_id" in sql:
            return session_row
        return None

    def fake_exec(self, *a, **kw):
        return "OK"

    monkeypatch.setattr(DbClient, "fetch_one", fake_fetch)
    monkeypatch.setattr(DbClient, "execute_raw", fake_exec)
    client.cookies.set("pgg_refresh", refresh_token)

    res = client.post("/api/v1/auth/refresh")
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["role"] == "Viewer"
    assert body["access_token"]
    assert "pgg_refresh" in res.cookies
