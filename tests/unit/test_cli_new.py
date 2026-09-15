"""CLI tests for profile / query / snapshot / serve commands (no live DB)."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from pgguardian.cli.app import app

runner = CliRunner()


@pytest.fixture
def profiles_file(tmp_path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "profiles.json"
    monkeypatch.setenv("PGGUARDIAN_PROFILES_FILE", str(path))
    return path


@pytest.fixture
def snapshots_file(tmp_path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "snapshots.db"
    monkeypatch.setenv("PGGUARDIAN_SNAPSHOTS_FILE", str(path))
    return path


def test_help_lists_new_commands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ["profile", "query", "snapshot", "history", "serve"]:
        assert command in result.output
    assert "--profile" in result.output


def test_profile_add_list_show_remove(profiles_file) -> None:
    assert (
        runner.invoke(
            app,
            [
                "profile",
                "add",
                "--name",
                "prod",
                "--host",
                "db.internal",
                "--database",
                "app",
                "--username",
                "app",
                "--server",
                "s1",
            ],
        ).exit_code
        == 0
    )
    listed = runner.invoke(app, ["profile", "list"])
    assert listed.exit_code == 0
    assert "prod" in listed.output
    shown = runner.invoke(app, ["profile", "show", "prod"])
    assert shown.exit_code == 0
    assert "db.internal" in shown.output
    missing = runner.invoke(app, ["profile", "show", "nope"])
    assert missing.exit_code == 3
    refused = runner.invoke(app, ["profile", "remove", "prod"])
    assert refused.exit_code == 3
    removed = runner.invoke(app, ["profile", "remove", "prod", "--yes"])
    assert removed.exit_code == 0
    assert runner.invoke(app, ["profile", "list"]).exit_code == 0


def test_profile_invalid_name(profiles_file) -> None:
    result = runner.invoke(app, ["profile", "add", "--name", "bad name!"])
    assert result.exit_code == 3


def test_profile_set_default(profiles_file) -> None:
    runner.invoke(app, ["profile", "add", "--name", "a"])
    assert runner.invoke(app, ["profile", "set-default", "a"]).exit_code == 0
    assert runner.invoke(app, ["profile", "set-default", "missing"]).exit_code == 3


def test_unknown_profile_fails_fast() -> None:
    result = runner.invoke(app, ["--profile", "does-not-exist", "--timeout", "1", "health"])
    assert result.exit_code == 3
    assert "does-not-exist" in result.output


def test_query_dry_run_needs_no_db() -> None:
    result = runner.invoke(app, ["query", "--sql", "SELECT 1", "--dry-run"])
    assert result.exit_code == 0
    assert "READ" in result.output


def test_query_rejects_multi_statement() -> None:
    result = runner.invoke(app, ["query", "--sql", "SELECT 1; SELECT 2"])
    assert result.exit_code == 3


def test_query_write_needs_flags() -> None:
    result = runner.invoke(app, ["query", "--sql", "CREATE TABLE t (a int)"])
    assert result.exit_code == 3
    result = runner.invoke(app, ["query", "--sql", "CREATE TABLE t (a int)", "--write"])
    assert result.exit_code == 3  # still needs --confirm
    assert "confirm" in result.output.lower()


def test_query_unreachable_host_exit_3() -> None:
    result = runner.invoke(
        app,
        ["--host", "127.0.0.1", "--port", "55432", "--timeout", "1", "query", "--sql", "SELECT 1"],
    )
    assert result.exit_code == 3


def test_snapshot_unreachable_host_exit_3(snapshots_file) -> None:
    result = runner.invoke(
        app, ["--host", "127.0.0.1", "--port", "55432", "--timeout", "1", "snapshot"]
    )
    assert result.exit_code == 3


def test_history_empty_ok(snapshots_file) -> None:
    result = runner.invoke(app, ["history"])
    assert result.exit_code == 0


def test_serve_describe_option() -> None:
    result = runner.invoke(app, ["serve", "--help"])
    assert result.exit_code == 0
    assert "--port" in result.output
