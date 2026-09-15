"""``pgguardian snapshot`` / ``history`` orchestration (local tracking store)."""

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
from pgguardian.snapshots.collector import take_snapshot
from pgguardian.snapshots.store import Snapshot, SnapshotStore
from pgguardian.utils import formatting as fmt


def run_snapshot(opts: GlobalOptions, server: str | None = None) -> int:
    """Take a snapshot of the current target and store it locally."""
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        snapshot = take_snapshot(client, profile=opts.profile, server=server)
        stored = SnapshotStore().save(snapshot)
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if effective_format(opts) == "json":
        print_json(stored)
    else:
        Console(no_color=opts.no_color, quiet=opts.quiet).print(
            f"Snapshot #{stored.id} stored: {stored.database} score {stored.score} ({stored.status})."
        )
    return 0


def _delta(current: Snapshot, previous: Snapshot | None, field: str) -> str:
    if previous is None:
        return "-"
    get = getattr
    try:
        diff = float(get(current, field) or 0) - float(get(previous, field) or 0)
    except (TypeError, ValueError):
        return "-"
    if diff == 0:
        return "±0"
    sign = "+" if diff > 0 else ""
    if field in ("cache_hit",):
        return f"{sign}{diff:.1f}"
    return f"{sign}{int(diff)}"


def run_history(
    opts: GlobalOptions,
    profile: str | None = None,
    server: str | None = None,
    database: str | None = None,
    limit: int = 20,
) -> int:
    """Show stored snapshots with deltas vs the previous one."""
    snapshots = SnapshotStore().list(
        profile=profile or opts.profile, server=server, database=database, limit=limit
    )
    if effective_format(opts) == "json":
        print_json([snapshot.model_dump(mode="json") for snapshot in snapshots])
        return 0
    console = Console(no_color=opts.no_color, quiet=opts.quiet)
    if not snapshots:
        console.print("[dim]No snapshots recorded yet. Use 'pgguardian snapshot'.[/]")
        return 0
    table = Table(show_lines=False)
    for header in [
        "ID",
        "Taken",
        "Profile/DB",
        "Score",
        "ΔScore",
        "Conns",
        "Cache",
        "Size",
        "ΔSize",
        "Status",
    ]:
        table.add_column(header)
    chronological = list(reversed(snapshots))
    previous: Snapshot | None = None
    rows: list[list[str]] = []
    for snapshot in chronological:
        target = f"{snapshot.profile or '-'}/{snapshot.database}"
        rows.append(
            [
                str(snapshot.id),
                snapshot.taken_at.strftime("%Y-%m-%d %H:%M"),
                target,
                str(snapshot.score),
                _delta(snapshot, previous, "score"),
                f"{snapshot.connections}/{snapshot.max_connections}",
                fmt.format_percent(snapshot.cache_hit),
                fmt.format_bytes(snapshot.db_size_bytes),
                _delta(snapshot, previous, "db_size_bytes"),
                snapshot.status,
            ]
        )
        previous = snapshot
    for row in reversed(rows):
        table.add_row(*row)
    console.print(table)
    return 0
