"""Shared pytest fixtures."""

from __future__ import annotations

import pytest

from pgguardian.config.settings import PgGuardianSettings


@pytest.fixture
def settings() -> PgGuardianSettings:
    """Default settings with a non-routable host (never touched by unit tests)."""
    return PgGuardianSettings(host="127.0.0.1", port=55432, database="pgguardian_test")
