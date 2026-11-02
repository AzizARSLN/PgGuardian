"""Shared pytest fixtures."""

from __future__ import annotations

import pytest

from pgguardian.api.settings import ApiSettings
from pgguardian.config.settings import PgGuardianSettings

# A developer's local .env must not change what the suite sees.
PgGuardianSettings.model_config["env_file"] = None
ApiSettings.model_config["env_file"] = None


@pytest.fixture(autouse=True)
def _isolated_profiles(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the real ~/.config profile store out of the tests."""
    monkeypatch.setenv("PGGUARDIAN_PROFILES_FILE", str(tmp_path / "profiles.json"))


@pytest.fixture
def settings() -> PgGuardianSettings:
    """Default settings with a non-routable host (never touched by unit tests)."""
    return PgGuardianSettings(host="127.0.0.1", port=55432, database="pgguardian_test")
