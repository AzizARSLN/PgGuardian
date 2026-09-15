"""PgGuardian CLI entry point: ``pgguardian`` with Typer + Rich."""

from __future__ import annotations

from typing import Annotated

import typer

from pgguardian import __version__
from pgguardian.cli import GlobalOptions
from pgguardian.cli import connections as connections_cmd
from pgguardian.cli import diagnose as diagnose_cmd
from pgguardian.cli import health as health_cmd
from pgguardian.cli import indexes as indexes_cmd
from pgguardian.cli import locks as locks_cmd
from pgguardian.cli import maintenance as maintenance_cmd
from pgguardian.cli import profile as profile_cmd
from pgguardian.cli import queries as queries_cmd
from pgguardian.cli import query as query_cmd
from pgguardian.cli import report as report_cmd
from pgguardian.cli import serve as serve_cmd
from pgguardian.cli import snapshot as snapshot_cmd
from pgguardian.cli import storage as storage_cmd

app = typer.Typer(
    name="pgguardian",
    help="PostgreSQL diagnostics without the complexity.",
    no_args_is_help=True,
    rich_markup_mode="rich",
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"pgguardian {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    ctx: typer.Context,
    connection_string: Annotated[
        str | None, typer.Option("--connection-string", help="Libpq connection string.")
    ] = None,
    profile: Annotated[
        str | None, typer.Option("--profile", help="Saved connection profile to use.")
    ] = None,
    host: Annotated[str | None, typer.Option("--host", help="PostgreSQL host.")] = None,
    port: Annotated[int | None, typer.Option("--port", help="PostgreSQL port.")] = None,
    database: Annotated[str | None, typer.Option("--database", help="Database name.")] = None,
    username: Annotated[str | None, typer.Option("--username", help="Database user.")] = None,
    password: Annotated[
        str | None, typer.Option("--password", help="Database password (never logged).")
    ] = None,
    output_format: Annotated[
        str, typer.Option("--format", help="Output format: terminal or json.")
    ] = "terminal",
    json_output: Annotated[
        bool, typer.Option("--json", help="Shortcut for --format json.")
    ] = False,
    quiet: Annotated[bool, typer.Option("--quiet", help="Suppress non-essential output.")] = False,
    timeout: Annotated[
        int | None, typer.Option("--timeout", help="Connection/query timeout in seconds.")
    ] = None,
    no_color: Annotated[bool, typer.Option("--no-color", help="Disable ANSI colors.")] = False,
    version: Annotated[
        bool | None,
        typer.Option(
            "--version", callback=_version_callback, is_eager=True, help="Show version and exit."
        ),
    ] = None,
) -> None:
    """Global options applied to every subcommand."""
    ctx.obj = GlobalOptions(
        connection_string=connection_string,
        profile=profile,
        host=host,
        port=port,
        database=database,
        username=username,
        password=password,
        output_format=output_format,
        json_flag=json_output,
        quiet=quiet,
        timeout=timeout,
        no_color=no_color,
    )


def _opts(ctx: typer.Context) -> GlobalOptions:
    opts = ctx.obj
    if not isinstance(opts, GlobalOptions):
        return GlobalOptions()
    return opts


@app.command()
def health(ctx: typer.Context) -> None:
    """Show instance/database health and a 0-100 health score."""
    raise typer.Exit(code=health_cmd.run(_opts(ctx)))


@app.command()
def diagnose(ctx: typer.Context) -> None:
    """Aggregate all important problems into findings with recommendations."""
    raise typer.Exit(code=diagnose_cmd.run(_opts(ctx)))


@app.command()
def connections(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Max rows to display.")] = 20,
) -> None:
    """Show connection states, usage and waiting backends."""
    raise typer.Exit(code=connections_cmd.run(_opts(ctx), limit=limit))


queries_app = typer.Typer(help="Inspect running queries.", no_args_is_help=False)
app.add_typer(queries_app, name="queries")


@queries_app.callback(invoke_without_command=True)
def queries_default(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Max rows to display.")] = 20,
) -> None:
    """Show active queries (default) — see `long-running` for slow ones."""
    if ctx.invoked_subcommand is None:
        raise typer.Exit(code=queries_cmd.run_active(_opts(ctx), limit=limit))


