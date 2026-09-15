"""``pgguardian report`` command orchestration (terminal / json / html)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

import typer
from pydantic import BaseModel

from pgguardian.cli import (
    GlobalOptions,
    build_settings,
    create_client,
    effective_format,
    friendly_connection_error,
    preflight,
)
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics import connections as connections_diag
from pgguardian.diagnostics import diagnose as diagnose_diag
from pgguardian.diagnostics import health as health_diag
from pgguardian.diagnostics import indexes as indexes_diag
from pgguardian.diagnostics import locks as locks_diag
from pgguardian.diagnostics import maintenance as maintenance_diag
from pgguardian.diagnostics import queries as queries_diag
from pgguardian.diagnostics import storage as storage_diag
from pgguardian.models.diagnostic import DiagnosticFinding
from pgguardian.models.finding import Severity, exit_code_for, worst_severity
from pgguardian.output.html import HtmlRenderer
from pgguardian.output.terminal import TerminalRenderer


def build_report_dict(opts: GlobalOptions, limit: int = 20, client: DbClient | None = None) -> dict:
    """Aggregate every diagnostic area; areas fail independently."""
    settings = build_settings(opts)
    active_client: DbClient = client or create_client(opts)
    report: dict = {}
    preflight(active_client)

    try:
        report["health"] = health_diag.collect_health(active_client).model_dump(mode="json")
    except Exception as exc:
        report["health"] = {"status": "UNKNOWN", "error": friendly_connection_error(exc, settings)}
        raise
    try:
        findings: list[DiagnosticFinding] = diagnose_diag.collect_findings(active_client)
        report["findings"] = [finding.model_dump(mode="json") for finding in findings]
    except Exception:
        report["findings"] = []
    try:
        active = queries_diag.collect_active_queries(active_client, limit=limit)
        long_running = queries_diag.collect_long_running_queries(
            active_client, min_seconds=settings.long_query_warning_seconds, limit=limit
        )
        report["queries"] = {
            "active": active.model_dump(mode="json"),
            "long_running": long_running.model_dump(mode="json"),
        }
    except Exception:
        report["queries"] = {}
    for key, collector in (
        ("connections", lambda: connections_diag.collect_connections(active_client, limit=limit)),
        ("locks", lambda: locks_diag.collect_locks(active_client, limit=limit)),
        ("storage", lambda: storage_diag.collect_storage(active_client, limit=limit)),
        ("indexes", lambda: indexes_diag.collect_indexes(active_client, limit=limit)),
        ("maintenance", lambda: maintenance_diag.collect_maintenance(active_client, limit=limit)),
    ):
        try:
            report[key] = collector().model_dump(mode="json")  # type: ignore[operator]
        except Exception:
            report[key] = {}
    return report


def run(opts: GlobalOptions, report_format: str, output: str | None, limit: int = 20) -> int:
    """Render the aggregated report in terminal, JSON or HTML."""
    output_format = (report_format or effective_format(opts)).lower()
    if output_format not in ("terminal", "json", "html"):
        typer.echo(
            f"Unsupported report format: {output_format} (use terminal, json or html).", err=True
        )
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    try:
        report = build_report_dict(opts, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3

    severities = [
        Severity(f.get("severity", "UNKNOWN"))
        for f in report.get("findings", [])
        if isinstance(f, dict)
    ]
    exit_code = exit_code_for(worst_severity(severities) if severities else Severity.OK)
    health_status = str(report.get("health", {}).get("status", "UNKNOWN"))
    if health_status == "CRITICAL":
        exit_code = 2

    if output_format == "json":
        document = print_json_target(output, report)
        if document is not None:
            typer.echo(document)
    elif output_format == "html":
        html_page = HtmlRenderer().render_report(report)
        if output:
            Path(output).write_text(html_page, encoding="utf-8")
            if not opts.quiet:
                typer.echo(f"HTML report written to {output}")
        else:
            typer.echo(html_page)
    else:
        renderer = TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet)
        _render_terminal(renderer, report)
    return exit_code


def print_json_target(output: str | None, report: dict) -> str | None:
    """Write JSON to a file when ``--output`` is given; otherwise return it."""
    from pgguardian.output.json import dumps

    document = dumps(report)
    if output:
        Path(output).write_text(document + "\n", encoding="utf-8")
        return None
    return document


def _render_terminal(renderer: TerminalRenderer, report: dict) -> None:
    """Render each report section with the terminal renderer."""
    from pgguardian.models.connection import ConnectionReport
    from pgguardian.models.health import HealthReport
    from pgguardian.models.index import IndexReport
    from pgguardian.models.lock import LockReport
    from pgguardian.models.maintenance import MaintenanceReport
    from pgguardian.models.query import QueryReport
    from pgguardian.models.storage import StorageReport

    try:
        renderer.render_health(HealthReport.model_validate(report.get("health", {})))
    except Exception:
        pass
    findings = [
        DiagnosticFinding.model_validate(f)
        for f in report.get("findings", [])
        if isinstance(f, dict)
    ]
    renderer.render_findings(findings)
    queries = report.get("queries", {})
    if isinstance(queries, dict):
        for key in ("active", "long_running"):
            try:
                renderer.render_queries(QueryReport.model_validate(queries.get(key, {})))
            except Exception:
                continue
    _render_section(report, "connections", ConnectionReport, renderer.render_connections)
    _render_section(report, "locks", LockReport, renderer.render_locks)
    _render_section(report, "storage", StorageReport, renderer.render_storage)
    _render_section(report, "indexes", IndexReport, renderer.render_indexes)
    _render_section(report, "maintenance", MaintenanceReport, renderer.render_maintenance)


_ModelT = TypeVar("_ModelT", bound=BaseModel)


def _render_section(
    report: dict,
    key: str,
    model: type[_ModelT],
    render: Callable[[_ModelT], None],
) -> None:
    """Validate one section and render it; failures degrade to a skip."""
    try:
        render(model.model_validate(report.get(key, {})))
    except Exception:
        return
