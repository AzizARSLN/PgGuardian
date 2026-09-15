"""Unit tests for SQL files: presence, read-only posture, parameter style."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SQL_DIR = REPO_ROOT / "sql"

EXPECTED_FILES = [
    "health/overview.sql",
    "health/connections.sql",
    "health/long_running.sql",
    "health/blocking.sql",
    "health/replication.sql",
    "health/maintenance_overview.sql",
    "connections/list.sql",
    "connections/summary.sql",
    "queries/active.sql",
    "queries/long_running.sql",
    "locks/blocking.sql",
    "locks/summary.sql",
    "storage/databases.sql",
    "storage/tables.sql",
    "storage/indexes.sql",
    "indexes/usage.sql",
    "indexes/low_usage.sql",
    "maintenance/tables.sql",
    "maintenance/summary.sql",
]

# Destructive / intrusive operations that must never appear in diagnostics.
FORBIDDEN = [
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_reload_conf",
    "VACUUM FULL",
    "REINDEX",
    "TRUNCATE",
]


def test_all_sql_files_exist() -> None:
    missing = [name for name in EXPECTED_FILES if not (SQL_DIR / name).is_file()]
    assert not missing, f"missing SQL files: {missing}"


def test_sql_files_are_select_only() -> None:
    for name in EXPECTED_FILES:
        text = (SQL_DIR / name).read_text(encoding="utf-8")
        assert re.search(r"(?im)^\s*SELECT\b", text) or "SELECT" in text.upper(), name
        upper = text.upper()
        for keyword in ("INSERT", "CREATE", "ALTER", "GRANT"):
            assert re.search(rf"\b{keyword}\b", upper) is None, f"{name} contains {keyword}"
        for keyword in ("DELETE", "DROP", "TRUNCATE"):
            assert re.search(rf"\b{keyword}\b", upper) is None, f"{name} contains {keyword}"


def test_sql_files_have_no_destructive_calls() -> None:
    for name in EXPECTED_FILES:
        text = (SQL_DIR / name).read_text(encoding="utf-8")
        for forbidden in FORBIDDEN:
            assert forbidden.lower() not in text.lower(), f"{name} contains {forbidden}"


def test_bounded_queries_use_limit() -> None:
    for name in [
        "connections/list.sql",
        "queries/active.sql",
        "queries/long_running.sql",
        "storage/tables.sql",
        "storage/indexes.sql",
        "indexes/usage.sql",
        "maintenance/tables.sql",
    ]:
        text = (SQL_DIR / name).read_text(encoding="utf-8")
        assert "LIMIT" in text.upper(), f"{name} should bound result size with LIMIT"
