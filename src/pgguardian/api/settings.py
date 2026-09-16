"""API-specific settings: diagnostics defaults plus write/danger guards."""

from __future__ import annotations

from pydantic import Field

from pgguardian.config.settings import PgGuardianSettings


class ApiSettings(PgGuardianSettings):
    """Settings for the HTTP API (env prefix ``PGGUARDIAN_``)."""

    allow_writes: bool = Field(
        default=False,
        description="Allow mutating operations (cancel, vacuum, create role/db, ...).",
    )
    allow_dangerous: bool = Field(
        default=False,
        description="Allow dangerous operations (terminate, drop, reindex, ALTER SYSTEM, ...).",
    )
    api_token: str | None = Field(
        default=None,
        description="When set, every API call needs 'Authorization: Bearer <token>'.",
    )
    backup_dir: str = Field(default="./backups", description="pg_dump/pg_restore work directory.")
    audit_log_file: str | None = Field(
        default=None, description="Optional JSONL file for the audit trail."
    )
    jwt_secret: str | None = Field(
        default=None,
        description="HS256 signing secret for JWT access/refresh tokens. Random if unset.",
    )
    bootstrap_password: str | None = Field(
        default=None,
        description="Bootstrap admin password. Falls back to 'admin123' when unset.",
    )
