"""``pgguardian health`` command orchestration."""

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
from pgguardian.diagnostics.health import collect_health
from pgguardian.models.finding import exit_code_for
from pgguardian.output.terminal import TerminalRenderer


def run(opts: GlobalOptions) -> int:
    """Run health diagnostics, render, and return the process exit code."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(
            f"Unsupported format for health: {output_format} (use terminal or json).", err=True
        )
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_health(client)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if output_format == "json":
        print_json(report)
    else:
        TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet).render_health(report)
    return exit_code_for(report.worst_severity())
