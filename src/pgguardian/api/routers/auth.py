"""Authentication router: login, logout, /me, refresh.

Users/sessions are read and written through pgGuardian's central metadata store
(``pgguardian.central.store``): PostgreSQL for the web deployment, a local
SQLite file for the self-contained desktop build. Tokens are HS256 JWT; the
refresh token is stored as an HttpOnly cookie.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt as pyjwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from pgguardian.api.deps import (
    get_api_settings,
    get_jwt_settings,
    verify_jwt,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.central.store import get_central_store

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

ACCESS_TTL = timedelta(hours=12)
REFRESH_TTL = timedelta(days=7)
REFRESH_COOKIE = "pgg_refresh"
REFRESH_GRACE_SECONDS = 30


class LoginRequest(BaseModel):
    email: str
    password: str


class UserPublic(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    password_must_change: bool


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: UserPublic


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _jti_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _mint_tokens(
    user_id: int,
    email: str,
    full_name: str,
    role: str,
    password_must_change: bool,
    secret: str,
) -> tuple[str, str, int]:
    now = datetime.now(UTC)
    access_exp = now + ACCESS_TTL
    access_payload = {
        "sub": str(user_id),
        "email": email,
        "name": full_name,
        "role": role,
        "password_must_change": password_must_change,
        "iat": int(now.timestamp()),
        "exp": int(access_exp.timestamp()),
        "type": "access",
    }
    access = pyjwt.encode(access_payload, secret, algorithm="HS256")

    refresh_exp = now + REFRESH_TTL
    refresh_payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(refresh_exp.timestamp()),
        "type": "refresh",
    }
    refresh = pyjwt.encode(refresh_payload, secret, algorithm="HS256")
    return access, refresh, int(ACCESS_TTL.total_seconds())


@router.post("/login", response_model=LoginResponse)
def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    settings: ApiSettings = Depends(get_api_settings),
    secret: str = Depends(get_jwt_settings),
) -> LoginResponse:
    """Issue access + refresh tokens for valid email/password credentials."""
    store = get_central_store(settings)
    row = store.find_user_by_email(body.email)
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if not _verify(body.password, str(row["password_hash"])):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if not row["is_active"]:
        raise HTTPException(status_code=401, detail="Account disabled.")

    user_id = int(row["id"])
    access, refresh, expires_in = _mint_tokens(
        user_id=user_id,
        email=str(row["email"]),
        full_name=str(row["full_name"]),
        role=str(row["app_role"]),
        password_must_change=bool(row["password_must_change"]),
        secret=secret,
    )

    store.create_session(
        user_id=user_id,
        refresh_hash=_jti_hash(refresh),
        user_agent=request.headers.get("user-agent"),
        ip_addr=request.client.host if request.client else None,
        expires_at=datetime.now(UTC) + REFRESH_TTL,
    )
    store.touch_last_login(user_id)

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(REFRESH_TTL.total_seconds()),
    )
    return LoginResponse(
        access_token=access,
        token_type="Bearer",
        expires_in=expires_in,
        user=UserPublic(
            id=user_id,
            email=str(row["email"]),
            full_name=str(row["full_name"]),
            role=str(row["app_role"]),
            password_must_change=bool(row["password_must_change"]),
        ),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    settings: ApiSettings = Depends(get_api_settings),
    refresh: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> None:
    """Invalidate the stored refresh session and clear the cookie."""
    store = get_central_store(settings)
    if refresh:
        store.delete_session(_jti_hash(refresh))
    response.delete_cookie(key=REFRESH_COOKIE, httponly=True, samesite="lax")


@router.get("/me", response_model=UserPublic)
def me(
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] = Depends(verify_jwt),
) -> UserPublic:
    """Return the authenticated user's public profile."""
    store = get_central_store(settings)
    user_id = int(claims["sub"])
    row = store.get_active_user(user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return UserPublic(
        id=int(row["id"]),
        email=str(row["email"]),
        full_name=str(row["full_name"]),
        role=str(row["app_role"]),
        password_must_change=bool(row["password_must_change"]),
    )


@router.post("/refresh", response_model=LoginResponse)
def refresh(
    response: Response,
    request: Request,
    settings: ApiSettings = Depends(get_api_settings),
    secret: str = Depends(get_jwt_settings),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> LoginResponse:
    """Exchange a valid refresh cookie for a fresh access token.
    The refresh token itself is rotated: the old session hash is deleted and a
    new HttpOnly cookie is issued.
    """
    store = get_central_store(settings)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Missing refresh cookie.")
    try:
        decoded = pyjwt.decode(
            refresh_token,
            secret,
            algorithms=["HS256"],
            options={"require": ["sub", "email", "role", "exp", "type"]},
        )
    except pyjwt.ExpiredSignatureError as err:
        raise HTTPException(status_code=401, detail="Refresh expired.") from err
    except pyjwt.InvalidTokenError as err:
        raise HTTPException(status_code=401, detail="Invalid refresh.") from err
    if decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Wrong token type.")
    session = store.find_session(_jti_hash(refresh_token))
    if session is None:
        raise HTTPException(status_code=401, detail="Session revoked.")
    if not session["is_active"]:
        raise HTTPException(status_code=401, detail="Account disabled.")
    user_id = int(session["user_id"])
    # Keep the old token briefly: a reload can abort this response after the
    # rotation, and the browser would be left holding a dead cookie.
    store.expire_session_soon(int(session["id"]), REFRESH_GRACE_SECONDS)
    access, new_refresh, expires_in = _mint_tokens(
        user_id=user_id,
        email=str(session["email"]),
        full_name=str(session["full_name"]),
        role=str(session["app_role"]),
        password_must_change=bool(session["password_must_change"]),
        secret=secret,
    )
    store.create_session(
        user_id=user_id,
        refresh_hash=_jti_hash(new_refresh),
        user_agent=request.headers.get("user-agent"),
        ip_addr=request.client.host if request.client else None,
        expires_at=datetime.now(UTC) + REFRESH_TTL,
    )
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=new_refresh,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(REFRESH_TTL.total_seconds()),
    )
    return LoginResponse(
        access_token=access,
        token_type="Bearer",
        expires_in=expires_in,
        user=UserPublic(
            id=user_id,
            email=str(session["email"]),
            full_name=str(session["full_name"]),
            role=str(session["app_role"]),
            password_must_change=bool(session["password_must_change"]),
        ),
    )


@router.patch("/me/change_password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] = Depends(verify_jwt),
) -> None:
    """Change the authenticated user's own password (any role)."""
    store = get_central_store(settings)
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 chars.")
    user_id = int(claims["sub"])
    current_hash = store.get_password_hash(user_id)
    if current_hash is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if not _verify(body.current_password, current_hash):
        raise HTTPException(status_code=400, detail="Incorrect current password.")
    store.set_password(user_id, _hash(body.new_password), must_change=False)
    store.delete_user_sessions(user_id)


def bootstrap_admin_if_needed(settings: ApiSettings | None = None) -> None:
    """Insert Admin@local when pgguardian_users is empty (startup hook).

    Safe to call on every startup — the count check guards against duplicates.
    Used from the app lifespan below and from CLI helpers.
    """
    import os

    if settings is None:
        settings = ApiSettings()
    try:
        store = get_central_store(settings)
        if store.count_users() > 0:
            return
    except Exception:
        return
    password = settings.bootstrap_password or os.environ.get(
        "PGGUARDIAN_BOOTSTRAP_PASSWORD", "admin123"
    )
    try:
        store.create_user(
            email="Admin@local",
            full_name="Bootstrap Admin",
            password_hash=_hash(password),
            app_role="Admin",
            is_active=True,
            password_must_change=True,
        )
    except Exception:
        return
