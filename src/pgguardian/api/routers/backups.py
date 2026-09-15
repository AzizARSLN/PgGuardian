"""Logical backup/restore endpoints via pg_dump / pg_restore / psql.

Backups run as background jobs with JSON sidecars in the backup directory
so they survive restarts. When the client binaries are missing, endpoints
answer 501 with a clear message instead of pretending to work.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient, resolve_connection_string
from pgguardian.utils.security import mask_connection_string

router = APIRouter(prefix="/api/v1/backups", tags=["backups"])


class BackupRequest(MutationRequest):
    """Start a pg_dump backup job (MAINTENANCE)."""

    model_config = ConfigDict(frozen=True)

    database: str | None = Field(default=None, description="Defaults to the connection database.")
    format: str = Field(default="custom", description="custom, plain or directory.")
    schema_only: bool = False
    data_only: bool = False


class RestoreRequest(MutationRequest):
    """Restore a backup into a database (DANGEROUS, needs confirm_name)."""

    model_config = ConfigDict(frozen=True)

    backup_id: str
    database: str
    clean: bool = Field(
        default=False, description="Drop objects before recreating (pg_restore --clean)."
    )


class BackupJob(BaseModel):
    """Backup/restore job state."""

    model_config = ConfigDict(frozen=True)

    id: str
    kind: str = "backup"
    status: str = "running"
    database: str = ""
    file: str | None = None
    size_bytes: int = 0
    started_at: str = ""
    finished_at: str | None = None
    error: str | None = None


_ALLOWED_FORMATS = {"custom": "c", "plain": "p", "directory": "d"}


def _backup_dir(settings: ApiSettings) -> Path:
    path = Path(settings.backup_dir).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _jobs(request: Request) -> dict:
    registry = getattr(request.app.state, "backup_jobs", None)
    if registry is None:
        registry = {}
        request.app.state.backup_jobs = registry
    return registry


def _sidecar_path(directory: Path, job_id: str) -> Path:
    return directory / f"{job_id}.json"


def _write_sidecar(directory: Path, job: BackupJob) -> None:
    _sidecar_path(directory, job.id).write_text(job.model_dump_json(indent=2), encoding="utf-8")


def _load_job(directory: Path, registry: dict, job_id: str) -> BackupJob | None:
    if job_id in registry:
        job = registry[job_id]
        return job if isinstance(job, BackupJob) else None
    sidecar = _sidecar_path(directory, job_id)
    if sidecar.is_file():
        try:
            return BackupJob.model_validate_json(sidecar.read_text(encoding="utf-8"))
        except ValueError:
            return None
    return None


def _dump_env(client: DbClient) -> tuple[dict[str, str], str, str, str, str]:
    settings = client.settings
    conninfo = resolve_connection_string(settings)
    env = dict(os.environ)
    host = settings.host
    port = str(settings.port)
    database = settings.database
    username = settings.username
    # Parse keyword/value conninfo pieces back out for CLI flags (no secrets in argv).
    for part in conninfo.split():
        if "=" in part:
            key, _, value = part.partition("=")
            if key == "host":
                host = value
            elif key == "port":
                port = value
            elif key == "dbname":
                database = value
            elif key == "user":
                username = value
            elif key == "password":
                env["PGPASSWORD"] = value
    if settings.password and "PGPASSWORD" not in env:
        env["PGPASSWORD"] = settings.password
    return env, host, port, database, username


def _require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise HTTPException(
            status_code=501,
            detail=f"'{name}' binary not found on the server. Install PostgreSQL client tools.",
        )
    return path


@router.get("", response_model=list[BackupJob])
def list_backups(
    request: Request, settings: ApiSettings = Depends(get_api_settings)
) -> list[BackupJob]:
    """Backup jobs known from sidecars + live registry (read-only)."""
    directory = _backup_dir(settings)
    registry = _jobs(request)
    jobs: list[BackupJob] = []
    for sidecar in sorted(directory.glob("*.json")):
        try:
            jobs.append(BackupJob.model_validate_json(sidecar.read_text(encoding="utf-8")))
        except ValueError:
            continue
    for job_id, job in registry.items():
        if isinstance(job, BackupJob) and all(known.id != job_id for known in jobs):
            jobs.append(job)
    return sorted(jobs, key=lambda job: job.started_at, reverse=True)


@router.get("/{job_id}", response_model=BackupJob)
def get_backup(
    job_id: str, request: Request, settings: ApiSettings = Depends(get_api_settings)
) -> BackupJob:
    """One job by id (404 when unknown)."""
    job = _load_job(_backup_dir(settings), _jobs(request), job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Backup job '{job_id}' not found.")
    return job


@router.get("/{job_id}/download")
def download_backup(
    job_id: str, request: Request, settings: ApiSettings = Depends(get_api_settings)
) -> FileResponse:
    """Download the backup file (404/409 when missing or unfinished)."""
    directory = _backup_dir(settings)
    job = _load_job(directory, _jobs(request), job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Backup job '{job_id}' not found.")
    if job.status != "done" or not job.file:
        raise HTTPException(status_code=409, detail=f"Backup '{job_id}' is not ready for download.")
    path = directory / Path(job.file).name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Backup file no longer on disk.")
    return FileResponse(str(path), filename=path.name)


@router.post("", response_model=BackupJob)
def start_backup(
    body: BackupRequest,
    request: Request,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> BackupJob:
    """Run pg_dump as a background job (MAINTENANCE)."""
    ensure_writes_allowed(settings, "backup.create")
    fmt = body.format.lower()
    if fmt not in _ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail="format must be custom, plain or directory.")
    if body.dry_run:
        raise HTTPException(status_code=400, detail="dry_run is a no-op for backups; omit it.")
    require_confirm(body, "backup.create")
    pg_dump = _require_binary("pg_dump")
    with mapped_errors(settings):
        client.ping()
        env, host, port, default_db, username = _dump_env(client)
    database = body.database or default_db
    job_id = uuid.uuid4().hex[:12]
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    suffix = {"custom": "dump", "plain": "sql", "directory": "dir"}[fmt]
    filename = f"{database}-{stamp}-{job_id}.{suffix}"
    directory = _backup_dir(settings)
    job = BackupJob(
        id=job_id,
        kind="backup",
        status="running",
        database=database,
        file=filename,
        started_at=datetime.utcnow().isoformat() + "Z",
    )
    _jobs(request)[job_id] = job
    _write_sidecar(directory, job)
    audit("backup.create", database, RiskLevel.MAINTENANCE, settings)

    def _run() -> None:
        target = directory / filename
        cmd = [
            pg_dump,
            "-h",
            host,
            "-p",
            port,
            "-U",
            username,
            "-F",
            _ALLOWED_FORMATS[fmt],
            "-f",
            str(target),
            database,
        ]
        if body.schema_only:
            cmd.append("--schema-only")
        if body.data_only:
            cmd.append("--data-only")
        try:
            subprocess.run(
                cmd,
                env=env,
                timeout=6 * 3600,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            done = job.model_copy(
                update={
                    "status": "done",
                    "finished_at": datetime.utcnow().isoformat() + "Z",
                    "size_bytes": target.stat().st_size if target.exists() else 0,
                }
            )
        except Exception as exc:  # noqa: BLE001 — job result must capture everything
            done = job.model_copy(
                update={
                    "status": "failed",
                    "finished_at": datetime.utcnow().isoformat() + "Z",
                    "error": mask_connection_string(str(exc))[:500],
                }
            )
        _jobs(request)[job_id] = done
        _write_sidecar(directory, done)

    import threading

    threading.Thread(target=_run, name=f"pgguardian-backup-{job_id}", daemon=True).start()
    return job


@router.post("/restore", response_model=BackupJob)
def start_restore(
    body: RestoreRequest,
    request: Request,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> BackupJob:
    """Restore a backup into a database (DANGEROUS, confirm_name=database)."""
    ensure_dangerous_allowed(settings, "backup.restore")
    if body.dry_run:
        raise HTTPException(status_code=400, detail="dry_run is a no-op for restores; omit it.")
    require_confirm(body, "backup.restore", target=body.database)
    directory = _backup_dir(settings)
    job = _load_job(directory, _jobs(request), body.backup_id)
    if job is None or not job.file:
        raise HTTPException(status_code=404, detail=f"Backup '{body.backup_id}' not found.")
    source = directory / Path(job.file).name
    if not source.is_file():
        raise HTTPException(status_code=404, detail="Backup file no longer on disk.")
    with mapped_errors(settings):
        client.ping()
        env, host, port, _, username = _dump_env(client)
    is_plain = source.suffix.lower() == ".sql"
    binary = _require_binary("psql" if is_plain else "pg_restore")
    job_id = uuid.uuid4().hex[:12]
    restore_job = BackupJob(
        id=job_id,
        kind="restore",
        status="running",
        database=body.database,
        file=job.file,
        started_at=datetime.utcnow().isoformat() + "Z",
    )
    _jobs(request)[job_id] = restore_job
    _write_sidecar(directory, restore_job)
    audit("backup.restore", body.database, RiskLevel.DANGEROUS, settings)

    def _run() -> None:
        if is_plain:
            cmd = [
                binary,
                "-h",
                host,
                "-p",
                port,
                "-U",
                username,
                "-d",
                body.database,
                "-f",
                str(source),
            ]
        else:
            cmd = [binary, "-h", host, "-p", port, "-U", username, "-d", body.database]
            if body.clean:
                cmd.append("--clean")
            cmd.append(str(source))
        try:
            subprocess.run(
                cmd,
                env=env,
                timeout=6 * 3600,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            done = restore_job.model_copy(
                update={"status": "done", "finished_at": datetime.utcnow().isoformat() + "Z"}
            )
        except Exception as exc:  # noqa: BLE001 — job result must capture everything
            done = restore_job.model_copy(
                update={
                    "status": "failed",
                    "finished_at": datetime.utcnow().isoformat() + "Z",
                    "error": mask_connection_string(str(exc))[:500],
                }
            )
        _jobs(request)[job_id] = done
        _write_sidecar(directory, done)

    import threading

    threading.Thread(target=_run, name=f"pgguardian-restore-{job_id}", daemon=True).start()
    return restore_job
