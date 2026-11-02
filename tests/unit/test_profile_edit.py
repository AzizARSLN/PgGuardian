"""Editing a profile and testing unsaved connection values."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pgguardian.api.app import create_app
from pgguardian.profiles.store import ProfileStore

SECRET = "stored-secret-pw"


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("PGGUARDIAN_AUTH_DISABLED", "1")
    monkeypatch.setenv("PGGUARDIAN_CONNECT_TIMEOUT", "1")
    monkeypatch.delenv("PGPASSWORD", raising=False)
    client = TestClient(create_app())
    created = client.post(
        "/api/v1/profiles",
        json={"name": "prod", "host": "127.0.0.1", "port": 55990, "password": SECRET},
    )
    assert created.status_code == 200
    return client


def _edit(**changes: object) -> dict:
    return {"name": "prod", "host": "127.0.0.1", "port": 55990, **changes}


def test_empty_password_keeps_the_stored_one(api: TestClient) -> None:
    response = api.put("/api/v1/profiles/prod", json=_edit(database="sales"))
    assert response.status_code == 200
    assert SECRET not in response.text
    stored = ProfileStore().get("prod")
    assert stored.password == SECRET
    assert stored.database == "sales"


@pytest.mark.parametrize("change", [{"host": "evil.example"}, {"port": 5999}])
def test_stored_password_never_follows_a_new_target(api: TestClient, change: dict) -> None:
    response = api.put("/api/v1/profiles/prod", json=_edit(**change))
    assert response.status_code == 400
    assert response.json()["detail"] == "password_required"
    assert ProfileStore().get("prod").host == "127.0.0.1"


def test_new_target_works_with_a_new_password(api: TestClient) -> None:
    response = api.put("/api/v1/profiles/prod", json=_edit(host="db2", password="new-pw"))
    assert response.status_code == 200
    assert ProfileStore().get("prod").password == "new-pw"


def test_clear_password_and_password_env_drop_the_stored_one(api: TestClient) -> None:
    api.put("/api/v1/profiles/prod", json=_edit(password_env="PROD_DB_PASSWORD"))
    assert ProfileStore().get("prod").password is None
    api.put("/api/v1/profiles/prod", json=_edit(password="again"))
    api.put("/api/v1/profiles/prod", json=_edit(clear_password=True))
    assert ProfileStore().get("prod").password is None


def test_rename_moves_the_profile_and_keeps_its_password(api: TestClient) -> None:
    created_at = ProfileStore().get("prod").created_at
    assert api.put("/api/v1/profiles/prod", json=_edit(name="prod-eu")).status_code == 200
    names = [p.name for p in ProfileStore().list()]
    assert names == ["prod-eu"]
    moved = ProfileStore().get("prod-eu")
    assert moved.password == SECRET
    assert moved.created_at == created_at


def test_rename_cannot_overwrite_another_profile(api: TestClient) -> None:
    api.post("/api/v1/profiles", json={"name": "other"})
    assert api.put("/api/v1/profiles/prod", json=_edit(name="other")).status_code == 409
    assert api.put("/api/v1/profiles/missing", json=_edit()).status_code == 404


def test_only_one_default_remains(api: TestClient) -> None:
    api.post("/api/v1/profiles", json={"name": "a", "is_default": True})
    api.post("/api/v1/profiles", json={"name": "b", "is_default": True})
    api.put("/api/v1/profiles/prod", json=_edit(is_default=True))
    assert [p.name for p in ProfileStore().list() if p.is_default] == ["prod"]


def test_form_test_reports_failure_and_saves_nothing(api: TestClient) -> None:
    response = api.post("/api/v1/profiles/test", json={"host": "127.0.0.1", "port": 55991})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["message"]
    assert [p.name for p in ProfileStore().list()] == ["prod"]


def test_form_test_does_not_send_stored_password_elsewhere(api: TestClient) -> None:
    response = api.post(
        "/api/v1/profiles/test",
        json={"host": "evil.example", "port": 5432, "existing_name": "prod"},
    )
    assert response.json() == {
        "ok": False,
        "version": None,
        "reason": "password_required",
        "message": None,
    }
