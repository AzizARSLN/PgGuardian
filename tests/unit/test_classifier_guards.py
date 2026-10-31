"""Statements that look harmless by first keyword but are not."""

from __future__ import annotations

import pytest

from pgguardian.sqlexec.classifier import StatementKind, classify


@pytest.mark.parametrize(
    "sql",
    [
        "ALTER SYSTEM SET work_mem = '1GB'",
        "COPY t TO PROGRAM 'curl evil'",
        "ALTER ROLE app SUPERUSER",
        "DO $$ BEGIN DROP TABLE t; END $$",
        "SELECT pg_read_file('/etc/passwd')",
        "EXPLAIN ANALYZE DROP TABLE t",
    ],
)
def test_dangerous(sql: str) -> None:
    assert classify(sql) == StatementKind.DANGEROUS


@pytest.mark.parametrize(
    "sql",
    [
        "WITH d AS (DELETE FROM t RETURNING id) SELECT * FROM d",
        "SELECT a INTO b FROM c",
        "EXPLAIN ANALYZE DELETE FROM t",
        "EXPLAIN (ANALYZE, FORMAT JSON) UPDATE t SET a = 1",
    ],
)
def test_writes_hidden_behind_read_keywords(sql: str) -> None:
    assert classify(sql) == StatementKind.WRITE


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 'DELETE FROM t'",
        "SELECT 'pg_read_file'",
        "SELECT a FROM my_pg_read_file_log",
        "EXPLAIN DELETE FROM t",
        "EXPLAIN (ANALYZE false) DELETE FROM t",
        "EXPLAIN ANALYZE SELECT 1",
        "WITH x AS (SELECT 1) SELECT * FROM x",
    ],
)
def test_reads_stay_reads(sql: str) -> None:
    assert classify(sql) == StatementKind.READ
