"""Saved connection profiles: register once, reuse from CLI and API."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from pgguardian.profiles.store import Profile, ProfileNotFoundError, ProfileStore, PROFILE_NAME_PATTERN

read_router = APIRouter(prefix="/api/v1/profiles", tags=["profiles"])
router = APIRouter(prefix="/api/v1/profiles", tags=["profiles"])

# password_env may only reference a dedicated password variable. Without this a
# profile pointing at a hostile server could exfiltrate any process secret.
_PASSWORD_ENV_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]*(PASS|PASSWORD|PWD)[A-Z0-9_]*$")
_PASSWORD_ENV_DENIED = re.compile(r"^(PGGUARDIAN_|PGPASSWORD$)")


class ProfileCreate(BaseModel):
    """Create or replace a profile (inline password discouraged)."""

    name: str
    host: str = "localhost"
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = "postgres"
    username: str = "postgres"
    password: str | None = None
    password_env: str | None = None
    server: str | None = None
    description: str | None = None
    is_default: bool = False

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        if not PROFILE_NAME_PATTERN.match(value):
            raise ValueError(
                "Profile name must be 1-64 chars of letters (incl. Unicode), "
                "digits, '.', '-' or '_'. Whitespace or /\\:*?\"<>| characters "
                "are not allowed."
            )
        return value

    @field_validator("password_env")
    @classmethod
    def _validate_password_env(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not _PASSWORD_ENV_PATTERN.match(value) or _PASSWORD_ENV_DENIED.match(value):
            raise ValueError(
                "password_env must name a dedicated password variable such as "
                "PROD_DB_PASSWORD; PGGUARDIAN_* and PGPASSWORD are not allowed."
            )
        return value


def _store() -> ProfileStore:
    return ProfileStore()


@read_router.get("", response_model=list[Profile])
def list_profiles() -> list[Profile]:
    """Saved profiles with inline passwords stripped."""
    return [profile.redacted() for profile in _store().list()]


@router.post("", response_model=Profile)
def upsert_profile(body: ProfileCreate) -> Profile:
    """Create or replace a profile."""
    try:
        profile = Profile.model_validate(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _store().save(profile).redacted()


@router.get("/{name}", response_model=Profile)
def get_profile(name: str) -> Profile:
    """One profile with inline password stripped."""
    try:
        return _store().get(name).redacted()
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{name}")
def delete_profile(name: str, confirm: bool = False) -> dict:
    """Delete a profile (needs ``?confirm=true``)."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Deleting a profile needs ?confirm=true.")
    if not _store().delete(name):
        raise HTTPException(status_code=404, detail=f"Profile '{name}' not found.")
    return {"deleted": name}


@router.post("/{name}/default", response_model=Profile)
def set_default_profile(name: str) -> Profile:
    """Mark a profile as default."""
    try:
        return _store().set_default(name).redacted()
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
