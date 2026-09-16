"""Users CRUD router. Admin-only except self-serve password change handled in auth router."""

from __future__ import annotations

from typing import Any

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from pgguardian.api.deps import require_role, resolve_client, verify_jwt
from pgguardian.database.connection import DbClient

router = APIRouter(
    prefix="/api/v1/users",
    tags=["users"],
    dependencies=[Depends(require_role({"Admin"}))],
)

VALID_ROLES = {"Admin", "DBA", "Viewer"}


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


class UserCreate(BaseModel):
    email: str
    full_name: str
    password: str
    app_role: str
    is_active: bool = True
    password_must_change: bool = False


class UserUpdate(BaseModel):
    email: str | None = None
    full_name: str | None = None
    app_role: str | None = None
    is_active: bool | None = None
    password_must_change: bool | None = None


class ResetPassword(BaseModel):
    new_password: str


class UserPublic(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    password_must_change: bool
    created_at: Any
    last_login: Any


def _row_to_public(row: dict) -> UserPublic:
    return UserPublic(
        id=int(row["id"]),
        email=str(row["email"]),
        full_name=str(row["full_name"]),
        role=str(row["app_role"]),
        is_active=bool(row["is_active"]),
        password_must_change=bool(row["password_must_change"]),
        created_at=row.get("created_at"),
        last_login=row.get("last_login"),
    )


@router.get("", response_model=list[UserPublic])
def list_users(
    search: str | None = Query(default=None, description="Email substring filter"),
    client: DbClient = Depends(resolve_client),
) -> list[UserPublic]:
    """List all users; optional email substring search (case-insensitive)."""
    if search:
        rows = client.fetch_all(
            "SELECT id, email, full_name, app_role, is_active, password_must_change, created_at, "
            "last_login FROM pgguardian_users WHERE lower(email) LIKE lower(%s) ORDER BY email",
            (f"%{search}%",),
        )
    else:
        rows = client.fetch_all(
            "SELECT id, email, full_name, app_role, is_active, password_must_change, created_at, "
            "last_login FROM pgguardian_users ORDER BY email"
        )
    return [_row_to_public(r) for r in rows]


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    client: DbClient = Depends(resolve_client),
) -> UserPublic:
    """Create a new user (Admin-only). Valid app_role: Admin/DBA/Viewer."""
    if body.app_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid app_role.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 chars.")
    existing = client.fetch_one(
        "SELECT id FROM pgguardian_users WHERE lower(email) = lower(%s)", (body.email,)
    )
    if existing:
        raise HTTPException(status_code=409, detail="User with that email already exists.")
    result = client.fetch_one(
        "INSERT INTO pgguardian_users (email, full_name, password_hash, app_role, is_active, "
        "password_must_change) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (
            body.email.strip(),
            body.full_name.strip(),
            _hash(body.password),
            body.app_role,
            body.is_active,
            body.password_must_change,
        ),
    )
    new_id = int(result["id"])  # type: ignore[index]
    row = client.fetch_one(
        "SELECT id, email, full_name, app_role, is_active, password_must_change, created_at, "
        "last_login FROM pgguardian_users WHERE id = %s",
        (new_id,),
    )
    assert row is not None
    return _row_to_public(row)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    body: UserUpdate,
    client: DbClient = Depends(resolve_client),
) -> UserPublic:
    """Update user metadata (role, active state, name, email). Admin-only."""
    existing = client.fetch_one(
        "SELECT id FROM pgguardian_users WHERE id = %s", (user_id,)
    )
    if not existing:
        raise HTTPException(status_code=404, detail="User not found.")
    if body.app_role and body.app_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid app_role.")
    if body.email:
        conflict = client.fetch_one(
            "SELECT id FROM pgguardian_users WHERE lower(email) = lower(%s) AND id <> %s",
            (body.email, user_id),
        )
        if conflict:
            raise HTTPException(status_code=409, detail="Email already in use.")
    assignments: list[str] = []
    params: list[Any] = []
    if body.email is not None:
        assignments.append("email = %s")
        params.append(body.email.strip())
    if body.full_name is not None:
        assignments.append("full_name = %s")
        params.append(body.full_name.strip())
    if body.app_role is not None:
        assignments.append("app_role = %s")
        params.append(body.app_role)
    if body.is_active is not None:
        assignments.append("is_active = %s")
        params.append(body.is_active)
    if body.password_must_change is not None:
        assignments.append("password_must_change = %s")
        params.append(body.password_must_change)
    if not assignments:
        row = client.fetch_one(
            "SELECT id, email, full_name, app_role, is_active, password_must_change, created_at, "
            "last_login FROM pgguardian_users WHERE id = %s",
            (user_id,),
        )
        assert row is not None
        return _row_to_public(row)
    params.append(user_id)
    client.execute_raw(
        f"UPDATE pgguardian_users SET {', '.join(assignments)} WHERE id = %s",
        tuple(params),
    )
    row = client.fetch_one(
        "SELECT id, email, full_name, app_role, is_active, password_must_change, created_at, "
        "last_login FROM pgguardian_users WHERE id = %s",
        (user_id,),
    )
    assert row is not None
    return _row_to_public(row)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    client: DbClient = Depends(resolve_client),
    claims: dict[str, Any] = Depends(verify_jwt),
) -> None:
    """Soft-delete (is_active=false) a user. Admin cannot delete themselves (400)."""
    current_id = int(claims["sub"])
    if current_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself.")
    existing = client.fetch_one(
        "SELECT id FROM pgguardian_users WHERE id = %s", (user_id,)
    )
    if not existing:
        raise HTTPException(status_code=404, detail="User not found.")
    client.execute_raw(
        "UPDATE pgguardian_users SET is_active = FALSE WHERE id = %s", (user_id,)
    )
    client.execute_raw(
        "DELETE FROM pgguardian_sessions WHERE user_id = %s", (user_id,)
    )


@router.post("/{user_id}/reset_password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int,
    body: ResetPassword,
    client: DbClient = Depends(resolve_client),
) -> None:
    """Set a new password for any user (Admin-only). Also flags must_change=false."""
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 chars.")
    existing = client.fetch_one("SELECT id FROM pgguardian_users WHERE id = %s", (user_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="User not found.")
    client.execute_raw(
        "UPDATE pgguardian_users SET password_hash = %s, password_must_change = FALSE WHERE id = %s",
        (_hash(body.new_password), user_id),
    )
    client.execute_raw("DELETE FROM pgguardian_sessions WHERE user_id = %s", (user_id,))
