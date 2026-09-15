"""Expert SQL execution endpoint with read-only-by-default guards."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.classifier import SqlRejectedError, StatementKind, classify
from pgguardian.sqlexec.executor import DEFAULT_MAX_ROWS, HARD_MAX_ROWS, SqlResult, run_sql

router = APIRouter(prefix="/api/v1/sql", tags=["sql"])


class SqlRequest(MutationRequest):
    """One statement to execute (single statement only)."""

    model_config = ConfigDict(frozen=True)

    sql: str = Field(description="Exactly one SQL statement.")
    params: list[Any] | None = Field(
        default=None, description="Values bound to %s placeholders (never interpolated)."
    )
    max_rows: int = Field(default=DEFAULT_MAX_ROWS, ge=1, le=HARD_MAX_ROWS)
    readonly: bool = Field(
        default=True, description="When true (default), only read statements run."
    )


@router.post("", response_model=SqlResult | DryRunResult)
def execute_sql(
    body: SqlRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> SqlResult | DryRunResult:
    """Classify and run one SQL statement, results capped for large databases."""
    try:
        kind = classify(body.sql)
    except SqlRejectedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.dry_run:
        return DryRunResult(
            action="sql.execute",
            risk=_risk_for(kind),
            sql=[body.sql.strip()],
            target=None,
        )

    if body.readonly:
        if kind != StatementKind.READ:
            raise HTTPException(
                status_code=403,
                detail=f"Statement classified as {kind.value} but readonly mode is on. "
                "Resubmit with readonly=false, writes enabled and explicit confirmation.",
            )
        with mapped_errors(settings):
            client.ping()
            return run_sql(client, body.sql, body.params, max_rows=body.max_rows)

    if kind == StatementKind.DANGEROUS:
        ensure_dangerous_allowed(settings, "sql.execute")
    else:
        ensure_writes_allowed(settings, "sql.execute")
    require_confirm(body, "sql.execute")
    audit("sql.execute", None, _risk_for(kind), settings)
    with mapped_errors(settings):
        client.ping()
        return run_sql(
            client,
            body.sql,
            body.params,
            max_rows=body.max_rows,
            allow_write=True,
            allow_dangerous=settings.allow_dangerous,
        )


def _risk_for(kind: StatementKind) -> RiskLevel:
    if kind == StatementKind.DANGEROUS:
        return RiskLevel.DANGEROUS
    if kind == StatementKind.READ:
        return RiskLevel.READ
    return RiskLevel.MAINTENANCE
