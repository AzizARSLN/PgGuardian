"""CLI-level tests: help, version, exit codes and secret safety (no live DB)."""

from __future__ import annotations

from typer.testing import CliRunner

from pgguardian.cli.app import app

runner = CliRunner()


def test_help_lists_subcommands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in [
        "health",
        "diagnose",
        "connections",
        "queries",
        "locks",
        "storage",
        "indexes",
        "maintenance",
        "report",
    ]:
        assert command in result.output


def test_version_flag() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "pgguardian" in result.output


def test_queries_subcommands_listed() -> None:
    result = runner.invoke(app, ["queries", "--help"])
    assert result.exit_code == 0
    assert "long-running" in result.output
    assert "active" in result.output


def test_storage_subcommands_listed() -> None:
    result = runner.invoke(app, ["storage", "--help"])
    assert result.exit_code == 0
    assert "databases" in result.output
    assert "tables" in result.output
    assert "indexes" in result.output


def test_health_unreachable_host_exit_code_3() -> None:
    result = runner.invoke(
        app,
        ["--host", "127.0.0.1", "--port", "55432", "--timeout", "1", "health"],
    )
    assert result.exit_code == 3
    assert "Unable to connect" in result.output


def test_password_never_leaks_into_errors() -> None:
    result = runner.invoke(
        app,
        [
            "--host",
            "127.0.0.1",
            "--port",
            "55432",
            "--timeout",
            "1",
            "--password",
            "s3cret-pw-xyz",
            "health",
        ],
    )
    assert result.exit_code == 3
    assert "s3cret-pw-xyz" not in result.output
    assert "s3cret-pw-xyz" not in (result.stderr or "")


def test_diagnose_unreachable_host_exit_code_3() -> None:
    result = runner.invoke(
        app, ["--host", "127.0.0.1", "--port", "55432", "--timeout", "1", "diagnose"]
    )
    assert result.exit_code == 3


def test_report_json_unreachable_host_exit_code_3() -> None:
    result = runner.invoke(
        app,
        ["--host", "127.0.0.1", "--port", "55432", "--timeout", "1", "report", "--format", "json"],
    )
    assert result.exit_code == 3
