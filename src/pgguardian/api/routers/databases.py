"""Database management endpoints (list always; create/drop guarded)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.sql import SQL, Composed, Identifier
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
    validate_identifier,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.utils.formatting import to_int

router = APIRouter(prefix="/api/v1/databases", tags=["databases"])

SYSTEM_DATABASES = frozenset({"postgres", "template0", "template1"})


class DatabaseInfo(BaseModel):
    """One database with size and access flags."""

    model_config = ConfigDict(frozen=True)

    name: str
    owner: str | None = None
    size_bytes: int = 0
    allow_connections: bool = True
    connection_limit: int = -1


class DatabaseCreate(MutationRequest):
    """Create a database (MAINTENANCE)."""

    model_config = ConfigDict(frozen=True)

    name: str
    owner: str | None = None
    encoding: str | None = Field(
        default=None, description="E.g. UTF8; validated against allowlist."
    )


class DatabaseDrop(MutationRequest):
    """Drop a database (DANGEROUS, needs confirm_name)."""

    model_config = ConfigDict(frozen=True)


_ALLOWED_ENCODINGS = frozenset({"UTF8", "LATIN1", "LATIN9", "WIN1252", "SQL_ASCII"})


@router.get("", response_model=list[DatabaseInfo])
def list_databases(client: DbClient = Depends(resolve_client)) -> list[DatabaseInfo]:
    """All databases with sizes (read-only)."""
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT d.datname AS name, pg_get_userbyid(d.datdba) AS owner,"
            " pg_database_size(d.datname) AS size_bytes,"
            " d.datallowconn AS allow_connections, d.datconnlimit AS connection_limit"
            " FROM pg_database d ORDER BY 3 DESC"
        )
    return [
        DatabaseInfo(
            name=str(row.get("name")),
            owner=str(row.get("owner")) if row.get("owner") else None,
            size_bytes=to_int(row.get("size_bytes")),
            allow_connections=bool(row.get("allow_connections", True)),
            connection_limit=to_int(row.get("connection_limit")),
        )
        for row in rows
    ]


def _build_create(body: DatabaseCreate) -> Composed:
    name = Identifier(validate_identifier(body.name, what="database name"))
    parts: list = [SQL("CREATE DATABASE {}").format(name)]
    if body.owner:
        parts.append(
            SQL("OWNER {}").format(Identifier(validate_identifier(body.owner, what="owner")))
        )
    if body.encoding:
        encoding = body.encoding.upper()
        if encoding not in _ALLOWED_ENCODINGS:
            raise HTTPException(
                status_code=400,
                detail=f"Encoding '{body.encoding}' not in allowlist {sorted(_ALLOWED_ENCODINGS)}.",
            )
        parts.append(SQL("ENCODING {}").format(SQL(encoding)))
        parts.append(SQL("TEMPLATE template0"))
    joined: Composed = SQL(" ").join(parts)
    return joined


@router.post("", response_model=DryRunResult | DatabaseInfo)
def create_database(
    body: DatabaseCreate,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | DatabaseInfo:
    """Create a database (MAINTENANCE: needs writes + confirm)."""
    ensure_writes_allowed(settings, "database.create")
    query = _build_create(body)
    if body.dry_run:
        return DryRunResult(
            action="database.create",
            risk=RiskLevel.MAINTENANCE,
            sql=[query.as_string()],
            target=body.name,
        )
    require_confirm(body, "database.create")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("database.create", body.name, RiskLevel.MAINTENANCE, settings)
    return DatabaseInfo(name=body.name, owner=body.owner)


@router.delete("/{name}", response_model=DryRunResult | dict)
def drop_database(
    name: str,
    body: DatabaseDrop,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Drop a database (DANGEROUS: needs confirm_name; refuses system DBs and busy DBs)."""
    ensure_dangerous_allowed(settings, "database.drop")
    target = validate_identifier(name, what="database name")
    if target.lower() in SYSTEM_DATABASES:
        raise HTTPException(status_code=400, detail=f"Refusing to drop system database '{target}'.")
    if target == client.settings.database:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot drop '{target}': it is the current connection database.",
        )
    query = SQL("DROP DATABASE {}").format(Identifier(target))
    if body.dry_run:
        return DryRunResult(
            action="database.drop",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "database.drop", target=target)
    with mapped_errors(settings):
        client.ping()
        busy = client.fetch_one(
            "SELECT count(*) AS backends FROM pg_stat_activity WHERE datname = %s", (target,)
        )
        backends = to_int((busy or {}).get("backends"))
        if backends > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Refusing to drop '{target}': {backends} active backend(s) connected.",
            )
        client.execute_raw(query)
    audit("database.drop", target, RiskLevel.DANGEROUS, settings)
    return {"dropped": target}
