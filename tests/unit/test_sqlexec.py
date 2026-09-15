"""Unit tests for the SQL classifier (no database needed)."""

from __future__ import annotations

import pytest

from pgguardian.sqlexec.classifier import (
    SqlRejectedError,
    StatementKind,
    classify,
    ensure_allowed,
    split_statements,
    strip_comments,
)


def test_read_statements() -> None:
    assert classify("SELECT 1") == StatementKind.READ
    assert classify("  -- comment\nWITH x AS (SELECT 1) SELECT * FROM x") == StatementKind.READ
    assert classify("/* block */ EXPLAIN SELECT 1") == StatementKind.READ
    assert classify("SHOW max_connections") == StatementKind.READ
    assert classify("VALUES (1), (2)") == StatementKind.READ
    assert classify("(SELECT 1)") == StatementKind.READ


def test_locking_read_needs_write() -> None:
    assert classify("SELECT * FROM t FOR UPDATE") == StatementKind.NEEDS_WRITE


def test_write_statements() -> None:
    assert classify("INSERT INTO t VALUES (1)") == StatementKind.WRITE
    assert classify("UPDATE t SET a = 1") == StatementKind.WRITE
    assert classify("VACUUM ANALYZE t") == StatementKind.WRITE
    assert classify("CREATE INDEX i ON t (a)") == StatementKind.WRITE


def test_dangerous_statements() -> None:
    assert classify("DROP TABLE t") == StatementKind.DANGEROUS
    assert classify("TRUNCATE t") == StatementKind.DANGEROUS
    assert classify("SELECT pg_terminate_backend(123)") == StatementKind.DANGEROUS
    assert classify("SELECT pg_cancel_backend(123)") == StatementKind.DANGEROUS


def test_empty_and_multi_rejected() -> None:
    assert classify("-- nothing here") == StatementKind.EMPTY
    with pytest.raises(SqlRejectedError):
        classify("SELECT 1; SELECT 2")


def test_semicolon_in_string_is_single_statement() -> None:
    assert split_statements("SELECT 'a;b'") == ["SELECT 'a;b'"]
    assert split_statements("SELECT $$a;b$$") == ["SELECT $$a;b$$"]


def test_commented_keyword_does_not_fool_classifier() -> None:
    assert classify("-- DROP TABLE t\nSELECT 1") == StatementKind.READ
    assert strip_comments("SELECT 1 /* DROP */") == "SELECT 1 "


def test_unknown_statement_rejected() -> None:
    with pytest.raises(SqlRejectedError):
        classify("FROBNICATE THE wobble")


def test_ensure_allowed_matrix() -> None:
    ensure_allowed(StatementKind.READ)
    ensure_allowed(StatementKind.WRITE, allow_write=True)
    with pytest.raises(SqlRejectedError):
        ensure_allowed(StatementKind.WRITE)
    with pytest.raises(SqlRejectedError):
        ensure_allowed(StatementKind.DANGEROUS, allow_write=True)
    ensure_allowed(StatementKind.DANGEROUS, allow_write=True, allow_dangerous=True)
    with pytest.raises(SqlRejectedError):
        ensure_allowed(StatementKind.EMPTY, allow_write=True, allow_dangerous=True)
