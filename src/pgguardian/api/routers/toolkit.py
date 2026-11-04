"""DBA toolkit: curated, read-only helper queries with operator-facing advice.

The catalogue itself is immutable (:mod:`pgguardian.toolkit.catalog`) and
purely read-only. Remediation is never executed here — advice items point at
the already-guarded ``/maintenance/*`` and ``/queries/*`` endpoints, and only
run after an explicit operator approval in the UI.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.api.ops import op_application_name, validate_op_id
from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.executor import DEFAULT_MAX_ROWS, HARD_MAX_ROWS, run_sql
from pgguardian.toolkit.catalog import catalog_payload, get_query, render_sql

router = APIRouter(prefix="/api/v1/toolkit", tags=["toolkit"])


class ToolkitRunRequest(BaseModel):
    """Run one catalogue query (always read-only)."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(description="Catalogue query id (see /toolkit/catalog).")
    max_rows: int = Field(default=DEFAULT_MAX_ROWS, ge=1, le=HARD_MAX_ROWS)
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Values for the query's declared parameters (see /toolkit/catalog).",
    )


class ToolkitRunResult(BaseModel):
    """Bounded result of a catalogue query."""

    model_config = ConfigDict(frozen=True)

    id: str
    title: str
    sql: str
    params: dict[str, str] = Field(default_factory=dict)
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    duration_ms: int = 0


@router.get("/catalog")
def get_catalog() -> dict[str, Any]:
    """Full catalogue: categories plus read-only queries and their advice."""
    return catalog_payload()


@router.post("/run", response_model=ToolkitRunResult)
def run_toolkit_query(
    body: ToolkitRunRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
) -> ToolkitRunResult:
    """Execute one catalogue query inside a READ ONLY transaction."""
    query = get_query(body.id)
    if query is None:
        raise HTTPException(status_code=404, detail=f"Unknown toolkit query '{body.id}'.")

    try:
        sql, applied = render_sql(query, body.params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    tracked = validate_op_id(op_id) if op_id else None
    run_client = (
        client.clone(application_name=op_application_name(tracked)) if tracked else client
    )
    settings = client.settings
    with mapped_errors(settings):
        if query.requires_extension:
            installed = client.fetch_one(
                "SELECT 1 AS ok FROM pg_extension WHERE extname = %s",
                (query.requires_extension,),
            )
            if not installed:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"'{query.requires_extension}' eklentisi bu veritabanında kurulu değil."
                    ),
                )
        result = run_sql(run_client, sql, None, max_rows=min(body.max_rows, query.max_rows))

    return ToolkitRunResult(
        id=query.id,
        title=query.title,
        sql=sql,
        params=applied,
        columns=result.columns,
        rows=result.rows,
        row_count=result.row_count,
        truncated=result.truncated,
        duration_ms=result.duration_ms,
    )
