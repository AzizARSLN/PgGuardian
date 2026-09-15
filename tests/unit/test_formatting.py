"""Unit tests for formatting helpers, including NULL/edge cases."""

from __future__ import annotations

from datetime import datetime

from pgguardian.utils import formatting as fmt


def test_format_bytes_edges() -> None:
    assert fmt.format_bytes(None) == "n/a"
    assert fmt.format_bytes(0) == "0 B"
    assert fmt.format_bytes(512) == "512 B"
    assert fmt.format_bytes(1024) == "1.0 KB"
    assert fmt.format_bytes(1536) == "1.5 KB"
    assert fmt.format_bytes(1024**2) == "1.0 MB"
    assert fmt.format_bytes(5 * 1024**3) == "5.0 GB"
    assert fmt.format_bytes(2 * 1024**4) == "2.0 TB"
    assert fmt.format_bytes(-1) == "n/a"


def test_format_duration_edges() -> None:
    assert fmt.format_duration(None) == "n/a"
    assert fmt.format_duration(0) == "0.0s"
    assert fmt.format_duration(6.5) == "6.5s"
    assert fmt.format_duration(90) == "1m 30s"
    assert fmt.format_duration(3661) == "1h 1m 1s"
    assert fmt.format_duration(90000) == "1d 1h 0m"


def test_format_percent_and_count() -> None:
    assert fmt.format_percent(None) == "n/a"
    assert fmt.format_percent(99.2) == "99.2%"
    assert fmt.format_count(None) == "n/a"
    assert fmt.format_count(1234567) == "1,234,567"


def test_format_timestamp() -> None:
    assert fmt.format_timestamp(None) == "never"
    assert fmt.format_timestamp(datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02 03:04:05"


def test_truncate() -> None:
    assert fmt.truncate(None) == ""
    assert fmt.truncate("  a   b  ", 10) == "a b"
    long_text = "x" * 200
    assert fmt.truncate(long_text, 120).endswith("…")
    assert len(fmt.truncate(long_text, 120)) == 120
