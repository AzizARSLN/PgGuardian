"""Read-only diagnostic endpoints mirroring the CLI collectors."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.cli import GlobalOptions
from pgguardian.cli.report import build_report_dict
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics import connections as connections_diag
from pgguardian.diagnostics import diagnose as diagnose_diag
from pgguardian.diagnostics import health as health_diag
from pgguardian.diagnostics import indexes as indexes_diag
from pgguardian.diagnostics import locks as locks_diag
from pgguardian.diagnostics import maintenance as maintenance_diag
from pgguardian.diagnostics import queries as queries_diag
from pgguardian.diagnostics import storage as storage_diag
from pgguardian.models.connection import ConnectionReport
from pgguardian.models.diagnostic import DiagnosticFinding
from pgguardian.models.health import HealthReport
from pgguardian.models.index import IndexReport
from pgguardian.models.lock import LockReport
from pgguardian.models.maintenance import MaintenanceReport
from pgguardian.models.query import QueryReport
from pgguardian.models.storage import StorageReport

router = APIRouter(prefix="/api/v1", tags=["diagnostics"])


def _preflight(client: DbClient) -> None:
    settings = client.settings
    with mapped_errors(settings):
        client.ping()


@router.get("/health", response_model=HealthReport)
def get_health(client: DbClient = Depends(resolve_client)) -> HealthReport:
    """Instance/database health with 0–100 score."""
    _preflight(client)
    with mapped_errors(client.settings):
        return health_diag.collect_health(client)


@router.get("/diagnose", response_model=list[DiagnosticFinding])
def get_diagnose(client: DbClient = Depends(resolve_client)) -> list[DiagnosticFinding]:
    """Aggregated findings with recommendations."""
    _preflight(client)
    with mapped_errors(client.settings):
        return diagnose_diag.collect_findings(client)


@router.get("/connections", response_model=ConnectionReport)
def get_connections(
    limit: int = 20, client: DbClient = Depends(resolve_client)
) -> ConnectionReport:
    """Connection states, usage and waiting backends."""
    _preflight(client)
    with mapped_errors(client.settings):
        return connections_diag.collect_connections(client, limit=min(limit, 500))


@router.get("/queries/active", response_model=QueryReport)
def get_active_queries(limit: int = 20, client: DbClient = Depends(resolve_client)) -> QueryReport:
    """Currently active queries."""
    _preflight(client)
    with mapped_errors(client.settings):
        return queries_diag.collect_active_queries(client, limit=min(limit, 500))


@router.get("/queries/long-running", response_model=QueryReport)
def get_long_running_queries(
    min_seconds: int = 60, limit: int = 20, client: DbClient = Depends(resolve_client)
) -> QueryReport:
    """Queries running longer than ``min_seconds``."""
    _preflight(client)
    with mapped_errors(client.settings):
        return queries_diag.collect_long_running_queries(
            client, min_seconds=min_seconds, limit=min(limit, 500)
        )


@router.get("/locks", response_model=LockReport)
def get_locks(limit: int = 20, client: DbClient = Depends(resolve_client)) -> LockReport:
    """Lock summary, blocking pairs and chains (read-only)."""
    _preflight(client)
    with mapped_errors(client.settings):
        return locks_diag.collect_locks(client, limit=min(limit, 500))


@router.get("/storage", response_model=StorageReport)
def get_storage(
    section: str = "all", limit: int = 20, client: DbClient = Depends(resolve_client)
) -> StorageReport:
    """Database/table/index sizes (``section``: all, databases, tables, indexes)."""
    _preflight(client)
    with mapped_errors(client.settings):
        report = storage_diag.collect_storage(client, limit=min(limit, 500))
    if section == "databases":
        return StorageReport(databases=report.databases, limit=report.limit)
    if section == "tables":
        return StorageReport(tables=report.tables, limit=report.limit)
    if section == "indexes":
        return StorageReport(indexes=report.indexes, limit=report.limit)
    return report


@router.get("/indexes", response_model=IndexReport)
def get_indexes(limit: int = 20, client: DbClient = Depends(resolve_client)) -> IndexReport:
    """Index usage and potentially-unused candidates."""
    _preflight(client)
    with mapped_errors(client.settings):
        return indexes_diag.collect_indexes(client, limit=min(limit, 500))


@router.get("/maintenance", response_model=MaintenanceReport)
def get_maintenance(
    limit: int = 20, client: DbClient = Depends(resolve_client)
) -> MaintenanceReport:
    """VACUUM/ANALYZE state per table."""
    _preflight(client)
    with mapped_errors(client.settings):
        return maintenance_diag.collect_maintenance(client, limit=min(limit, 500))


@router.get("/report")
def get_report(
    limit: int = 20, profile: str | None = None, client: DbClient = Depends(resolve_client)
) -> dict:
    """Full aggregated report (same payload as ``pgguardian report --format json``)."""
    _preflight(client)
    with mapped_errors(client.settings):
        opts = GlobalOptions(
            profile=profile,
            host=client.settings.host,
            port=client.settings.port,
            database=client.settings.database,
            username=client.settings.username,
        )
        return build_report_dict(opts, limit=min(limit, 500), client=client)
