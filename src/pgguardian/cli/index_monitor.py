"""``pgguardian index-monitor`` / ``index-history`` orchestration."""

from __future__ import annotations

import typer
from rich.console import Console
from rich.table import Table

from pgguardian.cli import (
    GlobalOptions,
    build_settings,
    create_client,
    effective_format,
    friendly_connection_error,
    preflight,
    print_json,
)
from pgguardian.indexes.history import IndexHistoryStore
from pgguardian.indexes.monitor import collect_monitor
from pgguardian.models.index import IndexMonitorReport
from pgguardian.utils import formatting as fmt

_LEVEL_ORDER = {"info": 0, "warning": 1, "critical": 2}
# Exit code used when --fail-on is triggered (so cron/alerting can act on it).
ALERT_EXIT_CODE = 2


def _level_at_least(level: str, minimum: str) -> bool:
    return _LEVEL_ORDER.get(level, 0) >= _LEVEL_ORDER.get(minimum, 0)


def run_monitor(
    opts: GlobalOptions,
    limit: int = 500,
    save: bool = False,
    fail_on: str = "none",
) -> int:
    """Collect an index-monitor report, optionally storing a trend point."""
    output_format = effective_format(opts)
    if output_format not in ("terminal", "json"):
        typer.echo(f"Unsupported format for index-monitor: {output_format}.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        report = collect_monitor(client, limit=limit)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3

    if save:
        try:
            point = IndexHistoryStore().save_report(report, profile=opts.profile)
        except Exception as exc:  # noqa: BLE001 — storing history is best effort
            typer.echo(f"Could not store index history: {exc}", err=True)
            point = None
    else:
        point = None

    if output_format == "json":
        print_json(report)
    else:
        _render_terminal(opts, report, stored_id=point.id if point else None)

    if fail_on != "none" and any(
        _level_at_least(alert.level, fail_on) for alert in report.alerts
    ):
        return ALERT_EXIT_CODE
    return 0


def _render_terminal(
    opts: GlobalOptions, report: IndexMonitorReport, stored_id: int | None
) -> None:
    console = Console(no_color=opts.no_color, quiet=opts.quiet)
    summary = report.summary
    stats = Table(title=f"Index monitor · {report.database}", show_header=False)
    stats.add_column("Metric")
    stats.add_column("Value", justify="right")
    stats.add_row("Health score", str(summary.health_score))
    stats.add_row("Indexes", fmt.format_count(summary.total_indexes))
    stats.add_row("Total size", fmt.format_bytes(summary.total_size_bytes))
    stats.add_row(
        "Potentially unused",
        f"{fmt.format_count(summary.unused_count)} ({fmt.format_bytes(summary.unused_size_bytes)})",
    )
    stats.add_row("Invalid", fmt.format_count(summary.invalid_count))
    stats.add_row("Duplicate groups", fmt.format_count(summary.duplicate_group_count))
    stats.add_row("Redundant", fmt.format_count(summary.redundant_count))
    if summary.bloat_known:
        stats.add_row(
            "Bloated", f"{fmt.format_count(summary.bloated_count)} ({fmt.format_bytes(summary.bloat_size_bytes)})"
        )
    stats.add_row("Missing candidates", fmt.format_count(summary.missing_candidate_count))
    console.print(stats)

    if stored_id is not None:
        console.print(f"[dim]Stored index-history point #{stored_id}.[/]")

    if report.alerts:
        table = Table(title="Alerts")
        table.add_column("Level")
        table.add_column("Title")
        table.add_column("Detail")
        for alert in report.alerts:
            table.add_row(alert.level.upper(), alert.title, alert.detail)
        console.print(table)
    else:
        console.print("[green]No index alerts.[/]")


def run_history(
    opts: GlobalOptions,
    profile: str | None = None,
    database: str | None = None,
    limit: int = 20,
) -> int:
    """Show stored index-monitor points as a trend table."""
    points = IndexHistoryStore().list(
        profile=profile or opts.profile, database=database, limit=limit
    )
    if effective_format(opts) == "json":
        print_json([point.model_dump(mode="json") for point in points])
        return 0
    console = Console(no_color=opts.no_color, quiet=opts.quiet)
    if not points:
        console.print(
            "[dim]No index history yet. Run 'pgguardian index-monitor --save'.[/]"
        )
        return 0
    table = Table(show_lines=False)
    for header in ["ID", "Taken", "Score", "Indexes", "Unused", "Unused size", "Alerts"]:
        table.add_column(header)
    for point in points:
        alerts = f"{point.critical_alerts} crit / {point.warning_alerts} warn"
        table.add_row(
            str(point.id),
            point.taken_at.strftime("%Y-%m-%d %H:%M"),
            str(point.health_score),
            fmt.format_count(point.total_indexes),
            fmt.format_count(point.unused_count),
            fmt.format_bytes(point.unused_size_bytes),
            alerts,
        )
    console.print(table)
    return 0
