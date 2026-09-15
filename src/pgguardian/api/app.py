"""FastAPI application factory for the PgGuardian backend API."""

from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.responses import HTMLResponse

from pgguardian import __version__
from pgguardian.api.deps import verify_token
from pgguardian.api.routers import backups as backups_router
from pgguardian.api.routers import configops as configops_router
from pgguardian.api.routers import databases as databases_router
from pgguardian.api.routers import diagnostics as diagnostics_router
from pgguardian.api.routers import maintenance_ops as maintenance_ops_router
from pgguardian.api.routers import profiles as profiles_router
from pgguardian.api.routers import querymgmt as querymgmt_router
from pgguardian.api.routers import replication as replication_router
from pgguardian.api.routers import roles as roles_router
from pgguardian.api.routers import schemas as schemas_router
from pgguardian.api.routers import snapshots as snapshots_router
from pgguardian.api.routers import sql as sql_router

_SCALAR_HTML = """
<!doctype html>
<html>
<head>
  <title>PgGuardian API Reference</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --scalar-color-1: #f5f5f5;
      --scalar-color-2: #a6a6a6;
      --scalar-color-3: #737373;
      --scalar-color-accent: #6366f1;
      --scalar-background-1: #0a0a0a;
      --scalar-background-2: #141414;
      --scalar-background-3: #1f1f1f;
      --scalar-border-color: #262626;
      --scalar-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    body { margin: 0; background: var(--scalar-background-1); }
    scalar-api-reference { height: 100vh; }
  </style>
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
"""


def create_app() -> FastAPI:
    """Build the FastAPI app (factory keeps tests isolated, no globals)."""
    app = FastAPI(
        title="PgGuardian API",
        description=(
            "Expert PostgreSQL backend: diagnostics, server/database management, "
            "guarded mutations, snapshots and SQL execution. "
            "Read-only by default; writes need explicit opt-in + confirmation."
        ),
        version=__version__,
    )
    guarded = [Depends(verify_token)]

    @app.get("/reference", include_in_schema=False)
    def scalar_reference() -> HTMLResponse:
        """Scalar API reference — modern interactive docs at /reference."""
        return HTMLResponse(_SCALAR_HTML)

    @app.get("/", tags=["meta"])
    def root() -> dict:
        """Service info (no database access)."""
        return {
            "service": "pgguardian",
            "version": __version__,
            "docs": "/docs",
            "reference": "/reference",
            "openapi": "/openapi.json",
            "health": "/api/v1/health",
        }

    @app.get("/healthz", tags=["meta"])
    def healthz() -> dict:
        """Liveness probe (no database access)."""
        return {"status": "ok", "version": __version__}

    app.include_router(diagnostics_router.router, dependencies=guarded)
    app.include_router(sql_router.router, dependencies=guarded)
    app.include_router(profiles_router.router, dependencies=guarded)
    app.include_router(snapshots_router.router, dependencies=guarded)
    app.include_router(databases_router.router, dependencies=guarded)
    app.include_router(schemas_router.router, dependencies=guarded)
    app.include_router(roles_router.router, dependencies=guarded)
    app.include_router(querymgmt_router.router, dependencies=guarded)
    app.include_router(maintenance_ops_router.router, dependencies=guarded)
    app.include_router(configops_router.router, dependencies=guarded)
    app.include_router(replication_router.router, dependencies=guarded)
    app.include_router(backups_router.router, dependencies=guarded)
    return app


app = create_app()
