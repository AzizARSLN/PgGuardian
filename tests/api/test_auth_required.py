"""The API must refuse anonymous calls unless auth is explicitly disabled."""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from jwt import encode

from pgguardian.api.app import create_app

SECRET = "auth-required-secret-0123456789-0123456789-abcdef"


def _token(role: str = "Viewer", **extra: object) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    claims = {
        "sub": "1",
        "email": "u@local",
        "role": role,
        "exp": int((now + dt.timedelta(hours=1)).timestamp()),
        "type": "access",
    }
    claims.update(extra)
    return encode(claims, SECRET, algorithm="HS256")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("PGGUARDIAN_JWT_SECRET", SECRET)
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    monkeypatch.setenv("PGGUARDIAN_ALLOW_DANGEROUS", "1")
    monkeypatch.setenv("PGGUARDIAN_CONNECT_TIMEOUT", "1")
    monkeypatch.delenv("PGGUARDIAN_API_TOKEN", raising=False)
    monkeypatch.delenv("PGGUARDIAN_AUTH_DISABLED", raising=False)
    return TestClient(create_app())


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "method,path",
    [("get", "/api/v1/profiles"), ("post", "/api/v1/sql"), ("get", "/api/v1/health")],
)
def test_anonymous_is_rejected(client: TestClient, method: str, path: str) -> None:
    assert getattr(client, method)(path).status_code == 401


def test_refresh_token_is_not_an_access_token(client: TestClient) -> None:
    response = client.get("/api/v1/profiles", headers=_auth(_token(type="refresh")))
    assert response.status_code == 401


def test_viewer_can_list_but_not_change_profiles(client: TestClient) -> None:
    headers = _auth(_token())
    assert client.get("/api/v1/profiles", headers=headers).status_code == 200
    assert client.post("/api/v1/profiles", headers=headers, json={"name": "x"}).status_code == 403


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/v1/databases", {"name": "x", "dry_run": True}),
        ("delete", "/api/v1/databases/x", {"dry_run": True}),
    ],
)
def test_viewer_cannot_manage_databases(
    client: TestClient, method: str, path: str, body: dict
) -> None:
    response = client.request(method.upper(), path, headers=_auth(_token()), json=body)
    assert response.status_code == 403


def test_pending_password_change_blocks_the_api(client: TestClient) -> None:
    headers = _auth(_token("Admin", password_must_change=True))
    assert client.get("/api/v1/profiles", headers=headers).status_code == 403


@pytest.mark.parametrize("name", ["PGGUARDIAN_JWT_SECRET", "PGPASSWORD", "AWS_SECRET_ACCESS_KEY"])
def test_password_env_cannot_reference_other_secrets(client: TestClient, name: str) -> None:
    response = client.post(
        "/api/v1/profiles",
        headers=_auth(_token("Admin")),
        json={"name": "evil", "host": "evil.example", "password_env": name},
    )
    assert response.status_code == 422
