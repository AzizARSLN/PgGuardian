"""Unit tests for output serialization (terminal / JSON / HTML)."""

from __future__ import annotations

from pgguardian.models.diagnostic import DiagnosticFinding
from pgguardian.models.finding import Severity
from pgguardian.models.health import HealthCheck, HealthReport
from pgguardian.output.html import HtmlRenderer
from pgguardian.output.json import JsonRenderer, dumps
from pgguardian.output.terminal import TerminalRenderer


def sample_report() -> HealthReport:
    return HealthReport(
        server_version="PostgreSQL 16.10",
        database="pgguardian",
        checks=[
            HealthCheck(
                name="connection_usage",
                status=Severity.OK,
                value="10 / 100",
                threshold="warn>=80%",
                severity=Severity.OK,
                description="Fine.",
            )
        ],
        score=100,
        status="HEALTHY",
    )


def test_json_renderer_roundtrip() -> None:
    report = sample_report()
    document = JsonRenderer().render(report)
    restored = HealthReport.model_validate_json(document)
    assert restored == report


def test_dumps_handles_nested_models() -> None:
    payload = {
        "health": sample_report(),
        "findings": [
            DiagnosticFinding(
                code="BLOCKING_QUERY",
                severity=Severity.CRITICAL,
                title="Blocked",
                description="A query is blocked.",
            )
        ],
    }
    text = dumps(payload)  # type: ignore[arg-type]
    assert "BLOCKING_QUERY" in text
    assert "CRITICAL" in text


def test_html_report_contains_sections() -> None:
    html_page = HtmlRenderer().render_report(
        {
            "health": sample_report().model_dump(mode="json"),
            "findings": [
                {
                    "code": "BLOCKING_QUERY",
                    "severity": "CRITICAL",
                    "title": "Blocked",
                    "description": "Blocked query.",
                    "value": None,
                    "recommendation": "Resolve contention.",
                }
            ],
            "connections": {"summary": {}, "connections": []},
            "queries": {},
            "locks": {},
            "storage": {},
            "indexes": {},
            "maintenance": {},
        }
    )
    for section in [
        "Health Score",
        "Summary",
        "Critical Findings",
        "Warnings",
        "Connections",
        "Queries",
        "Locks",
        "Storage",
        "Indexes",
        "Maintenance",
    ]:
        assert section in html_page


def test_terminal_no_color_emits_no_ansi(capsys: object) -> None:
    renderer = TerminalRenderer(no_color=True)
    renderer.render_health(sample_report())
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "\x1b" not in out
    assert "HEALTHY" in out


def test_terminal_renders_findings(capsys: object) -> None:
    renderer = TerminalRenderer(no_color=True)
    renderer.render_findings(
        [
            DiagnosticFinding(
                code="LONG_RUNNING_QUERY",
                severity=Severity.WARNING,
                title="Slow query",
                description="Running for 18 minutes.",
                recommendation="Review the query execution plan and transaction scope.",
            )
        ]
    )
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "LONG_RUNNING_QUERY" in out
    assert "Review the query execution plan" in out
