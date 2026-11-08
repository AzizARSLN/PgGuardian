"""Users CRUD router. Admin-only except self-serve password change handled in auth router."""

from __future__ import annotations

from typing import Any

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from pgguardian.api.deps import get_central_store_dep, require_role, verify_jwt
from pgguardian.central.store import CentralStore

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
    store: CentralStore = Depends(get_central_store_dep),
) -> list[UserPublic]:
    """List all users; optional email substring search (case-insensitive)."""
    return [_row_to_public(r) for r in store.list_users(search)]


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    store: CentralStore = Depends(get_central_store_dep),
) -> UserPublic:
    """Create a new user (Admin-only). Valid app_role: Admin/DBA/Viewer."""
    if body.app_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid app_role.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 chars.")
    if store.email_taken(body.email):
        raise HTTPException(status_code=409, detail="User with that email already exists.")
    new_id = store.create_user(
        email=body.email.strip(),
        full_name=body.full_name.strip(),
        password_hash=_hash(body.password),
        app_role=body.app_role,
        is_active=body.is_active,
        password_must_change=body.password_must_change,
    )
    row = store.get_user(new_id)
    assert row is not None
    return _row_to_public(row)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    body: UserUpdate,
    store: CentralStore = Depends(get_central_store_dep),
) -> UserPublic:
    """Update user metadata (role, active state, name, email). Admin-only."""
    if not store.user_exists(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    if body.app_role and body.app_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid app_role.")
    if body.email and store.email_taken(body.email, exclude_id=user_id):
        raise HTTPException(status_code=409, detail="Email already in use.")
    fields: dict[str, Any] = {}
    if body.email is not None:
        fields["email"] = body.email.strip()
    if body.full_name is not None:
        fields["full_name"] = body.full_name.strip()
    if body.app_role is not None:
        fields["app_role"] = body.app_role
    if body.is_active is not None:
        fields["is_active"] = body.is_active
    if body.password_must_change is not None:
        fields["password_must_change"] = body.password_must_change
    if fields:
        store.update_user(user_id, fields)
    row = store.get_user(user_id)
    assert row is not None
    return _row_to_public(row)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    store: CentralStore = Depends(get_central_store_dep),
    claims: dict[str, Any] = Depends(verify_jwt),
) -> None:
    """Soft-delete (is_active=false) a user. Admin cannot delete themselves (400)."""
    current_id = int(claims["sub"])
    if current_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself.")
    if not store.user_exists(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    store.deactivate_user(user_id)
    store.delete_user_sessions(user_id)


@router.post("/{user_id}/reset_password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int,
    body: ResetPassword,
    store: CentralStore = Depends(get_central_store_dep),
) -> None:
    """Set a new password for any user (Admin-only). Also flags must_change=false."""
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 chars.")
    if not store.user_exists(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    store.set_password(user_id, _hash(body.new_password), must_change=False)
    store.delete_user_sessions(user_id)
