"""FastAPI application factory for the PgGuardian backend API."""

from __future__ import annotations

from fastapi import Depends, FastAPI

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

    @app.get("/", tags=["meta"])
    def root() -> dict:
        """Service info (no database access)."""
        return {
            "service": "pgguardian",
            "version": __version__,
            "docs": "/docs",
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
