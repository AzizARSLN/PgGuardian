"""``pgguardian profile`` command orchestration (local profile store)."""

from __future__ import annotations

import typer
from rich.console import Console
from rich.table import Table

from pgguardian.cli import GlobalOptions, effective_format, print_json
from pgguardian.profiles.store import Profile, ProfileNotFoundError, ProfileStore


def _console(opts: GlobalOptions) -> Console:
    return Console(no_color=opts.no_color, quiet=opts.quiet)


def run_list(opts: GlobalOptions) -> int:
    """List saved profiles (passwords never shown)."""
    profiles = ProfileStore().list()
    if effective_format(opts) == "json":
        print_json([profile.redacted().model_dump(mode="json") for profile in profiles])
        return 0
    console = _console(opts)
    if not profiles:
        console.print("[dim]No profiles saved yet. Use 'pgguardian profile add'.[/]")
        return 0
    table = Table(show_lines=False)
    for header in ["Name", "Server", "Target", "User", "Default", "Description"]:
        table.add_column(header)
    for profile in profiles:
        table.add_row(
            profile.name,
            profile.server or "",
            f"{profile.host}:{profile.port}/{profile.database}",
            profile.username,
            "yes" if profile.is_default else "",
            profile.description or "",
        )
    console.print(table)
    return 0


def run_show(opts: GlobalOptions, name: str) -> int:
    """Show one profile (passwords never shown)."""
    try:
        profile = ProfileStore().get(name).redacted()
    except ProfileNotFoundError as exc:
        typer.echo(str(exc), err=True)
        return 3
    if effective_format(opts) == "json":
        print_json(profile)
        return 0
    console = _console(opts)
    console.print(f"[bold]{profile.name}[/]" + (" [dim](default)[/]" if profile.is_default else ""))
    for label, value in (
        ("Server", profile.server or "-"),
        ("Host", profile.host),
        ("Port", str(profile.port)),
        ("Database", profile.database),
        ("Username", profile.username),
        (
            "Password",
            "via env " + profile.password_env
            if profile.password_env
            else ("set" if profile.password else "not set"),
        ),
        ("Description", profile.description or "-"),
    ):
        console.print(f"  [dim]{label:11}[/] {value}")
    return 0


def run_add(
    opts: GlobalOptions,
    name: str,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str | None,
    password_env: str | None,
    server: str | None,
    description: str | None,
    make_default: bool,
) -> int:
    """Create or replace a profile."""
    try:
        profile = Profile(
            name=name,
            host=host,
            port=port,
            database=database,
            username=username,
            password=password,
            password_env=password_env,
            server=server,
            description=description,
            is_default=make_default,
        )
    except ValueError as exc:
        typer.echo(f"Invalid profile: {exc}", err=True)
        return 3
    stored = ProfileStore().save(profile)
    if make_default:
        ProfileStore().set_default(name)
    if effective_format(opts) == "json":
        print_json(stored.redacted())
    else:
        _console(opts).print(f"Profile '[bold]{name}[/]' saved.")
    return 0


def run_remove(opts: GlobalOptions, name: str, yes: bool = False) -> int:
    """Delete a profile (needs --yes)."""
    if not yes:
        typer.echo(f"Refusing to delete profile '{name}' without --yes.", err=True)
        return 3
    if not ProfileStore().delete(name):
        typer.echo(f"Profile '{name}' not found.", err=True)
        return 3
    if effective_format(opts) != "json":
        _console(opts).print(f"Profile '{name}' deleted.")
    return 0


def run_set_default(opts: GlobalOptions, name: str) -> int:
    """Mark a profile as default."""
    try:
        ProfileStore().set_default(name)
    except ProfileNotFoundError as exc:
        typer.echo(str(exc), err=True)
        return 3
    if effective_format(opts) != "json":
        _console(opts).print(f"Profile '[bold]{name}[/]' is now the default.")
    return 0
