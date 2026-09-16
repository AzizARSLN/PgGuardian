"""Authentication router: login, logout, /me, refresh.

Endpoints use direct psycopg3 access to pgguardian_users / pgguardian_sessions
(schema defined in docker/init.sql). Tokens are HS256 JWT; refresh token is
stored as an HttpOnly cookie.
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
    get_jwt_settings,
    resolve_client,
    verify_jwt,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

ACCESS_TTL = timedelta(hours=12)
REFRESH_TTL = timedelta(days=7)
REFRESH_COOKIE = "pgg_refresh"


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
    client: DbClient = Depends(resolve_client),
    secret: str = Depends(get_jwt_settings),
) -> LoginResponse:
    """Issue access + refresh tokens for valid email/password credentials."""
    row = client.fetch_one(
        "SELECT id, email, full_name, password_hash, app_role, is_active, password_must_change "
        "FROM pgguardian_users WHERE email = %s",
        (body.email.lower().strip(),),
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if not row["is_active"]:
        raise HTTPException(status_code=401, detail="Account disabled.")
    if not _verify(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    user_id = int(row["id"])
    access, refresh, expires_in = _mint_tokens(
        user_id=user_id,
        email=str(row["email"]),
        full_name=str(row["full_name"]),
        role=str(row["app_role"]),
        password_must_change=bool(row["password_must_change"]),
        secret=secret,
    )

    expires_at = datetime.now(UTC) + REFRESH_TTL
    client.execute_raw(
        "INSERT INTO pgguardian_sessions (user_id, refresh_hash, user_agent, ip_addr, expires_at) "
        "VALUES (%s, %s, %s, %s::inet, %s)",
        (
            user_id,
            _jti_hash(refresh),
            request.headers.get("user-agent"),
            request.client.host if request.client else None,
            expires_at,
        ),
    )
    client.execute_raw(
        "UPDATE pgguardian_users SET last_login = now() WHERE id = %s",
        (user_id,),
    )

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=False,
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
    client: DbClient = Depends(resolve_client),
    _claims: dict[str, Any] = Depends(verify_jwt),
    refresh: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> None:
    """Invalidate the stored refresh session and clear the cookie."""
    if refresh:
        client.execute_raw(
            "DELETE FROM pgguardian_sessions WHERE refresh_hash = %s",
            (_jti_hash(refresh),),
        )
    response.delete_cookie(key=REFRESH_COOKIE, httponly=True, samesite="lax")


@router.get("/me", response_model=UserPublic)
def me(
    claims: dict[str, Any] = Depends(verify_jwt),
    client: DbClient = Depends(resolve_client),
) -> UserPublic:
    """Return the authenticated user's public profile."""
    user_id = int(claims["sub"])
    row = client.fetch_one(
        "SELECT id, email, full_name, app_role, password_must_change FROM pgguardian_users "
        "WHERE id = %s AND is_active = TRUE",
        (user_id,),
    )
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
    client: DbClient = Depends(resolve_client),
    secret: str = Depends(get_jwt_settings),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> LoginResponse:
    """Exchange a valid refresh cookie for a fresh access token.

    The refresh token itself is rotated: the old session hash is deleted and a
    new HttpOnly cookie is issued.
    """
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

    session = client.fetch_one(
        "SELECT s.id, s.user_id, u.email, u.full_name, u.app_role, u.is_active, "
        "u.password_must_change FROM pgguardian_sessions s JOIN pgguardian_users u "
        "ON u.id = s.user_id WHERE s.refresh_hash = %s",
        (_jti_hash(refresh_token),),
    )
    if session is None:
        raise HTTPException(status_code=401, detail="Session revoked.")
    if not session["is_active"]:
        raise HTTPException(status_code=401, detail="Account disabled.")

    user_id = int(session["user_id"])
    client.execute_raw("DELETE FROM pgguardian_sessions WHERE id = %s", (int(session["id"]),))
    access, new_refresh, expires_in = _mint_tokens(
        user_id=user_id,
        email=str(session["email"]),
        full_name=str(session["full_name"]),
        role=str(session["app_role"]),
        password_must_change=bool(session["password_must_change"]),
        secret=secret,
    )
    expires_at = datetime.now(UTC) + REFRESH_TTL
    client.execute_raw(
        "INSERT INTO pgguardian_sessions (user_id, refresh_hash, user_agent, ip_addr, expires_at) "
        "VALUES (%s, %s, %s, %s::inet, %s)",
        (
            user_id,
            _jti_hash(new_refresh),
            request.headers.get("user-agent"),
            request.client.host if request.client else None,
            expires_at,
        ),
    )
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=new_refresh,
        httponly=True,
        secure=False,
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
    claims: dict[str, Any] = Depends(verify_jwt),
    client: DbClient = Depends(resolve_client),
) -> None:
    """Change the authenticated user's own password (any role)."""
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 chars.")
    user_id = int(claims["sub"])
    row = client.fetch_one(
        "SELECT password_hash FROM pgguardian_users WHERE id = %s AND is_active = TRUE",
        (user_id,),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if not _verify(body.current_password, str(row["password_hash"])):
        raise HTTPException(status_code=401, detail="Incorrect current password.")
    client.execute_raw(
        "UPDATE pgguardian_users SET password_hash = %s, password_must_change = FALSE WHERE id = %s",
        (_hash(body.new_password), user_id),
    )
    client.execute_raw("DELETE FROM pgguardian_sessions WHERE user_id = %s", (user_id,))


def bootstrap_admin_if_needed(settings: ApiSettings | None = None) -> None:
    """Insert Admin@local when pgguardian_users is empty (startup hook).

    Safe to call on every startup — the count check guards against duplicates.
    Used from the app lifespan below and from CLI helpers.
    """
    import os

    if settings is None:
        settings = ApiSettings()
    try:
        client = resolve_client(settings=settings)
    except Exception:
        return
    try:
        count_row = client.fetch_one("SELECT count(*) AS c FROM pgguardian_users")
    except Exception:
        return
    if not count_row or int(count_row.get("c", 0)) > 0:
        return
    password = settings.bootstrap_password or os.environ.get(
        "PGGUARDIAN_BOOTSTRAP_PASSWORD", "admin123"
    )
    try:
        client.execute_raw(
            "INSERT INTO pgguardian_users (email, full_name, password_hash, app_role, "
            "password_must_change) VALUES (%s, %s, %s, %s, TRUE)",
            ("Admin@local", "Bootstrap Admin", _hash(password), "Admin"),
        )
    except Exception:
        return
