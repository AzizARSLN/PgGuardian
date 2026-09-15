"""Maintenance action endpoints: vacuum/analyze/reindex (guarded, expert use).

Long operations run without a statement timeout (they routinely exceed it
on large databases) but keep the connection timeout. VACUUM FULL and
REINDEX are DANGEROUS and need explicit opt-in + confirmation.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.sql import SQL, Identifier
from pydantic import BaseModel, ConfigDict

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

router = APIRouter(prefix="/api/v1/maintenance", tags=["maintenance-ops"])


class VacuumRequest(MutationRequest):
    """Run VACUUM (optionally FULL/ANALYZE) on a table or the whole database."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    analyze: bool = True
    full: bool = False
    freeze: bool = False


class AnalyzeRequest(MutationRequest):
    """Run ANALYZE on a table or the whole database."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None


class ReindexRequest(MutationRequest):
    """REINDEX an index or table (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str | None = None
    concurrently: bool = True


class MaintenanceActionResult(BaseModel):
    """Outcome of a maintenance action."""

    model_config = ConfigDict(frozen=True)

    action: str
    target: str
    command_status: str


def _table_target(schema: str | None, table: str | None) -> tuple[object | None, str]:
    if table and not schema:
        raise HTTPException(status_code=400, detail="table_name needs schema_name.")
    if schema and table:
        full: object = SQL("{}.{}").format(
            Identifier(validate_identifier(schema, what="schema name")),
            Identifier(validate_identifier(table, what="table name")),
        )
        return full, f"{schema}.{table}"
    if schema and not table:
        raise HTTPException(
            status_code=400,
            detail="Pass table_name for table scope, or neither for database scope.",
        )
    return None, "database"


def _untimed(client: DbClient) -> DbClient:
    return DbClient(client.settings, statement_timeout=False)


@router.post("/vacuum", response_model=DryRunResult | MaintenanceActionResult)
def run_vacuum(
    body: VacuumRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """VACUUM [FULL] [ANALYZE] — FULL is DANGEROUS."""
    if body.full:
        ensure_dangerous_allowed(settings, "maintenance.vacuum")
        risk = RiskLevel.DANGEROUS
    else:
        ensure_writes_allowed(settings, "maintenance.vacuum")
        risk = RiskLevel.MAINTENANCE
    target_sql, target = _table_target(body.schema_name, body.table_name)
    options: list = []
    if body.full:
        options.append(SQL("FULL"))
    if body.freeze:
        options.append(SQL("FREEZE"))
    if body.analyze:
        options.append(SQL("ANALYZE"))
    head = SQL("VACUUM{}").format(
        SQL(" ({})").format(SQL(", ").join(options)) if options else SQL("")
    )
    query = SQL("{} {}").format(head, target_sql) if target_sql is not None else head
    if body.dry_run:
        return DryRunResult(
            action="maintenance.vacuum", risk=risk, sql=[query.as_string()], target=target
        )
    require_confirm(body, "maintenance.vacuum")
    with mapped_errors(settings):
        client.ping()
        status = _untimed(client).execute_raw(query)
    audit("maintenance.vacuum", target, risk, settings)
    return MaintenanceActionResult(action="vacuum", target=target, command_status=status)


@router.post("/analyze", response_model=DryRunResult | MaintenanceActionResult)
def run_analyze(
    body: AnalyzeRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """ANALYZE a table or the whole database (MAINTENANCE)."""
    ensure_writes_allowed(settings, "maintenance.analyze")
    target_sql, target = _table_target(body.schema_name, body.table_name)
    query = SQL("ANALYZE {}").format(target_sql) if target_sql is not None else SQL("ANALYZE")
    if body.dry_run:
        return DryRunResult(
            action="maintenance.analyze",
            risk=RiskLevel.MAINTENANCE,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "maintenance.analyze")
    with mapped_errors(settings):
        client.ping()
        status = _untimed(client).execute_raw(query)
    audit("maintenance.analyze", target, RiskLevel.MAINTENANCE, settings)
    return MaintenanceActionResult(action="analyze", target=target, command_status=status)


@router.post("/reindex", response_model=DryRunResult | MaintenanceActionResult)
def run_reindex(
    body: ReindexRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """REINDEX an index or table (DANGEROUS)."""
    ensure_dangerous_allowed(settings, "maintenance.reindex")
    if body.index_name and body.table_name:
        raise HTTPException(
            status_code=400, detail="Pass either index_name or table_name, not both."
        )
    if body.index_name:
        if not body.schema_name:
            raise HTTPException(status_code=400, detail="index_name needs schema_name.")
        target_sql: object = SQL("{}.{}").format(
            Identifier(validate_identifier(body.schema_name, what="schema name")),
            Identifier(validate_identifier(body.index_name, what="index name")),
        )
        target = f"{body.schema_name}.{body.index_name}"
        head = SQL("REINDEX INDEX CONCURRENTLY") if body.concurrently else SQL("REINDEX INDEX")
    elif body.table_name:
        target_sql, target = _table_target(body.schema_name, body.table_name)
        head = SQL("REINDEX TABLE")
    else:
        raise HTTPException(status_code=400, detail="Pass index_name or table_name.")
    query = SQL("{} {}").format(head, target_sql)
    if body.dry_run:
        return DryRunResult(
            action="maintenance.reindex",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "maintenance.reindex")
    with mapped_errors(settings):
        client.ping()
        status = _untimed(client).execute_raw(query)
    audit("maintenance.reindex", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="reindex", target=target, command_status=status)
