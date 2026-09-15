"""Saved connection profiles: register once, reuse from CLI and API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pgguardian.profiles.store import Profile, ProfileNotFoundError, ProfileStore

router = APIRouter(prefix="/api/v1/profiles", tags=["profiles"])


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


def _store() -> ProfileStore:
    return ProfileStore()


@router.get("", response_model=list[Profile])
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
