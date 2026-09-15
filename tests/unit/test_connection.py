"""Unit tests for connection-string resolution (no live database needed)."""

from __future__ import annotations

import pytest

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import (
    build_connection_params,
    parse_server_version_num,
    resolve_connection_string,
)


def test_cli_connection_string_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGGUARDIAN_CONNECTION_STRING", "host=env dbname=x")
    settings = PgGuardianSettings()
    resolved = resolve_connection_string(settings, cli_connection_string="host=cli dbname=y")
    assert resolved == "host=cli dbname=y"


def test_env_connection_string_used() -> None:
    settings = PgGuardianSettings(connection_string="host=env dbname=x")
    assert resolve_connection_string(settings) == "host=env dbname=x"


def test_pg_env_vars_compose_conninfo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGHOST", "pg.internal")
    monkeypatch.setenv("PGPORT", "5433")
    monkeypatch.setenv("PGDATABASE", "appdb")
    monkeypatch.setenv("PGUSER", "appuser")
    monkeypatch.setenv("PGPASSWORD", "topsecret")
    settings = PgGuardianSettings()
    resolved = resolve_connection_string(settings)
    assert "host=pg.internal" in resolved
    assert "port=5433" in resolved
    assert "dbname=appdb" in resolved
    assert "user=appuser" in resolved
    assert "password=topsecret" in resolved


def test_conninfo_without_password_omits_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PGPASSWORD", raising=False)
    settings = PgGuardianSettings(password=None)
    resolved = resolve_connection_string(settings)
    assert "password" not in resolved


def test_connection_params_repr_hides_password() -> None:
    settings = PgGuardianSettings(password="topsecret")
    params = build_connection_params(settings)
    assert "topsecret" not in repr(params)
    assert params.password is None


def test_parse_server_version_num() -> None:
    assert parse_server_version_num("PostgreSQL 16.10 on x86_64-pc-linux-gnu") == 160010
    assert parse_server_version_num("PostgreSQL 13 on aarch64") == 130000
    assert parse_server_version_num("not postgres") == 0
