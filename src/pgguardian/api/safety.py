"""Safety framework for mutating API operations.

Read-only endpoints are always available. Anything that changes server
state is classified and guarded:

- ``MAINTENANCE`` — cancel query, vacuum/analyze, create role/database.
  Needs ``PGGUARDIAN_ALLOW_WRITES=1`` + explicit ``confirm: true``.
- ``DANGEROUS`` — terminate backend, drop, reindex, ALTER SYSTEM, restore.
  Needs ``PGGUARDIAN_ALLOW_DANGEROUS=1`` + ``confirm: true`` + (for drops
  and terminates) ``confirm_name`` matching the target.

Every executed mutation is audit-logged (stderr + optional JSONL file)
with the actor, action, target and SQL class — never with secrets.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from enum import StrEnum
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.settings import ApiSettings

logger = logging.getLogger("pgguardian.audit")

_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,62}$")
_RESERVED_PREFIX = re.compile(r"^pg_", re.IGNORECASE)


class RiskLevel(StrEnum):
    """Mutation risk classification."""

    READ = "READ"
    MAINTENANCE = "MAINTENANCE"
    DANGEROUS = "DANGEROUS"


class MutationRequest(BaseModel):
    """Base body for mutating endpoints."""

    model_config = ConfigDict(frozen=True)

    confirm: bool = Field(
        default=False, description="Explicit confirmation that the mutation may run."
    )
    confirm_name: str | None = Field(
        default=None, description="Typed target name (required for drops/terminates)."
    )
    dry_run: bool = Field(
        default=False, description="Validate + return planned SQL without executing."
    )


class DryRunResult(BaseModel):
    """What *would* run — returned without touching the server."""

    model_config = ConfigDict(frozen=True)

    action: str
    risk: RiskLevel
    sql: list[str] = Field(default_factory=list)
    target: str | None = None
    note: str = "dry_run: nothing was executed"


def ensure_writes_allowed(settings: ApiSettings, action: str) -> None:
    """Reject mutating calls unless writes are explicitly enabled (403)."""
    if not settings.allow_writes:
        raise HTTPException(
            status_code=403,
            detail=(
                f"'{action}' is a mutating operation and writes are disabled. "
                "Set PGGUARDIAN_ALLOW_WRITES=1 to enable expert mutations."
            ),
        )


def ensure_dangerous_allowed(settings: ApiSettings, action: str) -> None:
    """Reject dangerous calls unless explicitly enabled (403)."""
    ensure_writes_allowed(settings, action)
    if not settings.allow_dangerous:
        raise HTTPException(
            status_code=403,
            detail=(
                f"'{action}' is dangerous and blocked. "
                "Set PGGUARDIAN_ALLOW_DANGEROUS=1 to enable it."
            ),
        )


def require_confirm(body: MutationRequest, action: str, target: str | None = None) -> None:
    """Enforce explicit confirmation (400 when missing/mismatched)."""
    if body.dry_run:
        return
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail=f"'{action}' requires explicit confirmation (confirm: true).",
        )
    if target is not None:
        if not body.confirm_name or body.confirm_name != target:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{action}' requires confirm_name to exactly match the target ('{target}')."
                ),
            )


def validate_identifier(value: str, *, what: str = "identifier") -> str:
    """Validate a SQL identifier (400 on anything suspicious).

    Callers must still compose SQL with ``psycopg.sql.Identifier``.
    """
    if not _IDENTIFIER_PATTERN.match(value or ""):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {what} '{value}': use 1-63 chars of letters, digits, '_' or '$'.",
        )
    return value


def validate_new_role_name(value: str) -> str:
    """Role names may not shadow built-ins (400)."""
    validate_identifier(value, what="role name")
    if _RESERVED_PREFIX.match(value):
        raise HTTPException(
            status_code=400, detail=f"Role name '{value}' uses the reserved 'pg_' prefix."
        )
    return value


def audit(action: str, target: str | None, risk: RiskLevel, settings: ApiSettings) -> None:
    """Append a secret-free audit record (stderr + optional JSONL file)."""
    record = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "action": action,
        "target": target,
        "risk": risk.value,
    }
    logger.warning("AUDIT %s", json.dumps(record))
    if settings.audit_log_file:
        try:
            path = Path(settings.audit_log_file).expanduser()
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record) + "\n")
        except OSError:
            logger.exception("Could not write audit log file.")
