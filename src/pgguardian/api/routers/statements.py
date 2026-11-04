"""Repeated statements of the selected profile: cost, plan and how to improve them."""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client, verify_token_OR_jwt
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.formatter import format_sql
from pgguardian.statements import advisor, collector
from pgguardian.statements.explain import explain as explain_statement
from pgguardian.statements.plan import flatten, total_cost
from pgguardian.statements.sqlast import parse_facts
from pgguardian.utils.security import sanitize_error

router = APIRouter(prefix="/api/v1/statements", tags=["statements"])

_QUERY_ID = re.compile(r"^-?\d{1,20}$")


class ExplainBody(BaseModel):
    """Plan options. Parameter values produce a custom plan instead of a generic one."""

    params: list[str] | None = Field(default=None, description="Values for $1, $2, ...")
    search_path: str | None = Field(default=None, max_length=200)
    analyze: bool = Field(default=False, description="Really runs the read statement.")


def _ready_status(client: DbClient) -> dict[str, Any]:
    info = collector.status(client)
    info["profile"] = client.settings.active_profile
    return info


def _statement_or_404(client: DbClient, info: dict[str, Any], queryid: str) -> dict[str, Any]:
    if not _QUERY_ID.match(queryid):
        raise HTTPException(status_code=400, detail="Invalid query id.")
    if info["state"] != "ok":
        raise HTTPException(status_code=409, detail=f"pg_stat_statements is {info['state']}.")
    statement = collector.get_statement(client, info, queryid)
    if statement is None:
        raise HTTPException(status_code=404, detail="Statement not found.")
    statement["formatted"] = format_sql(str(statement["query"]), keyword_case="upper")
    return statement


@router.get("/status")
def statements_status(client: DbClient = Depends(resolve_client)) -> dict:
    """Extension state for the selected profile, with what is limiting the data."""
    with mapped_errors(client.settings):
        client.ping()
        return _ready_status(client)


@router.get("")
def list_statements(
    sort: Literal[tuple(collector.SORT_COLUMNS)] = "calls",  # type: ignore[valid-type]
    direction: Literal["asc", "desc"] = "desc",
    limit: int = Query(default=5000, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    min_calls: int = Query(default=2, ge=1),
    search: str | None = Query(default=None, max_length=200),
    user: str | None = Query(default=None, max_length=63),
    include_utility: bool = False,
    client: DbClient = Depends(resolve_client),
) -> dict:
    """Statements of the connected database, most repeated first by default."""
    with mapped_errors(client.settings):
        client.ping()
        info = _ready_status(client)
        if info["state"] != "ok":
            return {"status": info, "totals": None, "items": []}
        result = collector.list_statements(
            client,
            info,
            sort=sort,
            descending=direction == "desc",
            limit=limit,
            offset=offset,
            min_calls=min_calls,
            search=search,
            user=user,
            include_utility=include_utility,
        )
    return {"status": info, **result}


@router.get("/{queryid}")
def statement_detail(queryid: str, client: DbClient = Depends(resolve_client)) -> dict:
    """Metrics, IN-list variants and the applications running this statement now."""
    with mapped_errors(client.settings):
        client.ping()
        return _statement_or_404(client, _ready_status(client), queryid)


@router.post("/{queryid}/explain")
def statement_plan(
    queryid: str,
    body: ExplainBody,
    request: Request,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> dict:
    """Plan a statement in a rolled back read-only transaction."""
    if body.analyze and claims is not None and claims.get("role") not in {"Admin", "DBA"}:
        raise HTTPException(status_code=403, detail="ANALYZE needs the Admin or DBA role.")
    with mapped_errors(settings):
        client.ping()
        info = _ready_status(client)
        statement = _statement_or_404(client, info, queryid)
        outcome = explain_statement(
            client,
            str(statement["query"]),
            version=int(info["server_version_num"] or 0),
            params=body.params,
            search_path=body.search_path,
            analyze=body.analyze,
        )
    return outcome.as_dict()


@router.get("/{queryid}/recommendations")
def statement_recommendations(
    queryid: str,
    search_path: str | None = Query(default=None, max_length=200),
    client: DbClient = Depends(resolve_client),
) -> dict:
    """Findings, the SQL we would run instead, and how to find the caller in code."""
    with mapped_errors(client.settings):
        client.ping()
        info = _ready_status(client)
        statement = _statement_or_404(client, info, queryid)
        query = str(statement["query"])
        version = int(info["server_version_num"] or 0)
        outcome = explain_statement(client, query, version=version, search_path=search_path)
        nodes = flatten(outcome.plan) if outcome.status == "ok" else []
        facts = parse_facts(query)
        tables = _table_contexts(client, nodes, facts)
        found = advisor.build_recommendations(statement, facts, nodes, tables)
        suggested, applied = advisor.suggested_sql(query, found)
        comparison = _compare_cost(client, suggested, version, search_path, nodes)
    return {
        "recommendations": advisor.to_dicts(found),
        "suggested_sql": suggested,
        "applied": applied,
        "cost": comparison,
        "plan_status": outcome.status,
        "plan_reason": outcome.reason,
        "plan_cost": total_cost(nodes) if nodes else None,
        "parsed": facts is not None,
        "locator": advisor.locate_in_code(query, facts, statement.get("sources") or []),
    }


def _table_contexts(client: DbClient, nodes: list, facts: Any) -> dict[str, advisor.TableContext]:
    relations = {(n.schema or "public", n.relation) for n in nodes if n.relation}
    if facts is not None:
        known = {name for _, name in relations}
        relations |= {("public", name) for name in facts.tables if name not in known}
    contexts: dict[str, advisor.TableContext] = {}
    for schema, name in relations:
        try:
            context = advisor.load_table_context(client, schema, name)
        except Exception as exc:
            sanitize_error(exc)
            continue
        if context is not None:
            contexts[name] = context
    return contexts


def _compare_cost(
    client: DbClient, suggested: str | None, version: int, search_path: str | None, nodes: list
) -> dict[str, float] | None:
    """The suggestion must still plan; report before/after only when it does."""
    if not suggested or not nodes:
        return None
    outcome = explain_statement(client, suggested, version=version, search_path=search_path)
    if outcome.status != "ok":
        return None
    return {"before": total_cost(nodes), "after": total_cost(flatten(outcome.plan))}
