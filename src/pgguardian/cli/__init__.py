"""Shared CLI context: global options, settings/client builders, safe errors."""

from __future__ import annotations

from dataclasses import dataclass

import typer

from pgguardian.config.settings import PgGuardianSettings, get_settings
from pgguardian.database.connection import ConnectionError, DbClient
from pgguardian.output.json import dumps
from pgguardian.utils.security import mask_connection_string, sanitize_error


@dataclass
class GlobalOptions:
    """Global CLI options shared by every subcommand."""

    connection_string: str | None = None
    profile: str | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None
    output_format: str = "terminal"
    json_flag: bool = False
    quiet: bool = False
    timeout: int | None = None
    no_color: bool = False


def effective_format(opts: GlobalOptions) -> str:
    """Resolve the output format (``--json`` is a shortcut for ``--format json``)."""
    if opts.json_flag:
        return "json"
    return (opts.output_format or "terminal").lower()


def build_settings(opts: GlobalOptions) -> PgGuardianSettings:
    """Build settings from CLI overrides > profile > environment > defaults.

    Raises ProfileNotFoundError when ``--profile`` names a missing profile;
    callers surface it as exit code 3.
    """
    base: dict[str, object] = {}
    if opts.profile:
        from pgguardian.profiles.store import ProfileStore

        base = ProfileStore().get(opts.profile).to_overrides()
    overrides: dict[str, object] = dict(base)
    if opts.connection_string is not None:
        overrides["connection_string"] = opts.connection_string
    if opts.host is not None:
        overrides["host"] = opts.host
    if opts.port is not None:
        overrides["port"] = opts.port
    if opts.database is not None:
        overrides["database"] = opts.database
    if opts.username is not None:
        overrides["username"] = opts.username
    if opts.password is not None:
        overrides["password"] = opts.password
    if opts.timeout is not None:
        overrides["connect_timeout"] = opts.timeout
        overrides["query_timeout_ms"] = opts.timeout * 1000
    return get_settings(**overrides)


def create_client(opts: GlobalOptions) -> DbClient:
    """Create a DbClient from global options."""
    return DbClient(build_settings(opts))


def preflight(client: DbClient) -> None:
    """Verify the server is reachable before running diagnostics.

    Raises the original connection error so callers can render a friendly
    message with exit code 3. Per-check resilience (UNKNOWN degradation)
    still applies to partial failures after a successful preflight.
    """
    client.ping()


def collect_password(settings: PgGuardianSettings) -> str | None:
    """Return the configured password (for error sanitization only)."""
    import os

    return settings.password or os.getenv("PGPASSWORD")


def print_json(payload: object) -> None:
    """Print machine-readable JSON with no decorative output."""
    from pydantic import BaseModel

    if isinstance(payload, (BaseModel, dict, list)):
        typer.echo(dumps(payload))  # type: ignore[arg-type]
    else:
        typer.echo(dumps({"result": str(payload)}))


def friendly_connection_error(exc: Exception, settings: PgGuardianSettings) -> str:
    """User-facing connection error without secrets or stack traces."""
    reason = sanitize_error(exc, [s for s in [collect_password(settings)] if s])
    masked = mask_connection_string(reason)
    if isinstance(exc, ConnectionError) or "connect" in type(exc).__name__.lower():
        return f"Unable to connect to PostgreSQL.\n\nReason:\n{masked}"
    return f"PostgreSQL query failed.\n\nReason:\n{masked}"


def masked_target_description(settings: PgGuardianSettings) -> str:
    """Log/display-safe description of the connection target (no secrets)."""
    import os

    if settings.connection_string:
        return mask_connection_string(settings.connection_string)
    host = os.getenv("PGHOST", settings.host)
    port = os.getenv("PGPORT", str(settings.port))
    database = os.getenv("PGDATABASE", settings.database)
    user = os.getenv("PGUSER", settings.username)
    return f"{user}@{host}:{port}/{database}"
