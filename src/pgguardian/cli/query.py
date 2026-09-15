"""``pgguardian query`` command orchestration (expert SQL, guarded)."""

from __future__ import annotations

from pathlib import Path

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
from pgguardian.sqlexec.classifier import SqlRejectedError, classify, ensure_allowed
from pgguardian.sqlexec.executor import DEFAULT_MAX_ROWS, run_sql
from pgguardian.sqlexec.formatter import format_sql


def run(
    opts: GlobalOptions,
    sql: str | None,
    file: str | None,
    max_rows: int = DEFAULT_MAX_ROWS,
    allow_write: bool = False,
    confirm: bool = False,
    dry_run: bool = False,
    format_only: bool = False,
    keyword_case: str = "upper",
) -> int:
    """Run exactly one SQL statement with read-only-by-default guards."""
    if (sql is None) == (file is None):
        typer.echo("Pass exactly one of --sql or --file.", err=True)
        return 3
    statement = sql if sql is not None else Path(file or "").read_text(encoding="utf-8")
    if format_only:
        if keyword_case.lower() not in ("upper", "lower"):
            typer.echo("keyword_case must be upper or lower.", err=True)
            return 3
        formatted = format_sql(statement, keyword_case=keyword_case.lower())
        if effective_format(opts) == "json":
            print_json(
                {"original": statement, "formatted": formatted, "keyword_case": keyword_case}
            )
        else:
            Console(no_color=opts.no_color, quiet=opts.quiet).print(formatted)
        return 0
    try:
        kind = classify(statement)
    except SqlRejectedError as exc:
        typer.echo(f"Refused: {exc}", err=True)
        return 3
    if dry_run:
        typer.echo(f"Classification: {kind.value} (dry_run: nothing executed).")
        return 0
    if kind.value != "READ" and not allow_write:
        typer.echo(
            f"Statement classified as {kind.value}. Re-run with --write --confirm to allow it.",
            err=True,
        )
        return 3
    if kind.value != "READ" and not confirm:
        typer.echo("Mutating statements need --confirm.", err=True)
        return 3
    try:
        settings = build_settings(opts)
    except Exception as exc:
        typer.echo(f"Configuration error: {exc}", err=True)
        return 3
    client = create_client(opts)
    try:
        preflight(client)
        ensure_allowed(kind, allow_write=allow_write, allow_dangerous=allow_write)
        result = run_sql(
            client,
            statement,
            max_rows=max_rows,
            allow_write=allow_write,
            allow_dangerous=allow_write,
        )
    except SqlRejectedError as exc:
        typer.echo(f"Refused: {exc}", err=True)
        return 3
    except Exception as exc:
        typer.echo(friendly_connection_error(exc, settings), err=True)
        return 3
    if effective_format(opts) == "json":
        print_json(result)
        return 0
    console = Console(no_color=opts.no_color, quiet=opts.quiet)
    if result.columns:
        table = Table(show_lines=False)
        for column in result.columns:
            table.add_column(column)
        for row in result.rows:
            table.add_row(*[str(cell) if cell is not None else "NULL" for cell in row])
        console.print(table)
    console.print(
        f"[dim]{result.row_count} row(s) in {result.duration_ms} ms"
        + (" (truncated)" if result.truncated else "")
        + f" [{result.kind.value}][/]"
    )
    return 0
