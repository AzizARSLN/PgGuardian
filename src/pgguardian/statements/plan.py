"""Flatten EXPLAIN JSON into nodes the advisor rules can look at."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_COMPARE = re.compile(
    r"\(*(?:\w+\.)?\"?(?P<col>[A-Za-z_]\w*)\"?\)*(?:::[\w ]+\)*)?\s*"
    r"(?P<op>=|<=|>=|<|>|~~\*?)\s"
)
_CASTED = re.compile(r"\(\(?(?:\w+\.)?\"?(?P<col>[A-Za-z_]\w*)\"?\)::(?P<type>[\w ]+)\)?\s*(=|<|>)")


@dataclass(frozen=True)
class PlanNode:
    """One plan node with the fields the rules care about."""

    node_type: str
    relation: str | None = None
    schema: str | None = None
    index: str | None = None
    filter: str | None = None
    index_cond: str | None = None
    sort_key: tuple[str, ...] = ()
    plan_rows: float = 0
    width: int = 0
    total_cost: float = 0
    parent_relationship: str | None = None
    cte_name: str | None = None


def flatten(plan_json: Any) -> list[PlanNode]:
    """Walk EXPLAIN (FORMAT JSON) output depth first."""
    if isinstance(plan_json, str):
        import json

        plan_json = json.loads(plan_json)
    if not plan_json:
        return []
    root = plan_json[0].get("Plan") if isinstance(plan_json, list) else plan_json.get("Plan")
    nodes: list[PlanNode] = []

    def visit(node: dict[str, Any]) -> None:
        nodes.append(
            PlanNode(
                node_type=str(node.get("Node Type", "")),
                relation=node.get("Relation Name"),
                schema=node.get("Schema"),
                index=node.get("Index Name"),
                filter=node.get("Filter"),
                index_cond=node.get("Index Cond"),
                sort_key=tuple(node.get("Sort Key") or ()),
                plan_rows=float(node.get("Plan Rows") or 0),
                width=int(node.get("Plan Width") or 0),
                total_cost=float(node.get("Total Cost") or 0),
                parent_relationship=node.get("Parent Relationship"),
                cte_name=node.get("CTE Name"),
            )
        )
        for child in node.get("Plans") or []:
            visit(child)

    if root:
        visit(root)
    return nodes


def total_cost(nodes: list[PlanNode]) -> float:
    return nodes[0].total_cost if nodes else 0.0


def filter_columns(expression: str | None) -> tuple[list[str], list[str]]:
    """Return (equality columns, range columns) referenced by a Filter expression."""
    equal: list[str] = []
    ranged: list[str] = []
    for match in _COMPARE.finditer(expression or ""):
        target = equal if match.group("op") == "=" else ranged
        if match.group("op").startswith("~~"):
            continue
        if match.group("col") not in target:
            target.append(match.group("col"))
    return equal, ranged


def casted_columns(expression: str | None) -> list[tuple[str, str]]:
    """Columns the planner had to cast: [(column, cast type)]."""
    return [(m.group("col"), m.group("type").strip()) for m in _CASTED.finditer(expression or "")]
