"""Analyse one SQL text: plan cost, safe rewrites and findings.

Shared by the queryid-based statements endpoints and the raw-SQL advise
endpoint so every screen (statements, diagnostics, ...) gets the same
cost/suggestion payload in the same shape.
"""

from __future__ import annotations

from typing import Any

from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.formatter import format_sql
from pgguardian.statements import advisor
from pgguardian.statements.explain import explain
from pgguardian.statements.plan import flatten, total_cost
from pgguardian.statements.sqlast import StatementFacts, parse_facts
from pgguardian.utils.security import sanitize_error


def load_table_contexts(
    client: DbClient, nodes: list, facts: StatementFacts | None
) -> dict[str, advisor.TableContext]:
    """Catalog facts for every relation the plan or the syntax mentions."""
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


def compare_cost(
    client: DbClient, suggested: str | None, version: int, search_path: str | None, nodes: list
) -> dict[str, float] | None:
    """The suggestion must still plan; report before/after only when it does."""
    if not suggested or not nodes:
        return None
    outcome = explain(client, suggested, version=version, search_path=search_path)
    if outcome.status != "ok":
        return None
    return {"before": total_cost(nodes), "after": total_cost(flatten(outcome.plan))}


def build_insight(
    client: DbClient,
    query: str,
    *,
    version: int,
    search_path: str | None = None,
    metrics: dict[str, Any] | None = None,
    include_plan: bool = False,
) -> dict[str, Any]:
    """Plan the statement, list findings and compare the cost of the suggestion.

    ``metrics`` carries pg_stat_statements-style numbers when available; the
    raw-SQL case passes nothing and only plan/syntax rules apply.
    """
    outcome = explain(client, query, version=version, search_path=search_path)
    nodes = flatten(outcome.plan) if outcome.status == "ok" else []
    facts = parse_facts(query)
    tables = load_table_contexts(client, nodes, facts)
    enriched: dict[str, Any] = {"query": query, **(metrics or {})}
    found = advisor.build_recommendations(enriched, facts, nodes, tables)
    suggested, applied = advisor.suggested_sql(query, found)
    comparison = compare_cost(client, suggested, version, search_path, nodes)
    sources = list((metrics or {}).get("sources") or [])
    result: dict[str, Any] = {
        "formatted": format_sql(query, keyword_case="upper"),
        "recommendations": advisor.to_dicts(found),
        "suggested_sql": suggested,
        "applied": applied,
        "cost": comparison,
        "plan_status": outcome.status,
        "plan_reason": outcome.reason,
        "plan_cost": total_cost(nodes) if nodes else None,
        "parsed": facts is not None,
        "locator": advisor.locate_in_code(query, facts, sources),
    }
    if include_plan:
        result["explain"] = outcome.as_dict()
    return result
