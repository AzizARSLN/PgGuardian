"""FastAPI dependencies: settings, DB client, token auth, error mapping."""

from __future__ import annotations

import hmac
import secrets
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import jwt as pyjwt
from fastapi import Depends, Header, HTTPException, Request

from pgguardian.api.settings import ApiSettings
from pgguardian.cli import GlobalOptions, build_settings
from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import ConnectionError, DbClient
from pgguardian.profiles.store import ProfileNotFoundError
from pgguardian.utils.security import sanitize_error

_JWT_CACHE: dict[str, str] = {}


def get_api_settings() -> ApiSettings:
    """Build API settings from the environment (per request, no globals)."""
    return ApiSettings()


def get_jwt_settings(settings: ApiSettings = Depends(get_api_settings)) -> str:
    """Return a stable HS256 signing secret; random + WARNING when unset.

    If the env explicitly configures a secret, always use it (cache does not
    override explicit settings — this avoids test cross-contamination). When
    the env leaves it empty, fall back to the cached random value (one per
    process lifetime, warning emitted only once).
    """
    if settings.jwt_secret:
        return settings.jwt_secret
    if "secret" not in _JWT_CACHE:
        generated = secrets.token_urlsafe(48)
        _JWT_CACHE["secret"] = generated
        warnings.warn(
            "PGGUARDIAN_JWT_SECRET is not set; using a random per-process secret. "
            "Tokens will NOT survive restarts. Set PGGUARDIAN_JWT_SECRET in production.",
            stacklevel=2,
        )
    return _JWT_CACHE["secret"]


def _clear_jwt_cache_for_tests() -> None:
    """Reset the in-memory JWT cache (test helper to isolate runs)."""
    _JWT_CACHE.clear()


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


def verify_jwt(
    authorization: str | None = Header(default=None),
    secret: str = Depends(get_jwt_settings),
) -> dict[str, Any]:
    """Verify Bearer JWT (HS256) and return the decoded claims. 401 on failure."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization[len("Bearer ") :].strip()
    try:
        decoded = pyjwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"require": ["sub", "email", "role", "exp"]},
        )
    except pyjwt.ExpiredSignatureError as err:
        raise HTTPException(status_code=401, detail="Token expired.") from err
    except pyjwt.InvalidTokenError as err:
        raise HTTPException(status_code=401, detail="Invalid token.") from err
    for required in ("sub", "email", "role", "exp"):
        if required not in decoded:
            raise HTTPException(status_code=401, detail=f"Missing claim: {required}.")
    return decoded


def require_role(allowed_roles: set[str]) -> Callable[..., dict[str, Any]]:
    """Higher-order dependency: verify_jwt then enforce role membership. 403 otherwise."""

    def _check(claims: dict[str, Any] = Depends(verify_jwt)) -> dict[str, Any]:
        role = claims.get("role")
        if role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient role.")
        return claims

    return _check


def verify_token_OR_jwt(
    request: Request,
    authorization: str | None = Header(default=None),
    settings: ApiSettings = Depends(get_api_settings),
    secret: str = Depends(get_jwt_settings),
) -> dict[str, Any] | None:
    """OR logic: PGGUARDIAN_API_TOKEN is set -> verify_token; else -> verify_jwt.

    Returns JWT claims dict when using JWT, None when using legacy token mode.
    Open access (no api_token configured + no JWT header) still passes with None.
    """
    if settings.api_token:
        verify_token(authorization=authorization, settings=settings)
        return None

    if authorization and authorization.startswith("Bearer "):
        return verify_jwt(authorization=authorization, secret=secret)

    return None


def require_role_OR_open(allowed_roles: set[str]) -> Callable[..., dict[str, Any] | None]:
    """Backward-compatible role guard.

    Behavior:
    * PGGUARDIAN_API_TOKEN set (legacy) -> passes (the token already secured it).
    * No API token + no JWT (open dev mode) -> passes as unrestricted.
    * JWT claims present -> enforces allowed_roles, 403 otherwise.
    """

    def _check(
        claims_or_none: dict[str, Any] | None = Depends(verify_token_OR_jwt),
        settings: ApiSettings = Depends(get_api_settings),
    ) -> dict[str, Any] | None:
        if settings.api_token:
            return claims_or_none
        if claims_or_none is None:
            return claims_or_none
        role = claims_or_none.get("role")
        if role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient role.")
        return claims_or_none

    return _check


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