@queries_app.command("active")
def queries_active(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Max rows to display.")] = 20,
) -> None:
    """Show currently active queries."""
    raise typer.Exit(code=queries_cmd.run_active(_opts(ctx), limit=limit))


@queries_app.command("long-running")
def queries_long_running(
    ctx: typer.Context,
    min_seconds: Annotated[
        int, typer.Option("--min-seconds", help="Minimum duration in seconds.")
    ] = 60,
    limit: Annotated[int, typer.Option("--limit", help="Max rows to display.")] = 20,
) -> None:
    """Show queries running longer than --min-seconds."""
    raise typer.Exit(
        code=queries_cmd.run_long_running(_opts(ctx), min_seconds=min_seconds, limit=limit)
    )


@app.command()
def locks(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Max rows for the lock summary.")] = 20,
) -> None:
    """Show lock summary, blocking pairs and blocking chains (read-only)."""
    raise typer.Exit(code=locks_cmd.run(_opts(ctx), limit=limit))


storage_app = typer.Typer(help="Inspect database, table and index sizes.", no_args_is_help=False)
app.add_typer(storage_app, name="storage")


@storage_app.callback(invoke_without_command=True)
def storage_default(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Top-N rows per section.")] = 20,
) -> None:
    """Show all storage sections (default)."""
    if ctx.invoked_subcommand is None:
        raise typer.Exit(code=storage_cmd.run(_opts(ctx), limit=limit, section="all"))


@storage_app.command("databases")
def storage_databases(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Top-N rows per section.")] = 20,
) -> None:
    """Show database sizes."""
    raise typer.Exit(code=storage_cmd.run(_opts(ctx), limit=limit, section="databases"))


@storage_app.command("tables")
def storage_tables(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Top-N rows per section.")] = 20,
) -> None:
    """Show largest tables."""
    raise typer.Exit(code=storage_cmd.run(_opts(ctx), limit=limit, section="tables"))


@storage_app.command("indexes")
def storage_indexes(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Top-N rows per section.")] = 20,
) -> None:
    """Show largest indexes."""
    raise typer.Exit(code=storage_cmd.run(_opts(ctx), limit=limit, section="indexes"))


@app.command()
def indexes(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Max rows to display.")] = 20,
) -> None:
    """Show index usage and potentially-unused candidates."""
    raise typer.Exit(code=indexes_cmd.run(_opts(ctx), limit=limit))


@app.command()
def maintenance(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", help="Max tables to display.")] = 20,
) -> None:
    """Show VACUUM/ANALYZE and autovacuum state per table."""
    raise typer.Exit(code=maintenance_cmd.run(_opts(ctx), limit=limit))


@app.command()
def report(
    ctx: typer.Context,
    report_format: Annotated[
        str | None, typer.Option("--format", help="Report format: terminal, json or html.")
    ] = None,
    output: Annotated[
        str | None, typer.Option("--output", help="Write JSON/HTML report to a file.")
    ] = None,
    limit: Annotated[int, typer.Option("--limit", help="Top-N rows per section.")] = 20,
) -> None:
    """Aggregate every diagnostic area into a terminal, JSON or HTML report."""
    opts = _opts(ctx)
    fmt = report_format or opts.output_format
    if opts.json_flag:
        fmt = "json"
    raise typer.Exit(code=report_cmd.run(opts, report_format=fmt, output=output, limit=limit))


profile_app = typer.Typer(help="Manage saved connection profiles.", no_args_is_help=True)
app.add_typer(profile_app, name="profile")


@profile_app.command("list")
def profile_list(ctx: typer.Context) -> None:
    """List saved connection profiles."""
    raise typer.Exit(code=profile_cmd.run_list(_opts(ctx)))


@profile_app.command("show")
def profile_show(
    ctx: typer.Context,
    name: Annotated[str, typer.Argument(help="Profile name.")],
) -> None:
    """Show one profile (passwords never shown)."""
    raise typer.Exit(code=profile_cmd.run_show(_opts(ctx), name))


