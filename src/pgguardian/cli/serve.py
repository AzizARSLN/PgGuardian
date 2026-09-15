"""``pgguardian serve`` command orchestration (run the backend API)."""

from __future__ import annotations

import typer


def run(host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> int:
    """Serve the PgGuardian HTTP API with uvicorn."""
    import uvicorn

    if reload:
        uvicorn.run("pgguardian.api.app:app", host=host, port=port, reload=True)
    else:
        from pgguardian.api.app import app

        uvicorn.run(app, host=host, port=port)
    return 0


def describe() -> None:
    """Print how the API is configured (no server started)."""
    typer.echo(
        "PgGuardian API: pgguardian serve [--host 127.0.0.1] [--port 8000]\n"
        "Auth: set PGGUARDIAN_API_TOKEN to require bearer tokens.\n"
        "Writes: PGGUARDIAN_ALLOW_WRITES=1 enables mutations (confirm required).\n"
        "Danger: PGGUARDIAN_ALLOW_DANGEROUS=1 enables drops/terminates/reindex."
    )
