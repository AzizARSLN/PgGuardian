"""FastAPI dependencies: settings, DB client, token auth, error mapping."""

from __future__ import annotations

import hmac
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import Depends, Header, HTTPException

from pgguardian.api.settings import ApiSettings
from pgguardian.cli import GlobalOptions, build_settings
from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import ConnectionError, DbClient
from pgguardian.profiles.store import ProfileNotFoundError
from pgguardian.utils.security import sanitize_error


def get_api_settings() -> ApiSettings:
    """Build API settings from the environment (per request, no globals)."""
    return ApiSettings()


def verify_token(
    authorization: str | None = Header(default=None),
    settings: ApiSettings = Depends(get_api_settings),
) -> None:
    """Bearer-token auth; open access when no token is configured (dev)."""
    expected = settings.api_token
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    provided = authorization[len("Bearer ") :].strip()
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid bearer token.")


def resolve_client(
    profile: str | None = None,
    settings: ApiSettings = Depends(get_api_settings),
) -> DbClient:
    """Build a DbClient for the request (env or saved profile)."""
    opts = GlobalOptions(
        connection_string=settings.connection_string,
        profile=profile,
        host=settings.host if settings.host != "localhost" else None,
        port=None,
        database=None,
        username=None,
        password=settings.password,
    )
    try:
        resolved = build_settings(opts)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    # Preserve API-level timeouts/thresholds on top of the profile base.
    resolved.connect_timeout = settings.connect_timeout
    resolved.query_timeout_ms = settings.query_timeout_ms
    return DbClient(resolved)


@contextmanager
def mapped_errors(settings: PgGuardianSettings) -> Iterator[None]:
    """Map DB failures to sanitized HTTP errors (never leak secrets)."""
    try:
        yield
    except HTTPException:
        raise
    except ConnectionError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to connect to PostgreSQL. Reason: {sanitize_error(exc)}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"PostgreSQL query failed. Reason: {sanitize_error(exc)}"
        ) from exc
