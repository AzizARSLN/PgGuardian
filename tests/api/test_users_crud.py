"""Users CRUD tests: Admin-only endpoints, role checks, password handling."""

from __future__ import annotations

import datetime as dt
import json
from unittest.mock import MagicMock

import bcrypt
import pytest
from fastapi.testclient import TestClient
from jwt import encode

from pgguardian.api.app import create_app
from pgguardian.database.connection import DbClient

JWT_SECRET = "users-test-secret-xyz-12345-0123456789-abcdef-super-long"

UNREACHABLE = {
    "PGHOST": "127.0.0.1",
    "PGPORT": "55432",
    "PGDATABASE": "pgguardian_test",
    "PGUSER": "tester",
    "PGPASSWORD": "secret",
    "PGGUARDIAN_CONNECT_TIMEOUT": "1",
    "PGGUARDIAN_JWT_SECRET": JWT_SECRET,
}


def _token(user_id: int, email: str, role: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return encode(
        {
            "sub": str(user_id),
            "email": email,
            "name": email.split("@")[0],
            "role": role,
            "password_must_change": False,
            "iat": int(now.timestamp()),
            "exp": int((now + dt.timedelta(hours=12)).timestamp()),
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


def _headers(user_id: int = 1, email: str = "admin@local", role: str = "Admin") -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user_id, email, role)}"}


SAMPLE_USERS = [
    {
        "id": 1,
        "email": "admin@local",
        "full_name": "Admin",
        "app_role": "Admin",
        "is_active": True,
        "password_must_change": False,
        "created_at": None,
        "last_login": None,
    },
    {
        "id": 2,
        "email": "dba@local",
        "full_name": "DBA",
        "app_role": "DBA",
        "is_active": True,
        "password_must_change": False,
        "created_at": None,
        "last_login": None,
    },
    {
        "id": 3,
        "email": "viewer@local",
        "full_name": "Viewer",
        "app_role": "Viewer",
        "is_active": True,
        "password_must_change": False,
        "created_at": None,
        "last_login": None,
    },
]


def test_list_users_admin_ok(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Admin can list users (200)."""
    monkeypatch.setattr(DbClient, "fetch_all", lambda self, sql, params=None: SAMPLE_USERS)
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: None)
    monkeypatch.setattr(DbClient, "execute_raw", lambda self, *a, **kw: "OK")

    res = client.get("/api/v1/users", headers=_headers())
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3
    assert data[0]["email"] == "admin@local"
    assert data[1]["role"] == "DBA"


def test_list_users_search_filter(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Search query filters users."""
    called = {}

    def fake_fetch_all(self, sql, params=None):
        called["params"] = params
        if params and "viewer" in params[0]:
            return [SAMPLE_USERS[2]]
        return SAMPLE_USERS

    monkeypatch.setattr(DbClient, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: None)

    res = client.get("/api/v1/users?search=viewer", headers=_headers())
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert "viewer" in called["params"][0]


def test_create_user_admin_201(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Admin can create users (201) with valid payload."""
    inserted = {}
    def fake_fetch_one(self, sql, params=None):
        if "INSERT INTO pgguardian_users" in sql and params and "RETURNING id" in sql:
            inserted["email"] = params[0]
            inserted["role"] = params[3]
            inserted["must_change"] = params[5]
            return {"id": 9}
        if "SELECT id FROM pgguardian_users WHERE lower" in sql:
            return None
        if "SELECT id, email" in sql:
            return {
                "id": 9,
                "email": "new@local",
                "full_name": "New User",
                "app_role": "Viewer",
                "is_active": True,
                "password_must_change": True,
                "created_at": None,
                "last_login": None,
            }
        return None
    monkeypatch.setattr(DbClient, "fetch_one", fake_fetch_one)
    monkeypatch.setattr(DbClient, "fetch_all", lambda self, sql, params=None: [])
    monkeypatch.setattr(DbClient, "execute_raw", lambda self, sql, params=None: "OK")

    body = {
        "email": "new@local",
        "full_name": "New User",
        "password": "supersecret1",
        "app_role": "Viewer",
        "password_must_change": True,
    }
    res = client.post("/api/v1/users", headers=_headers(), json=body)
    assert res.status_code == 201
    assert inserted["email"] == "new@local"
    assert inserted["role"] == "Viewer"
    assert inserted["must_change"] is True


def test_create_user_invalid_role_400(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Invalid app_role returns 400."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: None)
    body = {
        "email": "bad@local",
        "full_name": "X",
        "password": "secretpass",
        "app_role": "Superuser",
    }
    res = client.post("/api/v1/users", headers=_headers(), json=body)
    assert res.status_code == 400


def test_create_user_short_password_400(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Password shorter than 8 chars -> 400."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: None)
    body = {
        "email": "bad@local",
        "full_name": "X",
        "password": "short",
        "app_role": "Viewer",
    }
    res = client.post("/api/v1/users", headers=_headers(), json=body)
    assert res.status_code == 400


def test_create_user_duplicate_email_409(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Duplicate email -> 409 conflict."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: {"id": 9})
    body = {
        "email": "admin@local",
        "full_name": "X",
        "password": "secret1234",
        "app_role": "DBA",
    }
    res = client.post("/api/v1/users", headers=_headers(), json=body)
    assert res.status_code == 409


def test_update_user_patch_200(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """PATCH updates user fields."""
    updated = {}
    def fake_fetch_one(self, sql, params=None):
        if "SELECT id, email, full_name, app_role" in sql or "WHERE id = %s" in sql:
            return {
                "id": 3,
                "email": "viewer@local",
                "full_name": "Updated",
                "app_role": "DBA",
                "is_active": True,
                "password_must_change": False,
                "created_at": None,
                "last_login": None,
            }
        return {"id": 3}
    monkeypatch.setattr(DbClient, "fetch_one", fake_fetch_one)
    monkeypatch.setattr(DbClient, "fetch_all", lambda self, sql, params=None: [])

    def fake_exec(self, sql, params=None):
        if "UPDATE pgguardian_users SET" in sql and params:
            updated["role"] = params[0]
            updated["where"] = params[-1]
        return "UPDATE 1"

    monkeypatch.setattr(DbClient, "execute_raw", fake_exec)

    res = client.patch("/api/v1/users/3", headers=_headers(), json={"app_role": "DBA"})
    assert res.status_code == 200
    assert updated["role"] == "DBA"
    assert updated["where"] == 3
    assert res.json()["role"] == "DBA"


def test_deactivate_other_user_204(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Admin deactivates another user -> 204."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: {"id": 3})
    executed = []
    monkeypatch.setattr(
        DbClient,
        "execute_raw",
        lambda self, sql, params=None: executed.append((sql, params)) or "OK",
    )
    res = client.delete("/api/v1/users/3", headers=_headers(user_id=1, role="Admin"))
    assert res.status_code == 204
    statements = [s[0] for s in executed]
    assert any("UPDATE pgguardian_users SET is_active = FALSE" in s for s in statements)
    assert any("DELETE FROM pgguardian_sessions" in s for s in statements)


def test_admin_cannot_deactivate_self_400(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Admin cannot deactivate themselves -> 400."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: {"id": 1})
    res = client.delete("/api/v1/users/1", headers=_headers(user_id=1, role="Admin"))
    assert res.status_code == 400


def test_reset_password_204(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Admin reset password -> 204, sessions revoked."""
    monkeypatch.setattr(DbClient, "fetch_one", lambda self, sql, params=None: {"id": 3})
    executed = []
    monkeypatch.setattr(
        DbClient,
        "execute_raw",
        lambda self, sql, params=None: executed.append(sql) or "OK",
    )
    res = client.post(
        "/api/v1/users/3/reset_password",
        headers=_headers(),
        json={"new_password": "new-secret-pass"},
    )
    assert res.status_code == 204
    assert any("UPDATE pgguardian_users SET password_hash" in s for s in executed)
    assert any("DELETE FROM pgguardian_sessions" in s for s in executed)


def test_viewer_cannot_create_users_403(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Viewer cannot hit users endpoints -> 403."""
    monkeypatch.setattr(DbClient, "fetch_all", lambda self, sql, params=None: SAMPLE_USERS)
    res = client.get(
        "/api/v1/users",
        headers=_headers(user_id=3, email="viewer@local", role="Viewer"),
    )
    assert res.status_code == 403
