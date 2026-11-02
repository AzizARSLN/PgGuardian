"""Advisor rules, syntax facts and the plan gate, without a database."""

from __future__ import annotations

import pytest

from pgguardian.statements import advisor
from pgguardian.statements.explain import gate
from pgguardian.statements.plan import casted_columns, filter_columns, flatten
from pgguardian.statements.sqlast import parse_facts


def _table() -> advisor.TableContext:
    return advisor.TableContext(
        schema="public",
        name="orders",
        estimated_rows=1_000_000,
        columns={
            "id": {"data_type": "bigint", "n_distinct": -1.0},
            "customer_id": {"data_type": "bigint", "n_distinct": 50_000.0},
            "status": {"data_type": "text", "n_distinct": 4.0},
        },
        indexes=[["id"]],
    )


def _seq_scan(filter_text: str) -> list:
    plan = [
        {
            "Plan": {
                "Node Type": "Seq Scan",
                "Relation Name": "orders",
                "Schema": "public",
                "Filter": filter_text,
                "Total Cost": 100.0,
                "Plan Rows": 5,
                "Plan Width": 40,
            }
        }
    ]
    return flatten(plan)


def _codes(found: list[advisor.Recommendation]) -> set[str]:
    return {r.code for r in found}


def test_parser_survives_adjacent_parameters() -> None:
    assert parse_facts("SELECT a FROM t WHERE b IN ($1,$2,$3) AND c = $4") is not None


def test_unparseable_text_gives_no_facts_and_no_crash() -> None:
    assert parse_facts("this is not ( sql") is None
    found = advisor.build_recommendations({"query": "x", "kind": "OTHER"}, None, [], {})
    assert found == []


@pytest.mark.parametrize(
    "query,code",
    [
        ("SELECT * FROM orders WHERE id = $1", "SELECT_STAR"),
        ("SELECT id FROM orders ORDER BY id LIMIT $1 OFFSET $2", "OFFSET_PAGING"),
        ("SELECT id FROM orders ORDER BY random() LIMIT $1", "RANDOM_SORT"),
        ("SELECT id FROM orders WHERE lower(status) = $1", "NON_SARGABLE"),
        ("SELECT id FROM orders WHERE status LIKE '%x'", "LEADING_WILDCARD"),
        ("SELECT id FROM a WHERE x NOT IN (SELECT y FROM b)", "NOT_IN_SUBQUERY"),
        ("SELECT id FROM a WHERE (SELECT count(*) FROM b WHERE b.a = a.id) > 0", "COUNT_FOR_EXISTS"),
        ("SELECT id FROM a WHERE x = $1 OR y = $2", "OR_COLUMNS"),
        ("SELECT a.id, (SELECT max(b.v) FROM b WHERE b.a = a.id) FROM a", "CORRELATED_SUBQUERY"),
    ],
)
def test_syntax_rules_fire(query: str, code: str) -> None:
    found = advisor.build_recommendations(
        {"query": query, "kind": "SELECT"}, parse_facts(query), [], {}
    )
    assert code in _codes(found)


def test_clean_query_has_no_syntax_findings() -> None:
    query = "SELECT id FROM orders WHERE id = $1 LIMIT $2"
    found = advisor.build_recommendations(
        {"query": query, "kind": "SELECT"}, parse_facts(query), [], {}
    )
    assert found == []


def test_n_plus_one_needs_many_calls_and_few_rows() -> None:
    hot = {"query": "SELECT 1", "kind": "SELECT", "calls": 50_000, "rows_per_call": 1.0, "load_pct": 12}
    assert "N_PLUS_1" in _codes(advisor.build_recommendations(hot, None, [], {}))
    rare = {**hot, "calls": 20}
    assert "N_PLUS_1" not in _codes(advisor.build_recommendations(rare, None, [], {}))
    wide = {**hot, "rows_per_call": 40}
    assert "N_PLUS_1" not in _codes(advisor.build_recommendations(wide, None, [], {}))


def test_missing_index_suggests_ddl_for_selective_filter() -> None:
    found = advisor.build_recommendations(
        {"query": "q", "kind": "SELECT"},
        None,
        _seq_scan("(customer_id = $1)"),
        {"orders": _table()},
    )
    index = next(r for r in found if r.code == "MISSING_INDEX")
    assert index.ddl == (
        "CREATE INDEX CONCURRENTLY idx_orders_customer_id ON public.orders (customer_id);"
    )
    assert index.safety == "advisory"


def test_missing_index_skips_low_selectivity_and_existing_index() -> None:
    tables = {"orders": _table()}
    weak = advisor.build_recommendations(
        {"query": "q", "kind": "SELECT"}, None, _seq_scan("(status = $1)"), tables
    )
    assert "MISSING_INDEX" not in _codes(weak)
    tables["orders"].indexes.append(["customer_id"])
    covered = advisor.build_recommendations(
        {"query": "q", "kind": "SELECT"}, None, _seq_scan("(customer_id = $1)"), tables
    )
    assert "MISSING_INDEX" not in _codes(covered)


def test_implicit_cast_on_indexed_column() -> None:
    found = advisor.build_recommendations(
        {"query": "q", "kind": "SELECT"}, None, _seq_scan("((id)::text = $1)"), {"orders": _table()}
    )
    assert "IMPLICIT_CAST" in _codes(found)


def test_suggested_sql_only_uses_result_preserving_rewrites() -> None:
    query = "SELECT id FROM orders WHERE customer_id IN ($1,$2,$3) ORDER BY id OFFSET $4"
    metrics = {"query": query, "kind": "SELECT", "variants": [{"queryid": "1"}]}
    found = advisor.build_recommendations(
        metrics, parse_facts(query), [], {"orders": _table()}
    )
    suggested, applied = advisor.suggested_sql(query, found)
    assert applied == ["LARGE_IN"]
    assert "customer_id = ANY($1::bigint[])" in str(suggested)
    assert "OFFSET" in str(suggested), "keyset paging changes the API and must stay a template"


def test_no_suggestion_when_nothing_safe_applies() -> None:
    query = "SELECT id FROM orders ORDER BY id OFFSET $1"
    found = advisor.build_recommendations(
        {"query": query, "kind": "SELECT"}, parse_facts(query), [], {}
    )
    assert advisor.suggested_sql(query, found) == (None, [])


def test_filter_parsing() -> None:
    assert filter_columns("((o.customer_id = $1) AND (o.created_at >= $2))") == (
        ["customer_id"],
        ["created_at"],
    )
    assert casted_columns("((id)::text = $1)") == [("id", "text")]


@pytest.mark.parametrize(
    "query,reason",
    [
        ("SELECT 1", None),
        ("WITH a AS (SELECT 1) SELECT * FROM a", None),
        ("DELETE FROM t WHERE id = $1", "not_read"),
        ("WITH d AS (DELETE FROM t RETURNING 1) SELECT * FROM d", "not_read"),
        ("SELECT a INTO b FROM c", "not_read"),
        ("SELECT 1; SELECT 2", "not_single_statement"),
        ("SELECT id FROM t FOR UPDATE", "not_read"),
        ("<insufficient privilege>", "no_text"),
    ],
)
def test_plan_gate(query: str, reason: str | None) -> None:
    assert gate(query)[1] == reason


def test_locator_reads_sqlcommenter_tags() -> None:
    query = "SELECT id FROM orders /*controller='orders',action='index'*/"
    found = advisor.locate_in_code(query, parse_facts(query), [{"application_name": "billing"}])
    assert found["sqlcommenter"] == {"controller": "orders", "action": "index"}
    assert found["applications"] == ["billing"]
    assert found["tables"] == ["orders"]
