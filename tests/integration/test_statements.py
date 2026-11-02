"""Statement analysis against a real server with pg_stat_statements preloaded.

Skipped unless PGGUARDIAN_TEST_STATEMENTS_DSN points at a disposable database.
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics.queries import collect_sessions
from pgguardian.statements import advisor, collector
from pgguardian.statements.explain import explain
from pgguardian.statements.plan import flatten
from pgguardian.statements.sqlast import parse_facts

DSN = os.getenv("PGGUARDIAN_TEST_STATEMENTS_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="PGGUARDIAN_TEST_STATEMENTS_DSN not set")


@pytest.fixture
def client() -> DbClient:
    settings = PgGuardianSettings(connection_string=DSN)
    return DbClient(settings, cli_connection_string=DSN)


@pytest.fixture
def table():
    name = f"adv_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
        conn.execute(
            f"CREATE TABLE {name} (id bigint PRIMARY KEY, customer_id bigint, status text)"
        )
        conn.execute(
            f"INSERT INTO {name} SELECT g, g % 5000, 'open' FROM generate_series(1, 50000) g"
        )
        conn.execute(f"ANALYZE {name}")
        conn.execute("SELECT pg_stat_statements_reset()")
        for value in range(1200):
            conn.execute(f"SELECT status FROM {name} WHERE id = %s", (value,))
        for value in range(30):
            conn.execute(f"SELECT * FROM {name} WHERE customer_id = %s", (value,))
    yield name
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute(f"DROP TABLE {name}")


def _find(client: DbClient, info: dict, fragment: str) -> dict:
    items = collector.list_statements(client, info, limit=500)["items"]
    return next(i for i in items if fragment in i["query"])


def test_status_is_ok(client: DbClient) -> None:
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
    info = collector.status(client)
    assert info["state"] == "ok"
    assert "calls" in info["columns"]


def test_repeated_statement_metrics(client: DbClient, table: str) -> None:
    info = collector.status(client)
    item = _find(client, info, f"{table} WHERE id")
    assert item["calls"] == 1200
    assert item["rows_per_call"] == pytest.approx(1, abs=0.01)
    assert item["kind"] == "SELECT"
    assert isinstance(item["queryid"], str)
    detail = collector.get_statement(client, info, item["queryid"])
    assert detail is not None and detail["queryid"] == item["queryid"]


def test_own_diagnostics_are_left_out(client: DbClient, table: str) -> None:
    info = collector.status(client)
    client.ping()
    client.ping()
    items = collector.list_statements(client, info, limit=500)["items"]
    assert not any("version()" in item["query"] for item in items)
    assert any(table in item["query"] for item in items)


@pytest.mark.parametrize("version_override", [None, 150000])
def test_generic_plan_on_both_paths(client: DbClient, table: str, version_override: int | None) -> None:
    info = collector.status(client)
    item = _find(client, info, f"{table} WHERE customer_id")
    version = version_override or int(info["server_version_num"])
    outcome = explain(client, item["query"], version=version)
    assert outcome.status == "ok", outcome.message
    assert flatten(outcome.plan)[0].node_type in {"Seq Scan", "Gather"}
    with psycopg.connect(DSN, autocommit=True) as conn:
        left = conn.execute("SELECT count(*) FROM pg_prepared_statements").fetchone()
    assert left == (0,)


def test_explain_analyze_cannot_write(client: DbClient, table: str) -> None:
    outcome = explain(
        client, f"DELETE FROM {table} WHERE id = 1", version=170000, analyze=True, params=[]
    )
    assert outcome.status == "not_explainable"
    with psycopg.connect(DSN, autocommit=True) as conn:
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone() == (50000,)


def test_full_advice_for_unindexed_filter(client: DbClient, table: str) -> None:
    info = collector.status(client)
    item = collector.get_statement(
        client, info, _find(client, info, f"{table} WHERE customer_id")["queryid"]
    )
    assert item is not None
    outcome = explain(client, item["query"], version=int(info["server_version_num"]))
    nodes = flatten(outcome.plan)
    context = advisor.load_table_context(client, "public", table)
    assert context is not None
    found = advisor.build_recommendations(item, parse_facts(item["query"]), nodes, {table: context})
    codes = {r.code for r in found}
    assert {"MISSING_INDEX", "SELECT_STAR"} <= codes
    suggested, applied = advisor.suggested_sql(item["query"], found)
    assert applied == ["SELECT_STAR"]
    assert explain(client, str(suggested), version=int(info["server_version_num"])).status == "ok"


def test_sessions_cover_every_state_with_client_details(client: DbClient) -> None:
    with psycopg.connect(DSN, application_name="billing-api") as busy:
        busy.execute("SELECT 1")  # leaves an open transaction
        report = collect_sessions(client)
    by_app = {s["application_name"]: s for s in report["sessions"]}
    held = by_app["billing-api"]
    assert held["state"] == "idle in transaction"
    assert held["client_addr"] == "127.0.0.1"
    assert held["client_port"]
    assert held["xact_seconds"] is not None
    assert any(s["state"] is None for s in report["sessions"]), "background processes included"
    assert report["truncated"] is False
    assert collect_sessions(client, limit=1)["truncated"] is True
