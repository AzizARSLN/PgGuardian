"""``pgguardian queries`` command orchestration."""

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
from pgguardian.diagnostics.queries import collect_active_queries, collect_long_running_queries
from pgguardian.output.terminal import TerminalRenderer


def run_active(opts: GlobalOptions, limit: int = 20) -> int:
    """Show currently active queries."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(f"Unsupported format for queries: {output_format}.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_active_queries(client, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if output_format == "json":
        print_json(report)
    else:
        TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet).render_queries(report)
    return 0


def run_long_running(opts: GlobalOptions, min_seconds: int = 60, limit: int = 20) -> int:
    """Show queries running longer than ``min_seconds``."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(f"Unsupported format for queries: {output_format}.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_long_running_queries(client, min_seconds=min_seconds, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if output_format == "json":
        print_json(report)
    else:
        TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet).render_queries(report)
    return 0
