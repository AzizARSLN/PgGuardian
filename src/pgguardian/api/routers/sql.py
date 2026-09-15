"""Expert SQL execution endpoint with read-only-by-default guards."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
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
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.classifier import SqlRejectedError, StatementKind, classify
from pgguardian.sqlexec.executor import DEFAULT_MAX_ROWS, HARD_MAX_ROWS, SqlResult, run_sql
from pgguardian.sqlexec.formatter import format_sql

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


class SqlFormatRequest(BaseModel):
    """Format SQL without executing (no DB needed)."""

    sql: str = Field(description="SQL to format")
    keyword_case: str = Field(default="upper", description="upper or lower")


class SqlFormatResponse(BaseModel):
    """Formatted SQL result."""

    original: str
    formatted: str
    keyword_case: str


@router.post("/format", response_model=SqlFormatResponse)
def format_sql_endpoint(body: SqlFormatRequest) -> SqlFormatResponse:
    """Format SQL (no DB needed, read-only)."""
    case = body.keyword_case.lower()
    if case not in ("upper", "lower"):
        raise HTTPException(status_code=400, detail="keyword_case must be upper or lower")
    formatted = format_sql(body.sql, keyword_case=case)
    return SqlFormatResponse(original=body.sql, formatted=formatted, keyword_case=case)


class ExplainRequest(BaseModel):
    """EXPLAIN a query (read-only)."""

    sql: str = Field(description="SQL to EXPLAIN")
    analyze: bool = Field(default=False, description="EXPLAIN ANALYZE (runs query)")


@router.post("/explain")
def explain_sql(
    body: ExplainRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> dict:
    """EXPLAIN (ANALYZE) a query - read-only, capped; ANALYZE needs writes."""
    # EXPLAIN without ANALYZE is read-only; with ANALYZE it actually runs
    if body.analyze and not settings.allow_writes:
        raise HTTPException(
            status_code=403, detail="EXPLAIN ANALYZE needs PGGUARDIAN_ALLOW_WRITES=1"
        )
    prefix = "EXPLAIN (FORMAT JSON) " if not body.analyze else "EXPLAIN (ANALYZE, FORMAT JSON) "
    # Validate the inner SQL is at least parseable
    try:
        classify(body.sql)
    except SqlRejectedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with mapped_errors(settings):
        client.ping()
        # Use get_connection with statement_timeout for safety
        from pgguardian.database.connection import get_connection

        with get_connection(client.settings) as conn:
            with conn.cursor() as cur:
                cur.execute(prefix + body.sql)
                row = cur.fetchone()
                # pg returns JSON in first column
                if row:
                    # row is dict with key maybe "QUERY PLAN"
                    val = next(iter(row.values())) if isinstance(row, dict) else row[0]
                    return {"plan": val, "analyze": body.analyze}
                return {"plan": [], "analyze": body.analyze}


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
