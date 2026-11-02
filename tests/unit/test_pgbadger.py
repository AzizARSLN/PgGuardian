"""pgBadger intake with a small synthetic report; no real log data belongs in this repo."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pgguardian.api.app import create_app
from pgguardian.pgbadger.analyzer import analyse, classify_app, statement_traits
from pgguardian.pgbadger.catalog import FINDINGS, TRAITS, render_finding
from pgguardian.pgbadger.parser import (
    NotPgBadgerReport,
    duration_ms,
    mask_event,
    mask_literals,
    parse_report,
)

SECRET_NAME = "AYSE-YILMAZ-12345678901"

REPORT = f"""<html><head><style>x</style><script>var a=1</script></head><body>
pgBadger v12.4
<div id="global-stats"><ul>
<li><span class="figure">30,920</span> <span class="figure-label">Number of queries</span></li>
<li><span class="figure">10h0m0s</span> <span class="figure-label">Total query duration</span></li>
<li><span class="figure">2026-11-02 00:00:09</span> <span class="figure-label">First query</span></li>
<li><span class="figure">2026-11-02 10:00:09</span> <span class="figure-label">Last query</span></li>
<li><span class="figure">0</span> <span class="figure-label">Total number of sessions</span></li>
</ul></div>
<div class="analysis-item row" id="time-consuming-queries"><table id="time-consuming-queries-table"><tbody>
<tr><td>1</td><td>5h0m0s</td><td>7,499 <p>Details</p></td><td>3s</td><td>1m11s</td><td>2s400ms</td>
<td id="time-consuming-queries-examples-details-rank-1">
<div id="query-e-1" class="sql sql-mediumsize">select * from hasta_hizmet t1 where t1.hasta_id = ? and t1.tarih &gt; ?;</div>
<table><tbody><tr><td>Nov 02</td><td>09</td><td>7,000</td><td>4h</td><td>2s</td></tr></tbody></table>
<div id="x-user-involved"><pre>[ <b>User:</b> app - <b>Total duration:</b> 5h0m0s - <b>Times executed:</b> 7,499 ]</pre></div>
<div id="x-app-involved"><pre>[ <b>Application:</b> HbysTestApp01 - <b>Total duration:</b> 5h0m0s - <b>Times executed:</b> 7,499 ]</pre></div>
<div id="time-consuming-queries-examples-rank-1" class="collapse"><div id="query-e-1-1" class="sql">select * from hasta_hizmet where ad = '{SECRET_NAME}'</div></div>
</td></tr></tbody></table></div>
<div class="analysis-item row" id="slowest-individual-queries"><table><tbody>
<tr><td>1</td><td>1h0m0s</td><td id="slowest-individual-queries-examples-rank-1">
<div id="query-d-1-1" class="sql">update hasta set ad = '{SECRET_NAME}' where id = 99</div>
<pre>[ <b>Date:</b> 2026-11-02 03:20:34 - <b>Database:</b> app - <b>User:</b> u - <b>Remote:</b> 10.0.0.1 - <b>Application:</b> pg_dump ]</pre>
</td></tr></tbody></table></div>
<div class="analysis-item row" id="queries-by-application"><table id="queries-by-application-table"><tbody>
<tr><td>HbysTestApp01</td><td>Total</td><td>7,499</td><td>5h</td></tr>
<tr><td>pg_dump</td><td>Total</td><td>5</td><td>3h</td></tr>
<tr><td>HbysApp01</td><td>Total</td><td>100</td><td>2h</td></tr>
</tbody></table></div>
<div class="analysis-item row" id="most-frequent-errors-events"><table id="most-frequent-errors-events-table"><tbody>
<tr><td>1</td><td>6
<p>Details</p></td><td id="most-frequent-errors-events-examples-details-rank-1">
<div id="event-c-1" class="sql"><p class="error-pre">ERROR: nextval: reached maximum value of sequence "..." (...)</p></div>
<table><tbody><tr><td>Nov 02</td><td>11</td><td>6</td></tr></tbody></table>
<div id="most-frequent-errors-events-examples-rank-1"><pre>{SECRET_NAME}</pre></div></td></tr>
</tbody></table></div>
</body></html>"""


def test_examples_and_literals_never_get_out() -> None:
    parsed = parse_report(REPORT)
    assert SECRET_NAME not in str(parsed)
    assert "12345678901" not in str(parsed)
    assert parsed["slowest_single"][0]["sql"] == "update hasta set ad = ? where id = ?"
    assert parsed["slowest_single"][0]["app"] == "pg_dump"
    top = parsed["time_consuming"][0]
    assert top["calls"] == 7499 and top["total_ms"] == 5 * 3_600_000
    assert top["apps"][0]["name"] == "HbysTestApp01"


def test_rejects_other_html() -> None:
    with pytest.raises(NotPgBadgerReport):
        parse_report("<html><body>hello</body></html>")


@pytest.mark.parametrize(
    "value,expected",
    [("5d9h18m23s", 465_503_000), ("6s685ms", 6685), ("1m11s", 71_000), ("0ms", 0), ("", 0)],
)
def test_durations(value: str, expected: int) -> None:
    assert duration_ms(value) == expected


def test_masking() -> None:
    assert mask_literals("select 'a''b', t1.c2, 42, 3.5 from t2") == "select ?, t1.c2, ?, ? from t2"
    assert "99" not in mask_literals("where tc = 99")
    assert mask_event('Key (tc)=(12345678901) already exists "tablo"') == 'Key (tc)=(?) already exists "tablo"'
    assert mask_event("value 'Ayse' for 12345") == "value '?' for #"


@pytest.mark.parametrize(
    "name,kind",
    [
        ("HbysTestApp01", "test"),
        ("pg_dump", "backup"),
        ("pgBackRest [backup]", "backup"),
        ("pg_cron", "job"),
        ("DBeaver 26.2.1 - Main 'x'", "tool"),
        ("psql", "tool"),
        ("unknown", "unknown"),
        ("HbysApp01", "application"),
    ],
)
def test_app_classes(name: str, kind: str) -> None:
    assert classify_app(name) == kind


def test_index_candidate_from_where_clause() -> None:
    shape = statement_traits("select t1.a from orders t1 where t1.customer_id = ? and t1.created > ?")
    assert shape["index"] == [{"table": "orders", "columns": ["customer_id", "created"]}]
    assert "NO_LIMIT" in shape["traits"]


def test_or_branches_are_not_index_candidates() -> None:
    shape = statement_traits("select a from t where x = ? or y = ?")
    assert shape["index"] == []
    assert "OR_CONDITION" in shape["traits"]


def test_parameter_on_the_left_still_parses() -> None:
    shape = statement_traits("select count(t0.id) from a t0, b t1 where (? = t1.id) and t0.b_id = t1.id")
    assert "UNPARSED" not in shape["traits"]
    assert "COUNT_ONLY" in shape["traits"]


def test_pgbadger_shorthand_parses() -> None:
    shape = statement_traits(
        "select t1.a from t1 where t1.x in (...) and t1.y like ? | | ? and to_char(t1.z) = ? limit ?"
    )
    assert "UNPARSED" not in shape["traits"]
    assert "FUNC_ON_COLUMN" in shape["traits"]


def test_every_code_has_text_in_both_languages() -> None:
    analysis = analyse(parse_report(REPORT))
    for finding in analysis["findings"]:
        for lang in ("tr", "en"):
            view = render_finding(finding, lang, {})
            assert view["title"] and view["title"] != finding["code"]
    for entry in list(FINDINGS.values()) + list(TRAITS.values()):
        for role in ("backend", "ui", "db"):
            assert all(len(text) == 2 for text in entry.get(role, []))


def test_analysis_finds_the_expected_problems() -> None:
    codes = {f["code"] for f in analyse(parse_report(REPORT))["findings"]}
    assert {"SEQUENCE_EXHAUSTED", "TEST_APP_ON_PRODUCTION", "BACKUP_LOAD", "QUERY_LOAD"} <= codes
    first = analyse(parse_report(REPORT))["findings"][0]
    assert first["code"] == "SEQUENCE_EXHAUSTED", "critical findings come first"


def test_index_lookup_marks_existing_index() -> None:
    def lookup(table: str) -> dict:
        return {"schema": "app", "rows": 10, "indexes": [["hasta_id", "tarih"]]}

    findings = analyse(parse_report(REPORT), lookup)["findings"]
    query = next(f for f in findings if f["code"] == "QUERY_LOAD")
    assert query["index"][0]["status"] == "covered"
    assert query["index"][0]["ddl"] is None


@pytest.fixture
def api(tmp_path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("PGGUARDIAN_AUTH_DISABLED", "1")
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    monkeypatch.setenv("PGGUARDIAN_PGBADGER_FILE", str(tmp_path / "pb.db"))
    monkeypatch.setenv("PGGUARDIAN_CONNECT_TIMEOUT", "1")
    client = TestClient(create_app())
    for name in ("site-a", "site-b"):
        client.post("/api/v1/profiles", json={"name": name, "host": "127.0.0.1", "port": 55999})
    client.headers["X-Profile-Name"] = "site-a"
    return client


def _upload(api: TestClient, body: str = REPORT) -> object:
    return api.post("/api/v1/pgbadger/reports", files={"file": ("C:\\tmp\\r.html", body, "text/html")})


def test_full_flow_is_profile_scoped_and_logged(api: TestClient, tmp_path) -> None:
    uploaded = _upload(api)
    assert uploaded.status_code == 201
    report_id = uploaded.json()["id"]

    assert api.post("/api/v1/pgbadger/reports", files={"file": ("x", "nope")}).status_code == 400
    assert _upload(api).status_code == 409

    listed = api.get("/api/v1/pgbadger/reports").json()
    assert [r["id"] for r in listed] == [report_id]
    assert listed[0]["filename"] == "r.html"
    other = {"X-Profile-Name": "site-b"}
    assert api.get("/api/v1/pgbadger/reports", headers=other).json() == []
    assert api.get(f"/api/v1/pgbadger/reports/{report_id}", headers=other).status_code == 404

    assert api.get(f"/api/v1/pgbadger/reports/{report_id}/export").status_code == 409

    analyzed = api.post(f"/api/v1/pgbadger/reports/{report_id}/analyze").json()
    assert analyzed["analyzed"] is True
    task = next(f for f in analyzed["findings"] if f["tasks"]["db"])["tasks"]["db"][0]
    assert task["status"] == "todo"

    assert (
        api.put(f"/api/v1/pgbadger/reports/{report_id}/tasks/{task['id']}", json={"status": "done"}).status_code
        == 200
    )
    again = api.post(f"/api/v1/pgbadger/reports/{report_id}/analyze").json()
    kept = [t for f in again["findings"] for t in f["tasks"]["db"] if t["id"] == task["id"]]
    assert kept[0]["status"] == "done", "running the review again keeps progress"
    assert again["totals"]["db"]["done"] == 1

    english = api.get(f"/api/v1/pgbadger/reports/{report_id}", params={"lang": "en"}).json()
    assert english["findings"][0]["title"] == "A sequence reached its maximum value"

    for section in ("all", "summary", "findings", "backend", "ui", "db"):
        for fmt in ("html", "md"):
            exported = api.get(
                f"/api/v1/pgbadger/reports/{report_id}/export",
                params={"section": section, "format": fmt},
            )
            assert exported.status_code == 200
            assert SECRET_NAME not in exported.text
    assert api.get(f"/api/v1/pgbadger/reports/{report_id}/export", params={"section": "x"}).status_code == 400

    actions = [a["action"] for a in again["activity"]]
    assert "uploaded" in actions and "analyzed" in actions and "task" in actions

    assert SECRET_NAME.encode() not in (tmp_path / "pb.db").read_bytes(), "stored data is masked"
    assert api.delete(f"/api/v1/pgbadger/reports/{report_id}", headers=other).status_code == 404
    assert api.delete(f"/api/v1/pgbadger/reports/{report_id}").status_code == 200
    assert api.get("/api/v1/pgbadger/reports").json() == []


def test_exported_html_escapes_content(api: TestClient) -> None:
    hostile = REPORT.replace("hasta_hizmet t1", "hasta_hizmet t1 /*<script>alert(1)</script>*/")
    report_id = _upload(api, hostile).json()["id"]
    api.post(f"/api/v1/pgbadger/reports/{report_id}/analyze")
    page = api.get(f"/api/v1/pgbadger/reports/{report_id}/export").text
    assert "<script>" not in page