@profile_app.command("add")
def profile_add(
    ctx: typer.Context,
    name: Annotated[str, typer.Option("--name", help="Profile name.")],
    host: Annotated[str, typer.Option("--host")] = "localhost",
    port: Annotated[int, typer.Option("--port")] = 5432,
    database: Annotated[str, typer.Option("--database")] = "postgres",
    username: Annotated[str, typer.Option("--username")] = "postgres",
    password: Annotated[
        str | None, typer.Option("--password", help="Inline password (discouraged).")
    ] = None,
    password_env: Annotated[
        str | None,
        typer.Option("--password-env", help="Env var holding the password (recommended)."),
    ] = None,
    server: Annotated[str | None, typer.Option("--server", help="Server label.")] = None,
    description: Annotated[str | None, typer.Option("--description")] = None,
    make_default: Annotated[
        bool, typer.Option("--default", help="Mark as default profile.")
    ] = False,
) -> None:
    """Create or replace a connection profile."""
    raise typer.Exit(
        code=profile_cmd.run_add(
            _opts(ctx),
            name,
            host,
            port,
            database,
            username,
            password,
            password_env,
            server,
            description,
            make_default,
        )
    )


@profile_app.command("remove")
def profile_remove(
    ctx: typer.Context,
    name: Annotated[str, typer.Argument(help="Profile name.")],
    yes: Annotated[bool, typer.Option("--yes", help="Confirm deletion.")] = False,
) -> None:
    """Delete a profile."""
    raise typer.Exit(code=profile_cmd.run_remove(_opts(ctx), name, yes))


@profile_app.command("set-default")
def profile_set_default(
    ctx: typer.Context,
    name: Annotated[str, typer.Argument(help="Profile name.")],
) -> None:
    """Mark a profile as default."""
    raise typer.Exit(code=profile_cmd.run_set_default(_opts(ctx), name))


@app.command()
def query(
    ctx: typer.Context,
    sql: Annotated[str | None, typer.Option("--sql", help="One SQL statement.")] = None,
    file: Annotated[str | None, typer.Option("--file", help="File with one SQL statement.")] = None,
    max_rows: Annotated[int, typer.Option("--max-rows", help="Max rows returned.")] = 100,
    allow_write: Annotated[
        bool, typer.Option("--write", help="Permit non-read statements.")
    ] = False,
    confirm: Annotated[bool, typer.Option("--confirm", help="Confirm mutations.")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Classify only.")] = False,
    format_sql: Annotated[
        bool, typer.Option("--format-sql", help="Format SQL and print without executing.")
    ] = False,
    keyword_case: Annotated[
        str, typer.Option("--keyword-case", help="Keyword case for --format-sql: upper or lower.")
    ] = "upper",
) -> None:
    """Run one SQL statement (read-only by default, results capped)."""
    raise typer.Exit(
        code=query_cmd.run(
            _opts(ctx),
            sql,
            file,
            max_rows=max_rows,
            allow_write=allow_write,
            confirm=confirm,
            dry_run=dry_run,
            format_only=format_sql,
            keyword_case=keyword_case,
        )
    )


@app.command()
def snapshot(
    ctx: typer.Context,
    server: Annotated[str | None, typer.Option("--server", help="Server label.")] = None,
) -> None:
    """Take a tracking snapshot of the current target."""
    raise typer.Exit(code=snapshot_cmd.run_snapshot(_opts(ctx), server))


@app.command()
def history(
    ctx: typer.Context,
    profile: Annotated[
        str | None, typer.Option("--profile-filter", help="Filter by profile.")
    ] = None,
    server: Annotated[str | None, typer.Option("--server", help="Filter by server.")] = None,
    database: Annotated[
        str | None, typer.Option("--database-filter", help="Filter by database.")
    ] = None,
    limit: Annotated[int, typer.Option("--limit")] = 20,
) -> None:
    """Show stored snapshots with deltas."""
    raise typer.Exit(code=snapshot_cmd.run_history(_opts(ctx), profile, server, database, limit))


@app.command()
def serve(
    host: Annotated[str, typer.Option("--host", help="Bind host.")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", help="Bind port.")] = 8000,
    reload: Annotated[bool, typer.Option("--reload", help="Auto-reload for development.")] = False,
) -> None:
    """Serve the PgGuardian HTTP API."""
    raise typer.Exit(code=serve_cmd.run(host=host, port=port, reload=reload))


if __name__ == "__main__":
    app()
