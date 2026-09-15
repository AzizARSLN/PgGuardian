"""Central configuration for PgGuardian.

Precedence (highest first): CLI options > environment variables > defaults.

Connection resolution additionally honours, in order:
1. ``--connection-string`` / ``PGGUARDIAN_CONNECTION_STRING``
2. Standard PostgreSQL variables (``PGHOST``, ``PGPORT``, ``PGDATABASE``,
   ``PGUSER``, ``PGPASSWORD``)
3. Individual PgGuardian CLI options / ``PGGUARDIAN_*`` variables
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PgGuardianSettings(BaseSettings):
    """Application settings loaded from environment with sensible defaults."""

    model_config = SettingsConfigDict(env_prefix="PGGUARDIAN_", env_file=".env", extra="ignore")

    # Connection
    connection_string: str | None = Field(default=None)
    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    database: str = Field(default="postgres")
    username: str = Field(default="postgres")
    password: str | None = Field(default=None)
    active_profile: str | None = Field(
        default=None,
        description="Name of the active saved profile (informational; set when --profile is used).",
    )
    connect_timeout: int = Field(default=10, description="Connection timeout in seconds.")
    query_timeout_ms: int = Field(default=30000, description="Statement timeout in ms.")

    # Output
    default_limit: int = Field(default=20)

    # Thresholds — connection usage (%)
    connection_usage_warning: float = 80.0
    connection_usage_critical: float = 95.0

    # Thresholds — cache hit ratio (%)
    cache_hit_warning: float = 95.0
    cache_hit_critical: float = 90.0

    # Thresholds — long-running queries (seconds)
    long_query_warning_seconds: int = 60
    long_query_critical_seconds: int = 300

    # Thresholds — dead tuple ratio (%)
    dead_tuple_warning_percent: float = 10.0
    dead_tuple_critical_percent: float = 30.0

    # Thresholds — transaction age (seconds)
    transaction_age_warning_seconds: int = 300
    transaction_age_critical_seconds: int = 900

    # Thresholds — replication lag (bytes)
    replication_lag_warning_bytes: int = 16 * 1024 * 1024
    replication_lag_critical_bytes: int = 128 * 1024 * 1024

    # Heuristics — indexes with fewer scans than this (and older than the
    # stats window) are reported as *potentially* unused, never as unused.
    unused_index_max_scans: int = 50


def get_settings(**overrides: object) -> PgGuardianSettings:
    """Build settings, letting explicit CLI overrides win over the environment."""
    clean = {key: value for key, value in overrides.items() if value is not None}
    return PgGuardianSettings(**clean)  # type: ignore[arg-type]
