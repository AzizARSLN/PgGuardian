"""Facts about a normalized statement, read from its syntax tree.

sqlglot is kept behind this module so the parser can be replaced. A statement
that does not parse simply yields no facts; metric and plan rules still apply.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp

# sqlglot's tokenizer stops on "$2,$3", which pg_stat_statements prints all the time.
_PARAM = re.compile(r"\$(\d+)")


@dataclass
class StatementFacts:
    """What the rules need to know about one statement."""

    tables: list[str] = field(default_factory=list)
    has_star: bool = False
    star_table: str | None = None
    has_limit: bool = False
    has_offset: bool = False
    has_aggregate: bool = False
    random_sort: bool = False
    largest_in_list: int = 0
    in_column: str | None = None
    functions_on_columns: list[str] = field(default_factory=list)
    leading_wildcard: list[str] = field(default_factory=list)
    pattern_columns: list[str] = field(default_factory=list)
    correlated_subquery: bool = False
    not_in_subquery: bool = False
    count_compared_to_zero: bool = False
    or_columns: list[str] = field(default_factory=list)
    materialized_cte: bool = False


def _prepare(query: str) -> str:
    return _PARAM.sub(r"$\1 ", query)


def parse_facts(query: str) -> StatementFacts | None:
    try:
        tree = sqlglot.parse_one(_prepare(query), dialect="postgres")
    except Exception:
        return None
    if tree is None:
        return None
    facts = StatementFacts()
    cte_names = {cte.alias for cte in tree.find_all(exp.CTE)}
    facts.tables = sorted(
        {t.name for t in tree.find_all(exp.Table) if t.name and t.name not in cte_names}
    )
    outer = tree if isinstance(tree, exp.Select) else tree.find(exp.Select)
    if isinstance(outer, exp.Select):
        _read_select(outer, facts)
    _read_where(tree, facts)
    _read_subqueries(tree, facts)
    facts.materialized_cte = any(cte.args.get("materialized") for cte in tree.find_all(exp.CTE))
    return facts


def _read_select(select: exp.Select, facts: StatementFacts) -> None:
    facts.has_star = any(isinstance(e, exp.Star) or e.is_star for e in select.expressions)
    from_clause = select.args.get("from_") or select.args.get("from")
    joins = select.args.get("joins")
    if facts.has_star and from_clause is not None and not joins:
        source = from_clause.this
        if isinstance(source, exp.Table):
            facts.star_table = source.name
    facts.has_limit = select.args.get("limit") is not None
    facts.has_offset = select.args.get("offset") is not None
    facts.has_aggregate = select.find(exp.AggFunc) is not None or bool(select.args.get("group"))
    order = select.args.get("order")
    if order is not None and any(
        isinstance(f, exp.Rand) or f.name.lower() == "random"
        for f in order.find_all(exp.Func)
    ):
        facts.random_sort = True


def _read_where(tree: exp.Expression, facts: StatementFacts) -> None:
    for node in tree.find_all(exp.In):
        items = node.expressions or []
        if len(items) > facts.largest_in_list:
            facts.largest_in_list = len(items)
            if isinstance(node.this, exp.Column):
                facts.in_column = node.this.name

    for where in tree.find_all(exp.Where):
        for compare in where.find_all(exp.EQ, exp.GT, exp.GTE, exp.LT, exp.LTE, exp.Like, exp.ILike):
            left = compare.this
            if isinstance(left, (exp.Func, exp.Cast)) and left.find(exp.Column) is not None:
                facts.functions_on_columns.append(left.sql(dialect="postgres"))
            if isinstance(compare, (exp.Like, exp.ILike)) and isinstance(left, exp.Column):
                facts.pattern_columns.append(left.name)
                pattern = compare.expression
                text = pattern.sql(dialect="postgres")
                if text.startswith(("'%", "'_")) or re.match(r"^\s*'%'\s*\|\|", text):
                    facts.leading_wildcard.append(left.name)
        for disjunction in where.find_all(exp.Or):
            columns = {c.name for c in disjunction.find_all(exp.Column)}
            if len(columns) > 1:
                facts.or_columns = sorted(columns)

    for compare in tree.find_all(exp.GT, exp.EQ, exp.NEQ, exp.GTE):
        left, right = compare.this, compare.expression
        if isinstance(left, exp.Subquery):
            left = left.this
        if left.find(exp.Count) is not None and right.sql() in ("0", "1"):
            facts.count_compared_to_zero = True


def _read_subqueries(tree: exp.Expression, facts: StatementFacts) -> None:
    for negated in tree.find_all(exp.Not):
        inner = negated.this
        if isinstance(inner, exp.In) and inner.args.get("query") is not None:
            facts.not_in_subquery = True

    for select in tree.find_all(exp.Select):
        parent = select.parent_select
        if parent is None:
            continue
        outer_aliases = {t.alias_or_name for t in parent.find_all(exp.Table)}
        inner_aliases = {t.alias_or_name for t in select.find_all(exp.Table)}
        for column in select.find_all(exp.Column):
            if column.table and column.table in outer_aliases - inner_aliases:
                facts.correlated_subquery = True
