"""``pgguardian storage`` command orchestration."""

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
from pgguardian.diagnostics.storage import collect_storage
from pgguardian.models.storage import StorageReport
from pgguardian.output.terminal import TerminalRenderer


def run(opts: GlobalOptions, limit: int = 20, section: str = "all") -> int:
    """Show database / table / index sizes (top-N)."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(f"Unsupported format for storage: {output_format}.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_storage(client, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if section == "databases":
        report = StorageReport(databases=report.databases, limit=limit)
    elif section == "tables":
        report = StorageReport(tables=report.tables, limit=limit)
    elif section == "indexes":
        report = StorageReport(indexes=report.indexes, limit=limit)
    if output_format == "json":
        print_json(report)
    else:
        TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet).render_storage(report)
    return 0
