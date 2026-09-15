"""``pgguardian diagnose`` command orchestration."""

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
from pgguardian.diagnostics.diagnose import collect_findings
from pgguardian.models.finding import Severity, exit_code_for, worst_severity
from pgguardian.output.terminal import TerminalRenderer


def run(opts: GlobalOptions) -> int:
    """Aggregate findings across all areas and return the exit code."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(
            f"Unsupported format for diagnose: {output_format} (use terminal or json).", err=True
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
        findings = collect_findings(client)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if output_format == "json":
        print_json({"findings": [finding.model_dump(mode="json") for finding in findings]})
    else:
        renderer = TerminalRenderer(no_color=opts.no_color, quiet=opts.quiet)
        renderer.render_findings(findings)
    severities: list[Severity] = [finding.severity for finding in findings] or [Severity.OK]
    return exit_code_for(worst_severity(severities))
