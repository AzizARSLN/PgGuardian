"""``pgguardian locks`` command orchestration (read-only; never cancels backends)."""

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
from pgguardian.diagnostics.locks import collect_locks
from pgguardian.models.finding import Severity, exit_code_for
from pgguardian.output.terminal import TerminalRenderer


def run(opts: GlobalOptions, limit: int = 20) -> int:
    """Show lock summary, blocking pairs and chains."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(f"Unsupported format for locks: {output_format}.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_locks(client, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if output_format == "json":
        print_json(report)
    else:
        TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet).render_locks(report)
    severity = Severity.CRITICAL if report.locks else Severity.OK
    return exit_code_for(severity)
