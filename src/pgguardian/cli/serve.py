"""``pgguardian serve`` command orchestration (run the backend API)."""

from __future__ import annotations

import os
import sys

import typer


_LOG_LEVELS = {"critical", "error", "warning", "info", "debug", "trace"}


def _find_reload_dirs() -> list[str] | None:
    """Return reload dirs pointing to the real PgGuardian package on disk.

    Handles: src/PgGuardian (actual case), src/pgguardian (canonical name),
    installed site-packages, and missing src layout by falling back to CWD.
    """
    candidates: list[str] = []
    cli_dir = os.path.dirname(os.path.abspath(__file__))
    pkg_dir = os.path.normpath(os.path.join(cli_dir, ".."))
    src_dir = os.path.normpath(os.path.join(pkg_dir, ".."))

    for d in (pkg_dir, os.path.join(src_dir, "pgguardian"), os.path.join(src_dir, "PgGuardian"), src_dir):
        if os.path.isdir(d) and d not in candidates:
            candidates.append(d)

    if os.getcwd() not in candidates:
        candidates.append(os.getcwd())

    return candidates or None


def run(
    host: str = "127.0.0.1",
    port: int = 8000,
    reload: bool = False,
    debug: bool = False,
    log_level: str = "info",
) -> int:
    """Serve the PgGuardian HTTP API with uvicorn.

    ``--debug`` is a shorthand for ``--reload --log-level debug``.
    """
    import logging
    import uvicorn

    if debug:
        reload = True
        if log_level not in {"debug", "trace"}:
            log_level = "debug"

    level = log_level.lower()
    if level not in _LOG_LEVELS:
        typer.secho(
            f"Invalid log-level '{log_level}'. Use one of: {sorted(_LOG_LEVELS)}",
            fg=typer.colors.RED,
            err=True,
        )
        return 3

    _ensure_src_on_pythonpath()
    _print_banner(host, port, reload, level)

    uvicorn_kwargs: dict = {
        "host": host,
        "port": port,
        "log_level": level if level != "trace" else "trace",
        "access_log": level in {"info", "debug", "trace"},
    }

    if level == "debug" or level == "trace":
        uvicorn_kwargs["use_colors"] = True
        logging.getLogger("uvicorn").setLevel(
            logging.DEBUG if level == "debug" else 5
        )
        logging.getLogger("pgguardian").setLevel(
            logging.DEBUG if level == "debug" else 5
        )

    if reload:
        reload_dirs = _find_reload_dirs()
        uvicorn.run(
            "pgguardian.api.app:app",
            reload=reload,
            reload_dirs=reload_dirs,
            reload_includes=["*.py", "*.sql"],
            **uvicorn_kwargs,
        )
    else:
        from pgguardian.api.app import app

        uvicorn.run(app, **uvicorn_kwargs)
    return 0


def _ensure_src_on_pythonpath() -> None:
    """Make sure the ``src/`` folder is on ``sys.path`` so child
    uvicorn reload processes can also resolve ``pgguardian`` even
    when the editable install isn't fully active in the spawned env."""
    here = os.path.dirname(os.path.abspath(__file__))
    pkg_root = os.path.normpath(os.path.join(here, "..", ".."))
    src_parent = os.path.normpath(os.path.join(pkg_root, ".."))
    extra_paths: list[str] = []
    for p in (pkg_root, src_parent, os.path.dirname(pkg_root)):
        if os.path.isdir(p) and p not in sys.path:
            extra_paths.append(p)
    # insert high priority but AFTER CWD
    insert_at = 1
    for p in extra_paths:
        sys.path.insert(insert_at, p)
        os.environ["PYTHONPATH"] = (
            p + os.pathsep + os.environ.get("PYTHONPATH", "")
        ).rstrip(os.pathsep)
        insert_at += 1


def _print_banner(host: str, port: int, reload: bool, log_level: str) -> None:
    from pgguardian import __version__
    from pgguardian.api.settings import ApiSettings

    settings = ApiSettings()

    try:
        import pyfiglet

        logo = pyfiglet.figlet_format("PgGuardian", font="slant")
        typer.secho(logo, fg=typer.colors.MAGENTA, bold=True)
    except Exception:
        typer.secho("  ╔═╗╔═╗╔═╗╦ ╦╔═╗╦═╗╔╦╗╦╔═╗╔╗╔", fg=typer.colors.MAGENTA, bold=True)
        typer.secho("  ╠═╝║ ║║ ╦║ ║╠═╣╠╦╝ ║ ║║ ║║║║", fg=typer.colors.MAGENTA, bold=True)
        typer.secho("  ╩  ╚═╝╚═╝╚═╝╩ ╩╩╚═ ╩ ╩╚═╝╝╚╝", fg=typer.colors.MAGENTA, bold=True)
    typer.secho(
        f"  v{__version__}  ·  http://{host}:{port}",
        fg=typer.colors.CYAN,
        bold=True,
    )
    typer.echo("")
    typer.echo("  📚  Docs (Swagger)    : /docs")
    typer.secho("  ✨  Scalar Reference  : /reference", fg=typer.colors.MAGENTA, bold=True)
    typer.echo("  📄  OpenAPI JSON      : /openapi.json")
    typer.echo("  💓  Liveness          : /healthz")
    typer.echo("")

    if reload:
        typer.secho(
            "  🔄  Auto-reload       : ON (development mode)",
            fg=typer.colors.YELLOW,
        )
    typer.echo(f"  📝  Log level         : {log_level.upper()}")
    typer.echo(
        "  🔐  Bearer Token      : "
        + (
            typer.style("SET 🔒", fg=typer.colors.GREEN)
            if settings.api_token
            else typer.style("OFF ⚠️ (dev only)", fg=typer.colors.RED, bold=True)
        )
    )
    typer.echo(
        "  ✏️  Allow Writes      : "
        + (
            typer.style("ON", fg=typer.colors.YELLOW)
            if settings.allow_writes
            else typer.style("OFF", fg=typer.colors.WHITE)
        )
    )
    typer.echo(
        "  ⚠️  Allow Dangerous   : "
        + (
            typer.style("ON", fg=typer.colors.RED, bold=True)
            if settings.allow_dangerous
            else typer.style("OFF", fg=typer.colors.WHITE)
        )
    )
    typer.echo("")
    typer.echo("  Press Ctrl+C to stop the server.")
    typer.echo("─" * 60)


def describe() -> None:
    """Print how the API is configured (no server started)."""
    typer.echo(
        "PgGuardian API: pgguardian serve [--host 127.0.0.1] [--port 8000]\n"
        "  --debug       Shorthand for --reload --log-level debug (development)\n"
        "  --reload      Auto-reload on code changes\n"
        "  --log-level   critical | error | warning | info | debug | trace\n"
        "\nAuth: set PGGUARDIAN_API_TOKEN to require bearer tokens.\n"
        "Writes: PGGUARDIAN_ALLOW_WRITES=1 enables mutations (confirm required).\n"
        "Danger: PGGUARDIAN_ALLOW_DANGEROUS=1 enables drops/terminates/reindex."
    )
