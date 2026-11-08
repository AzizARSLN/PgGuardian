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
    auth_disabled: bool = Field(
        default=False,
        description="Local development only: allow API calls with no credentials at all.",
    )
    cookie_secure: bool = Field(
        default=False, description="Mark the refresh cookie Secure (enable behind HTTPS)."
    )
    backup_dir: str = Field(default="./backups", description="pg_dump/pg_restore work directory.")
    backup_allowed_dirs: str | None = Field(
        default=None,
        description="os.pathsep separated roots a backup may be written under. Unset: any path.",
    )
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
    central_backend: str = Field(
        default="postgres",
        description="Backend for pgGuardian's own metadata (users/sessions/log): "
        "'postgres' (web) or 'sqlite' (self-contained desktop build).",
    )
    central_db_file: str | None = Field(
        default=None,
        description="SQLite file for the self-contained build. Defaults to "
        "~/.config/pgguardian/central.db when central_backend='sqlite'.",
    )
    desktop: bool = Field(
        default=False,
        description="Desktop (Tauri) mode: serve the bundled static frontend at '/' "
        "and default to the embedded SQLite metadata store.",
    )
    web_dir: str | None = Field(
        default=None,
        description="Directory with the compiled frontend to serve at '/'. Defaults to "
        "the bundled 'pgguardian/web' resource, then the 'frontend/out' checkout.",
    )
    license_public_key: str | None = Field(
        default=None,
        description="Ed25519 public key (base64url) used to verify license keys. "
        "Falls back to the key baked into the build.",
    )
    license_enforced: bool = Field(
        default=False,
        description="Require a valid, unexpired license before the API serves requests.",
    )
