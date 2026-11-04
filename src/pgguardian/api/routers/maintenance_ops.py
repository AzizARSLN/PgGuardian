"""Maintenance action endpoints: vacuum/analyze/reindex/drop-index (guarded, expert use).

Long operations run without a statement timeout (they routinely exceed it
on large databases) but keep the connection timeout. VACUUM FULL, REINDEX
and DROP INDEX are DANGEROUS and need explicit opt-in + confirmation.

``DROP INDEX CONCURRENTLY`` may not run inside an explicit transaction block;
the shared connections are opened with ``autocommit=True``, which is exactly
what this statement requires.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.sql import SQL, Identifier, Literal
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.ops import op_application_name, validate_op_id
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
from pgguardian.diagnostics.sequences import INTEGER_LIMITS

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


class DropIndexRequest(MutationRequest):
    """DROP INDEX CONCURRENTLY (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    index_name: str


class RaiseSequenceMaxValueRequest(MutationRequest):
    """Raise a sequence MAXVALUE to a multiple of its current ceiling (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    sequence_name: str
    multiplier: int = Field(default=10, ge=2, le=1_000_000)


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


def _untimed(client: DbClient, op_id: str | None = None) -> DbClient:
    """A no-statement-timeout client; ``op_id`` tags the backend so it can be cancelled."""
    return client.clone(
        statement_timeout=False,
        application_name=op_application_name(op_id) if op_id else None,
    )


@router.post("/vacuum", response_model=DryRunResult | MaintenanceActionResult)
def run_vacuum(
    body: VacuumRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """VACUUM [FULL] [ANALYZE] — FULL is DANGEROUS."""
    tracked = validate_op_id(op_id) if op_id else None
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
        status = _untimed(client, tracked).execute_raw(query)
    audit("maintenance.vacuum", target, risk, settings)
    return MaintenanceActionResult(action="vacuum", target=target, command_status=status)


@router.post("/analyze", response_model=DryRunResult | MaintenanceActionResult)
def run_analyze(
    body: AnalyzeRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """ANALYZE a table or the whole database (MAINTENANCE)."""
    tracked = validate_op_id(op_id) if op_id else None
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
        status = _untimed(client, tracked).execute_raw(query)
    audit("maintenance.analyze", target, RiskLevel.MAINTENANCE, settings)
    return MaintenanceActionResult(action="analyze", target=target, command_status=status)


@router.post("/reindex", response_model=DryRunResult | MaintenanceActionResult)
def run_reindex(
    body: ReindexRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """REINDEX an index or table (DANGEROUS)."""
    tracked = validate_op_id(op_id) if op_id else None
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
        head = SQL("REINDEX TABLE CONCURRENTLY") if body.concurrently else SQL("REINDEX TABLE")
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
        status = _untimed(client, tracked).execute_raw(query)
    audit("maintenance.reindex", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="reindex", target=target, command_status=status)


@router.post("/drop-index", response_model=DryRunResult | MaintenanceActionResult)
def run_drop_index(
    body: DropIndexRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """DROP INDEX CONCURRENTLY — removes a redundant/unused index (DANGEROUS)."""
    tracked = validate_op_id(op_id) if op_id else None
    ensure_dangerous_allowed(settings, "maintenance.drop_index")
    index_name = validate_identifier(body.index_name, what="index name")
    if body.schema_name:
        target_sql: object = SQL("{}.{}").format(
            Identifier(validate_identifier(body.schema_name, what="schema name")),
            Identifier(index_name),
        )
        target = f"{body.schema_name}.{body.index_name}"
    else:
        target_sql = Identifier(index_name)
        target = body.index_name
    query = SQL("DROP INDEX CONCURRENTLY IF EXISTS {}").format(target_sql)
    if body.dry_run:
        return DryRunResult(
            action="maintenance.drop_index",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    # The typed confirmation is the bare index name; the audit target stays qualified.
    require_confirm(body, "maintenance.drop_index", body.index_name)
    with mapped_errors(settings):
        client.ping()
        status = _untimed(client, tracked).execute_raw(query)
    audit("maintenance.drop_index", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="drop_index", target=target, command_status=status)


@router.post("/sequence-maxvalue", response_model=DryRunResult | MaintenanceActionResult)
def raise_sequence_max_value(
    body: RaiseSequenceMaxValueRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | MaintenanceActionResult:
    """ALTER SEQUENCE ... MAXVALUE — raises the ceiling before nextval starts failing.

    The new bound is ``current MAXVALUE x multiplier`` and never touches
    ``last_value``, so existing primary keys cannot collide. A raise beyond the
    sequence's own integer type is rejected: that case needs a wider column.
    """
    tracked = validate_op_id(op_id) if op_id else None
    ensure_dangerous_allowed(settings, "maintenance.sequence_maxvalue")
    schema_name = validate_identifier(body.schema_name, what="schema name")
    sequence_name = validate_identifier(body.sequence_name, what="sequence name")
    target = f"{schema_name}.{sequence_name}"
    with mapped_errors(settings):
        row = client.fetch_one(
            """
            SELECT data_type, increment_by, max_value
            FROM pg_sequences
            WHERE schemaname = %s AND sequencename = %s
            """,
            (schema_name, sequence_name),
        )
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"Sequence '{target}' was not found in this database."
        )
    if int(row.get("increment_by") or 1) < 0:
        raise HTTPException(
            status_code=400,
            detail=f"'{target}' counts downwards; raise its MINVALUE instead of MAXVALUE.",
        )
    data_type = str(row.get("data_type") or "bigint")
    ceiling = INTEGER_LIMITS.get(data_type, INTEGER_LIMITS["bigint"])
    current_max = int(row["max_value"]) if row.get("max_value") is not None else ceiling
    new_max = current_max * body.multiplier
    if new_max > ceiling:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{target}' is a {data_type} sequence capped at {ceiling}; "
                f"{body.multiplier}x would need {new_max}. Widen the owning column type instead."
            ),
        )
    query = SQL("ALTER SEQUENCE {}.{} MAXVALUE {}").format(
        Identifier(schema_name), Identifier(sequence_name), Literal(new_max)
    )
    if body.dry_run:
        return DryRunResult(
            action="maintenance.sequence_maxvalue",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    # The typed confirmation is the bare sequence name; the audit target stays qualified.
    require_confirm(body, "maintenance.sequence_maxvalue", sequence_name)
    with mapped_errors(settings):
        client.ping()
        status = _untimed(client, tracked).execute_raw(query)
    audit("maintenance.sequence_maxvalue", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="sequence_maxvalue", target=target, command_status=status)
