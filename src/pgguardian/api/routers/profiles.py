"""Saved connection profiles: register once, reuse from CLI and API."""

from __future__ import annotations

import re
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from pgguardian.api.deps import get_api_settings
from pgguardian.api.settings import ApiSettings
from pgguardian.cli import GlobalOptions, build_settings
from pgguardian.config.settings import PgGuardianSettings, get_settings
from pgguardian.database.connection import DbClient
from pgguardian.profiles.store import (
    PROFILE_NAME_PATTERN,
    Profile,
    ProfileNotFoundError,
    ProfileStore,
)
from pgguardian.utils.security import sanitize_error

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


class ProfileUpdate(ProfileCreate):
    """Edit a profile. An empty password keeps the stored one."""

    clear_password: bool = False


class ConnectionTest(ProfileCreate):
    """Unsaved form values. ``existing_name`` lets an edit reuse the stored password."""

    name: str = "connection-test"
    existing_name: str | None = None


PASSWORD_REQUIRED = "password_required"


def _kept_password(
    existing: Profile, host: str, port: int, *, password_env: str | None, clear: bool = False
) -> str | None:
    """The stored password, if it may stay with this target.

    It never follows a changed host or port: repointing a profile at another
    server must not hand that server the old password.
    """
    if clear or password_env or not existing.password:
        return None
    if (existing.host, existing.port) != (host, port):
        raise HTTPException(status_code=400, detail=PASSWORD_REQUIRED)
    return existing.password


def _try_connect(resolved: PgGuardianSettings, settings: ApiSettings) -> dict:
    """Failure is a result here, not an HTTP error."""
    resolved.connect_timeout = settings.connect_timeout
    started = time.perf_counter()
    try:
        version, _ = DbClient(resolved).ping()
    except Exception as exc:
        cause = exc.__cause__ or exc
        return {"ok": False, "version": None, "reason": None, "message": sanitize_error(cause)}
    elapsed = int((time.perf_counter() - started) * 1000)
    return {"ok": True, "version": version, "reason": None, "message": None, "latency_ms": elapsed}


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
    store = _store()
    store.save(profile)
    return (store.set_default(profile.name) if profile.is_default else profile).redacted()


@router.post("/test")
def test_connection(
    body: ConnectionTest, settings: ApiSettings = Depends(get_api_settings)
) -> dict:
    """Try the values currently in the form, without saving anything."""
    password = body.password or None
    if not password and body.existing_name:
        try:
            existing = _store().get(body.existing_name)
        except ProfileNotFoundError:
            existing = None
        if existing is not None:
            try:
                password = _kept_password(
                    existing, body.host, body.port, password_env=body.password_env
                )
            except HTTPException:
                return {"ok": False, "version": None, "reason": PASSWORD_REQUIRED, "message": None}
    profile = Profile(
        name="connection-test",
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=password,
        password_env=body.password_env,
    )
    resolved = get_settings(**profile.to_overrides())
    return _try_connect(resolved, settings)


@router.put("/{name}", response_model=Profile)
def update_profile(name: str, body: ProfileUpdate) -> Profile:
    """Change a profile, including its name. An empty password keeps the stored one."""
    store = _store()
    try:
        existing = store.get(name)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if body.name != name and any(p.name == body.name for p in store.list()):
        raise HTTPException(status_code=409, detail=f"Profile '{body.name}' already exists.")
    password = body.password or _kept_password(
        existing, body.host, body.port, password_env=body.password_env, clear=body.clear_password
    )
    updated = existing.model_copy(
        update={
            "name": body.name,
            "host": body.host,
            "port": body.port,
            "database": body.database,
            "username": body.username,
            "password": password,
            "password_env": body.password_env,
            "server": body.server if body.server is not None else existing.server,
            "description": body.description if body.description is not None else existing.description,
            "is_default": body.is_default,
        }
    )
    store.save(updated)
    if body.name != name:
        store.delete(name)
    return (store.set_default(updated.name) if updated.is_default else updated).redacted()


@router.get("/{name}", response_model=Profile)
def get_profile(name: str) -> Profile:
    """One profile with inline password stripped."""
    try:
        return _store().get(name).redacted()
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{name}/test")
def test_profile(name: str, settings: ApiSettings = Depends(get_api_settings)) -> dict:
    """Try to connect with a saved profile; failure is a result, not an HTTP error."""
    try:
        resolved = build_settings(GlobalOptions(profile=name))
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _try_connect(resolved, settings)


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
