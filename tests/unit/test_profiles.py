"""Unit tests for connection profiles (file store, no database needed)."""

from __future__ import annotations

from pathlib import Path

import pytest

from pgguardian.config.settings import get_settings
from pgguardian.database.connection import resolve_connection_string
from pgguardian.profiles.store import Profile, ProfileNotFoundError, ProfileStore


def _store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProfileStore:
    path = tmp_path / "profiles.json"
    monkeypatch.setenv("PGGUARDIAN_PROFILES_FILE", str(path))
    return ProfileStore(path)


def test_save_get_list_delete(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = _store(tmp_path, monkeypatch)
    assert store.list() == []
    store.save(Profile(name="prod", host="db.internal", database="app", username="app"))
    store.save(Profile(name="dev", host="localhost"))
    names = [profile.name for profile in store.list()]
    assert names == ["dev", "prod"]
    fetched = store.get("prod")
    assert fetched.host == "db.internal"
    assert store.delete("prod") is True
    assert store.delete("prod") is False
    with pytest.raises(ProfileNotFoundError):
        store.get("prod")


def test_invalid_name_rejected() -> None:
    with pytest.raises(ValueError):
        Profile(name="bad name!")


def test_redacted_strips_password(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = _store(tmp_path, monkeypatch)
    stored = store.save(Profile(name="p", password="s3cret"))
    assert stored.password == "s3cret"
    assert store.get("p").redacted().password is None


def test_password_env_resolution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = _store(tmp_path, monkeypatch)
    monkeypatch.setenv("PG_PROD_PW", "env-secret")
    store.save(Profile(name="p", password_env="PG_PROD_PW"))
    assert store.get("p").resolve_password() == "env-secret"


def test_default_profile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = _store(tmp_path, monkeypatch)
    store.save(Profile(name="a"))
    store.save(Profile(name="b"))
    assert store.get_default() is None
    store.set_default("b")
    assert store.get_default() is not None
    assert store.get_default().name == "b"  # type: ignore[union-attr]


def test_profile_file_permissions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import os
    import sys

    store = _store(tmp_path, monkeypatch)
    store.save(Profile(name="p", password="s3cret"))
    assert (tmp_path / "profiles.json").is_file()
    if sys.platform != "win32":
        mode = oct(os.stat(tmp_path / "profiles.json").st_mode & 0o777)
        assert mode == "0o600"


def test_profile_overrides_win_over_pg_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGHOST", "wrong-host")
    monkeypatch.setenv("PGDATABASE", "wrong-db")
    profile = Profile(name="prod", host="db.internal", database="appdb", username="app")
    settings = get_settings(**profile.to_overrides())  # type: ignore[arg-type]
    resolved = resolve_connection_string(settings)
    assert "host=db.internal" in resolved
    assert "dbname=appdb" in resolved
    assert "wrong-host" not in resolved
    assert "wrong-db" not in resolved


def test_profile_password_flows_into_conninfo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("PGPASSWORD", raising=False)
    profile = Profile(name="p", password="pw123")
    settings = get_settings(**profile.to_overrides())  # type: ignore[arg-type]
    assert "password=pw123" in resolve_connection_string(settings)
