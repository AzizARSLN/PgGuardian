"""``pgguardian maintenance`` command orchestration."""

from __future__ import annotations

import typer

from pgguardian.cli import (
    GlobalOptions,
    build_settings,
    create_client,
    effective_format,
    friendly_connection_error,
    preflight,
    print_json,
)
from pgguardian.diagnostics.maintenance import collect_maintenance
from pgguardian.models.finding import Severity, exit_code_for, worst_severity
from pgguardian.output.terminal import TerminalRenderer


def run(opts: GlobalOptions, limit: int = 20) -> int:
    """Show VACUUM/ANALYZE state per table."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(f"Unsupported format for maintenance: {output_format}.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_maintenance(client, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if output_format == "json":
        print_json(report)
    else:
        TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet).render_maintenance(report)
    severities: list[Severity] = [table.status for table in report.tables] or [Severity.OK]
    return exit_code_for(worst_severity(severities))
