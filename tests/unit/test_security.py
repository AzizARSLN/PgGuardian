"""Unit tests for secret masking — passwords must never leak."""

from __future__ import annotations

from pgguardian.utils.security import (
    mask_connection_string,
    mask_secret,
    sanitize_error,
    sanitize_text,
)


def test_mask_secret() -> None:
    assert mask_secret("hunter2") == "***"
    assert mask_secret(None) == "***"
    assert mask_secret("") == "***"


def test_mask_url_password() -> None:
    masked = mask_connection_string("postgresql://alice:s3cret@db:5432/app")
    assert "s3cret" not in masked
    assert "alice" in masked
    assert "***" in masked


def test_mask_conninfo_password() -> None:
    masked = mask_connection_string(
        "host=db port=5432 user=alice password=s3cret connect_timeout=10"
    )
    assert "s3cret" not in masked
    assert "alice" in masked


def test_mask_quoted_conninfo_password() -> None:
    masked = mask_connection_string("host=db user=alice password='s3 cret'")
    assert "s3 cret" not in masked


def test_no_password_left_untouched() -> None:
    conninfo = "host=db port=5432 user=alice connect_timeout=10"
    assert mask_connection_string(conninfo) == conninfo


def test_sanitize_text_replaces_literal_secrets() -> None:
    cleaned = sanitize_text("failed for password hunter2", secrets=["hunter2"])
    assert "hunter2" not in cleaned


def test_sanitize_error_masks_connection_string() -> None:
    exc = RuntimeError("connection to server failed postgresql://bob:pw123@h/db")
    message = sanitize_error(exc, secrets=["pw123"])
    assert "pw123" not in message
    assert "RuntimeError" in message


def test_sanitize_empty_error() -> None:
    assert sanitize_error(ValueError()) == "ValueError"
