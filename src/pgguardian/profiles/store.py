"""Named connection profiles — connect once, reuse everywhere.

Profiles are stored in a JSON file (default
``~/.config/pgguardian/profiles.json``, overridable via
``PGGUARDIAN_PROFILES_FILE``) with ``0600`` permissions. Secrets are never
logged; passwords should preferably live in an environment variable
referenced by ``password_env`` instead of inline.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator

PROFILE_NAME_PATTERN = re.compile(r"^(?!.*[/\\:*?\"<>|\s])[\w.\-]{1,64}$", re.UNICODE)


class ProfileNotFoundError(KeyError):
    """Raised when a requested profile does not exist."""

    def __init__(self, name: str) -> None:
        self.profile_name = name
        super().__init__(
            f"Profile '{name}' not found. "
            "Use 'pgguardian profile list' to see saved profiles or "
            "'pgguardian profile add' to create one."
        )


class Profile(BaseModel):
    """A saved, named connection target (server-bound or standalone)."""

    model_config = ConfigDict(frozen=True)

    name: str = Field(description="Unique profile name, e.g. 'prod' or 'analytics'.")
    host: str = "localhost"
    port: int = 5432
    database: str = "postgres"
    username: str = "postgres"
    password: str | None = Field(default=None, description="Inline password (discouraged).")
    password_env: str | None = Field(
        default=None, description="Env var holding the password (recommended)."
    )
    server: str | None = Field(
        default=None, description="Server label for grouping (e.g. 'prod-cluster')."
    )
    description: str | None = None
    is_default: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        if not PROFILE_NAME_PATTERN.match(value):
            raise ValueError("Profile name must be 1-64 chars of letters, digits, '.', '-' or '_'.")
        return value

    def resolve_password(self) -> str | None:
        """Resolve the password: inline value or referenced env var."""
        if self.password:
            return self.password
        if self.password_env:
            return os.getenv(self.password_env)
        return None

    def to_overrides(self) -> dict[str, object]:
        """Connection overrides for settings construction (secret included)."""
        overrides: dict[str, object] = {
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "username": self.username,
            "active_profile": self.name,
        }
        password = self.resolve_password()
        if password is not None:
            overrides["password"] = password
        return overrides

    def redacted(self) -> Profile:
        """Copy with the inline password stripped (safe for display/API)."""
        return self.model_copy(update={"password": None})


def default_profiles_path() -> Path:
    """Default profiles file, overridable via ``PGGUARDIAN_PROFILES_FILE``."""
    custom = os.getenv("PGGUARDIAN_PROFILES_FILE")
    if custom:
        return Path(custom).expanduser()
    return Path.home() / ".config" / "pgguardian" / "profiles.json"


class ProfileStore:
    """JSON-file profile store with atomic writes and 0600 permissions."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_profiles_path()

    def _load_raw(self) -> dict[str, dict]:
        if not self.path.is_file():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return {}
        if not isinstance(data, dict):
            return {}
        profiles = data.get("profiles", data)
        return profiles if isinstance(profiles, dict) else {}

    def list(self) -> list[Profile]:
        """All profiles, default first, then alphabetically."""
        profiles: list[Profile] = []
        for name, raw in self._load_raw().items():
            try:
                payload = dict(raw) if isinstance(raw, dict) else {}
                payload["name"] = name
                profiles.append(Profile.model_validate(payload))
            except ValueError:
                continue
        profiles.sort(key=lambda p: (not p.is_default, p.name))
        return profiles

    def get(self, name: str) -> Profile:
        """Fetch one profile or raise ProfileNotFoundError."""
        for profile in self.list():
            if profile.name == name:
                return profile
        raise ProfileNotFoundError(name)

    def get_default(self) -> Profile | None:
        """The default profile, if one is marked."""
        for profile in self.list():
            if profile.is_default:
                return profile
        return None

    def save(self, profile: Profile) -> Profile:
        """Insert or replace a profile (updates ``updated_at``)."""
        stored = profile.model_copy(update={"updated_at": datetime.utcnow()})
        raw = self._load_raw()
        payload = stored.model_dump(mode="json")
        name = str(payload.pop("name"))
        raw[name] = payload
        self._write_raw(raw)
        return stored

    def delete(self, name: str) -> bool:
        """Delete a profile; returns True when something was removed."""
        raw = self._load_raw()
        if name not in raw:
            return False
        del raw[name]
        self._write_raw(raw)
        return True

    def set_default(self, name: str) -> Profile:
        """Mark exactly one profile as default."""
        target = self.get(name)
        for profile in self.list():
            if profile.name != name and profile.is_default:
                self.save(profile.model_copy(update={"is_default": False}))
        return self.save(target.model_copy(update={"is_default": True}))

    def _write_raw(self, raw: dict[str, dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        path_str = str(self.path)
        bak = path_str + ".bak"
        final_text = json.dumps(
            {"profiles": raw}, indent=2, sort_keys=True, ensure_ascii=False
        ) + "\n"
        # 1) Existing file → backup (safe rollback on failure)
        backup_ok = False
        try:
            if os.path.isfile(path_str):
                # Delete previous .bak if present (Windows: overwrite requires delete)
                if os.path.isfile(bak):
                    try:
                        os.remove(bak)
                    except OSError:
                        pass
                shutil.copy2(path_str, bak)
                backup_ok = True
        except OSError:
            backup_ok = False
        # 2) Direct write to target with flush + fsync to avoid Defender lock issues
        last_err: Exception | None = None
        for attempt in range(5):
            try:
                with open(path_str, "w", encoding="utf-8", newline="\n") as handle:
                    handle.write(final_text)
                    handle.flush()
                    try:
                        os.fsync(handle.fileno())
                    except OSError:
                        pass
                break
            except OSError as exc:
                last_err = exc
                time.sleep(0.1 * (attempt + 1))
        else:
            if last_err is not None:
                if backup_ok and os.path.isfile(bak):
                    try:
                        shutil.copy2(bak, path_str)
                    except OSError:
                        pass
                raise last_err
        # 3) Try to tighten permissions on Unix; ignore on Windows
        try:
            os.chmod(path_str, 0o600)
        except OSError:
            pass
        # 4) Cleanup backup only after successful write
        if backup_ok and os.path.isfile(bak):
            try:
                os.remove(bak)
            except OSError:
                pass
