"""Logical backup/restore endpoints via pg_dump / pg_restore / psql.

Backups run as background jobs with JSON sidecars in the backup directory
so they survive restarts. When the client binaries are missing, endpoints
answer 501 with a clear message instead of pretending to work.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from psycopg.conninfo import conninfo_to_dict
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
    validate_identifier,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import APPLICATION_NAME, DbClient, resolve_connection_string
from pgguardian.utils.security import sanitize_error, sanitize_text

router = APIRouter(prefix="/api/v1/backups", tags=["backups"])


class BackupRequest(MutationRequest):
    """Start a pg_dump backup job (MAINTENANCE)."""

    model_config = ConfigDict(frozen=True)

    database: str | None = Field(default=None, description="Defaults to the connection database.")
    format: str = Field(default="custom", description="custom, plain or directory.")
    schema_only: bool = False
    data_only: bool = False
    compression: int | None = Field(
        default=None, ge=0, le=9, description="pg_dump compression level (custom/directory only)."
    )
    schema_name: str | None = Field(default=None, description="Dump only this schema.")
    schema_names: list[str] | None = Field(
        default=None, description="Dump only these schemas. Empty or unset: the whole database."
    )
    directory: str | None = Field(
        default=None, description="Absolute directory on the API server. Unset: the default one."
    )
    table_name: str | None = Field(default=None, description="Dump only this table.")
    filename: str | None = Field(
        default=None, description="File name prefix; the job id and extension are appended."
    )


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
    profile: str | None = None
    directory: str | None = None
    schemas: list[str] = Field(default_factory=list)


class BackupOptions(BaseModel):
    """Defaults for the create form."""

    default_directory: str
    default_database: str


class SchemaChoice(BaseModel):
    """One schema that can be included in a backup."""

    name: str
    owner: str | None = None
    tables: int = 0


_SCHEMAS_SQL = (
    "SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner,"
    " (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = n.oid"
    "  AND c.relkind IN ('r', 'p')) AS tables"
    " FROM pg_namespace n"
    " WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'"
    " ORDER BY n.nspname"
)

_ALLOWED_FORMATS = {"custom": "c", "plain": "p", "directory": "d"}
_SUFFIXES = {"custom": "dump", "plain": "sql", "directory": "dir"}
_JOB_TIMEOUT_SECONDS = 6 * 3600
_STDERR_TAIL_CHARS = 1000
_INTERRUPTED_ERROR = "interrupted: the server stopped before this job finished."
_CANCELLED_ERROR = "cancelled by operator."

# Job ids owned by a worker thread in this process. A "running" job that is not
# in here has no one left to finish it.
_active_jobs: set[str] = set()
# Live tool processes (pg_dump/pg_restore/psql) by job id, so a cancel request
# can terminate them; and the ids the user already asked to stop.
_job_procs: dict[str, subprocess.Popen] = {}
_cancelled_jobs: set[str] = set()
_active_lock = threading.Lock()

# pg_dump/pg_restore parse "host=x dbname=y" as a conninfo, and the name also
# becomes part of the backup file path.
_DATABASE_NAME = re.compile(r"[^\W\d][\w$ .-]{0,62}")
_JOB_ID = re.compile(r"[\w-]{1,64}")
_FILE_PREFIX = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}")


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _backup_dir(settings: ApiSettings) -> Path:
    path = Path(settings.backup_dir).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _target_directory(raw: str | None, settings: ApiSettings) -> Path:
    """Where the dump goes. The file name is generated, so nothing gets overwritten."""
    if not raw or not raw.strip():
        return _backup_dir(settings)
    path = Path(raw.strip()).expanduser()
    if "\0" in raw or not path.is_absolute():
        raise HTTPException(status_code=400, detail="Backup directory must be an absolute path.")
    path = path.resolve()
    if settings.backup_allowed_dirs:
        roots = [Path(r).resolve() for r in settings.backup_allowed_dirs.split(os.pathsep) if r]
        if not any(path == root or root in path.parents for root in roots):
            raise HTTPException(
                status_code=403, detail="Backup directory is outside PGGUARDIAN_BACKUP_ALLOWED_DIRS."
            )
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".pgguardian-{uuid.uuid4().hex[:8]}"
        probe.touch()
        probe.unlink()
    except OSError as exc:
        raise HTTPException(
            status_code=400, detail=f"Backup directory is not writable: {exc.strerror or exc}"
        ) from exc
    return path


def _list_schemas(client: DbClient, database: str) -> list[dict]:
    return client.for_database(database).fetch_all(_SCHEMAS_SQL)


def _quote_pattern(name: str) -> str:
    """pg_dump pattern matching exactly this name.

    Double quotes keep wildcards and case literal. Non-ASCII letters go through
    as "?" because on Windows argv reaches pg_dump in the ANSI code page and the
    server rejects those bytes as invalid UTF-8.
    """
    parts = re.findall(r"[\x00-\x7f]+|[^\x00-\x7f]", name)
    return "".join(
        '"' + part.replace('"', '""') + '"' if part.isascii() else "?" for part in parts
    )


def _pattern_collisions(name: str, known: set[str]) -> list[str]:
    """Other schemas the "?" wildcards of this name would also match."""
    regex = "".join(re.escape(c) if c.isascii() else "." for c in name)
    return [other for other in known if other != name and re.fullmatch(regex, other)]


def _job_path(job: BackupJob, default_directory: Path) -> Path:
    base = Path(job.directory) if job.directory else default_directory
    return base / Path(job.file or "").name


def _jobs(request: Request) -> dict:
    registry = getattr(request.app.state, "backup_jobs", None)
    if registry is None:
        registry = {}
        request.app.state.backup_jobs = registry
    return registry


def _sidecar_path(directory: Path, job_id: str) -> Path:
    return directory / f"{job_id}.json"


def _write_sidecar(directory: Path, job: BackupJob) -> None:
    # Replace atomically: the list endpoint may read while a worker writes.
    target = _sidecar_path(directory, job.id)
    temp = target.with_name(f"{target.name}.{uuid.uuid4().hex[:8]}.tmp")
    temp.write_text(job.model_dump_json(indent=2), encoding="utf-8")
    os.replace(temp, target)


def _settle_orphan(directory: Path, registry: dict, job: BackupJob) -> BackupJob:
    """Mark a running job failed when no live thread owns it (server restart)."""
    if job.status not in ("running", "queued"):
        return job
    with _active_lock:
        if job.id in _active_jobs:
            return job
    settled = job.model_copy(
        update={
            "status": "failed",
            "finished_at": job.finished_at or _utc_now(),
            "error": job.error or _INTERRUPTED_ERROR,
        }
    )
    registry[job.id] = settled
    try:
        _write_sidecar(directory, settled)
    except OSError:
        pass  # Still reported as failed; the next read tries again.
    return settled


def _load_job(directory: Path, registry: dict, job_id: str) -> BackupJob | None:
    # The id reaches a file path, and %5C decodes to a separator on Windows.
    if not _JOB_ID.fullmatch(job_id):
        return None
    job = registry.get(job_id)
    if isinstance(job, BackupJob):
        return _settle_orphan(directory, registry, job)
    sidecar = _sidecar_path(directory, job_id)
    if sidecar.is_file():
        try:
            loaded = BackupJob.model_validate_json(sidecar.read_text(encoding="utf-8"))
        except ValueError:
            return None
        return _settle_orphan(directory, registry, loaded)
    return None


def _dump_env(client: DbClient) -> tuple[dict[str, str], str, str, str, str]:
    settings = client.settings
    conninfo = resolve_connection_string(settings)
    env = dict(os.environ)
    try:
        params = conninfo_to_dict(conninfo)
    except Exception:  # noqa: BLE001 — e.g. an unquoted password with a space
        params = {}
    host = str(params.get("host") or settings.host)
    port = str(params.get("port") or settings.port)
    database = str(params.get("dbname") or settings.database)
    username = str(params.get("user") or settings.username)
    # The resolved password wins: an ambient PGPASSWORD belongs to another server.
    password = params.get("password") or settings.password
    if password:
        env["PGPASSWORD"] = str(password)
    if params.get("sslmode"):
        env["PGSSLMODE"] = str(params["sslmode"])
    # Tag the libpq-backed tools (pg_dump/pg_restore/psql) as pgGuardian too.
    env["PGAPPNAME"] = APPLICATION_NAME
    return env, host, port, database, username


def _safe_database_name(name: str) -> str:
    if not _DATABASE_NAME.fullmatch(name) or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid database name.")
    return name


def _safe_file_prefix(name: str, suffix: str) -> str:
    prefix = name.strip()
    if prefix.lower().endswith(f".{suffix}"):
        prefix = prefix[: -(len(suffix) + 1)]
    if not _FILE_PREFIX.fullmatch(prefix) or ".." in prefix:
        raise HTTPException(status_code=400, detail="Invalid backup file name.")
    return prefix


def _require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise HTTPException(
            status_code=501,
            detail=f"'{name}' binary not found on the server. Install PostgreSQL client tools.",
        )
    return path


def _failure_message(tool: str, exc: Exception, secrets: list[str]) -> str:
    """Why a job failed: the tool's own stderr tail, without secrets."""
    raw = getattr(exc, "stderr", None)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    tail = (raw or "").strip()[-_STDERR_TAIL_CHARS:]
    if isinstance(exc, subprocess.TimeoutExpired):
        headline = f"{tool} timed out after {_JOB_TIMEOUT_SECONDS} seconds"
    elif isinstance(exc, subprocess.CalledProcessError):
        headline = f"{tool} exited with code {exc.returncode}"
    else:
        return sanitize_error(exc, secrets)[:_STDERR_TAIL_CHARS]
    return sanitize_text(f"{headline}: {tail}" if tail else headline, secrets)


class _JobCancelled(RuntimeError):
    """Raised inside a worker when the operator cancelled the job."""


def _run_tool(job_id: str, cmd: list[str], env: dict[str, str]) -> None:
    """Run a tool as a child process that a cancel request can terminate.

    The handle is registered before waiting, so ``POST /backups/{id}/cancel``
    finds and kills it even while the tool is mid-run.
    """
    with _active_lock:
        cancelled = job_id in _cancelled_jobs
        if cancelled:
            _cancelled_jobs.discard(job_id)
    if cancelled:
        raise _JobCancelled()

    proc = subprocess.Popen(
        cmd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    with _active_lock:
        _job_procs[job_id] = proc
        # A cancel arriving between the check above and the registration now wins.
        cancelled = job_id in _cancelled_jobs
    if cancelled:
        proc.terminate()
    try:
        _, stderr = proc.communicate(timeout=_JOB_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise
    finally:
        with _active_lock:
            _job_procs.pop(job_id, None)
            _cancelled_jobs.discard(job_id)
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, stderr=stderr)


def _path_size(path: Path) -> int:
    if path.is_dir():
        return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    return path.stat().st_size if path.exists() else 0


def _remove_partial(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    except OSError:
        pass  # A leftover partial file must not mask the real failure.


def _claim(job_id: str) -> None:
    with _active_lock:
        _active_jobs.add(job_id)


def _start_worker(job_id: str, name: str, target) -> None:
    def _wrapped() -> None:
        try:
            target()
        finally:
            with _active_lock:
                _active_jobs.discard(job_id)

    threading.Thread(target=_wrapped, name=f"pgguardian-{name}-{job_id}", daemon=True).start()


@router.get("", response_model=list[BackupJob])
def list_backups(
    request: Request, settings: ApiSettings = Depends(get_api_settings)
) -> list[BackupJob]:
    """Backup jobs known from sidecars + live registry (read-only)."""
    directory = _backup_dir(settings)
    registry = _jobs(request)
    jobs: dict[str, BackupJob] = {}
    for job_id in [sidecar.stem for sidecar in sorted(directory.glob("*.json"))] + list(registry):
        if job_id not in jobs:
            job = _load_job(directory, registry, job_id)
            if job is not None:
                jobs[job_id] = job
    return sorted(jobs.values(), key=lambda job: job.started_at, reverse=True)


@router.get("/options", response_model=BackupOptions)
def backup_options(
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> BackupOptions:
    """Default directory and database for the selected profile."""
    return BackupOptions(
        default_directory=str(_backup_dir(settings).resolve()),
        default_database=client.settings.database,
    )


@router.get("/schemas", response_model=list[SchemaChoice])
def backup_schemas(
    database: str,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> list[SchemaChoice]:
    """Schemas of one database on the selected profile's server."""
    _safe_database_name(database)
    with mapped_errors(settings):
        return [SchemaChoice(**row) for row in _list_schemas(client, database)]


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
    """Download the backup file (400 for directories, 404/409 when missing or unfinished)."""
    directory = _backup_dir(settings)
    job = _load_job(directory, _jobs(request), job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Backup job '{job_id}' not found.")
    if job.kind != "backup" or job.status != "done" or not job.file:
        raise HTTPException(status_code=409, detail=f"Backup '{job_id}' is not ready for download.")
    path = _job_path(job, directory)
    if path.is_dir():
        raise HTTPException(
            status_code=400,
            detail=(
                f"Backup '{job_id}' uses the directory format and cannot be downloaded as one "
                f"file. Copy '{path.name}' from the server's backup directory, or use the "
                "custom or plain format."
            ),
        )
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Backup file no longer on disk.")
    return FileResponse(str(path), filename=path.name)


@router.post("/{job_id}/cancel", response_model=BackupJob)
def cancel_backup(
    job_id: str, request: Request, settings: ApiSettings = Depends(get_api_settings)
) -> BackupJob:
    """Stop a running backup/restore job (MAINTENANCE).

    A worker that is already mid-tool has its child process terminated; one that
    has not started yet skips the tool entirely. Either way the job ends as
    ``cancelled``.
    """
    ensure_writes_allowed(settings, "backup.cancel")
    directory = _backup_dir(settings)
    registry = _jobs(request)
    job = _load_job(directory, registry, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Backup job '{job_id}' not found.")
    if job.status not in ("running", "queued"):
        return job  # Already finished; nothing to stop.

    with _active_lock:
        _cancelled_jobs.add(job_id)
        proc = _job_procs.get(job_id)
    if proc is not None and proc.poll() is None:
        proc.terminate()

    stopped = job.model_copy(
        update={
            "status": "cancelled",
            "finished_at": _utc_now(),
            "error": _CANCELLED_ERROR,
        }
    )
    registry[job_id] = stopped
    _write_sidecar(directory, stopped)
    audit("backup.cancel", job.database, RiskLevel.MAINTENANCE, settings)
    return stopped


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
    if body.schema_only and body.data_only:
        raise HTTPException(
            status_code=400, detail="schema_only and data_only cannot be used together."
        )
    if body.compression is not None and fmt == "plain":
        # pg_dump would gzip the .sql file, which psql then cannot restore.
        raise HTTPException(status_code=400, detail="compression needs custom or directory format.")
    suffix = _SUFFIXES[fmt]
    # Quoted below so pg_dump matches the exact name; validation rules out embedded quotes.
    schema_name = (
        validate_identifier(body.schema_name, what="schema name") if body.schema_name else None
    )
    table_name = (
        validate_identifier(body.table_name, what="table name") if body.table_name else None
    )
    prefix = _safe_file_prefix(body.filename, suffix) if body.filename else None
    if body.table_name and body.schema_names and len(body.schema_names) > 1:
        raise HTTPException(status_code=400, detail="A table backup needs exactly one schema.")
    require_confirm(body, "backup.create")
    target_directory = _target_directory(body.directory, settings)
    pg_dump = _require_binary("pg_dump")
    with mapped_errors(settings):
        client.ping()
        env, host, port, default_db, username = _dump_env(client)
    database = _safe_database_name(body.database or default_db)
    # Checked against the catalog, so any real schema name works and nothing else does.
    selected = sorted(set(body.schema_names or []))
    if selected:
        with mapped_errors(settings):
            known = {row["name"] for row in _list_schemas(client, database)}
        missing = [name for name in selected if name not in known]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Schemas not found in '{database}': {', '.join(missing)}.",
            )
        unselected = known - set(selected)
        for name in selected:
            if collisions := _pattern_collisions(name, unselected):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Schema '{name}' cannot be told apart from '{collisions[0]}' "
                        "on this server; select both or rename one."
                    ),
                )
    job_id = uuid.uuid4().hex[:12]
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    filename = f"{prefix}-{job_id}.{suffix}" if prefix else f"{database}-{stamp}-{job_id}.{suffix}"
    directory = _backup_dir(settings)
    registry = _jobs(request)
    secrets = [env.get("PGPASSWORD", "")]
    job = BackupJob(
        id=job_id,
        kind="backup",
        status="running",
        database=database,
        file=filename,
        started_at=_utc_now(),
        profile=client.settings.active_profile,
        directory=str(target_directory),
        schemas=selected or ([schema_name] if schema_name else []),
    )
    _claim(job_id)
    registry[job_id] = job
    _write_sidecar(directory, job)
    audit("backup.create", database, RiskLevel.MAINTENANCE, settings)

    def _run() -> None:
        target = target_directory / filename
        cmd = [
            pg_dump,
            "-w",
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
        ]
        if body.schema_only:
            cmd.append("--schema-only")
        if body.data_only:
            cmd.append("--data-only")
        if body.compression is not None:
            cmd.append(f"--compress={body.compression}")
        owner = selected[0] if selected else schema_name
        if table_name:
            qualified = f'{_quote_pattern(owner)}."{table_name}"' if owner else f'"{table_name}"'
            cmd.append(f"--table={qualified}")
        elif selected:
            cmd.extend(f"--schema={_quote_pattern(name)}" for name in selected)
        elif schema_name:
            cmd.append(f'--schema="{schema_name}"')
        cmd.append(database)
        try:
            _run_tool(job_id, cmd, env)
            done = job.model_copy(
                update={
                    "status": "done",
                    "finished_at": _utc_now(),
                    "size_bytes": _path_size(target),
                }
            )
        except _JobCancelled:
            _remove_partial(target)
            done = job.model_copy(
                update={
                    "status": "cancelled",
                    "finished_at": _utc_now(),
                    "error": _CANCELLED_ERROR,
                }
            )
        except Exception as exc:  # noqa: BLE001 — job result must capture everything
            _remove_partial(target)
            done = job.model_copy(
                update={
                    "status": "failed",
                    "finished_at": _utc_now(),
                    "error": _failure_message("pg_dump", exc, secrets),
                }
            )
        registry[job_id] = done
        _write_sidecar(directory, done)

    _start_worker(job_id, "backup", _run)
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
    _safe_database_name(body.database)
    require_confirm(body, "backup.restore", target=body.database)
    directory = _backup_dir(settings)
    registry = _jobs(request)
    job = _load_job(directory, registry, body.backup_id)
    if job is None or not job.file or job.kind != "backup":
        raise HTTPException(status_code=404, detail=f"Backup '{body.backup_id}' not found.")
    if job.status != "done":
        # A failed or running pg_dump leaves a partial file at best.
        raise HTTPException(
            status_code=409, detail=f"Backup '{body.backup_id}' did not finish successfully."
        )
    current_profile = client.settings.active_profile
    # Sidecars from before profiles were recorded have none, so nothing to compare.
    if job.profile and job.profile != current_profile:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Backup '{body.backup_id}' belongs to profile '{job.profile}'; "
                f"refusing to restore it into '{current_profile or 'the default server'}'."
            ),
        )
    source = _job_path(job, directory)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Backup file no longer on disk.")
    is_plain = source.is_file() and source.suffix.lower() == ".sql"
    if is_plain and body.clean:
        raise HTTPException(
            status_code=400,
            detail="clean needs a custom or directory backup; plain SQL cannot be cleaned first.",
        )
    with mapped_errors(settings):
        client.ping()
        env, host, port, _, username = _dump_env(client)
    tool = "psql" if is_plain else "pg_restore"
    binary = _require_binary(tool)
    secrets = [env.get("PGPASSWORD", "")]
    job_id = uuid.uuid4().hex[:12]
    restore_job = BackupJob(
        id=job_id,
        kind="restore",
        status="running",
        database=body.database,
        file=job.file,
        started_at=_utc_now(),
        profile=current_profile,
        directory=job.directory,
        schemas=job.schemas,
    )
    _claim(job_id)
    registry[job_id] = restore_job
    _write_sidecar(directory, restore_job)
    audit("backup.restore", body.database, RiskLevel.DANGEROUS, settings)

    def _run() -> None:
        if is_plain:
            # Without ON_ERROR_STOP psql exits 0 even when statements fail.
            cmd = [
                binary,
                "-w",
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
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
            # pg_restore detects custom and directory archives from the path.
            cmd = [binary, "-w", "-h", host, "-p", port, "-U", username, "-d", body.database]
            if body.clean:
                cmd.append("--clean")
            cmd.append(str(source))
        try:
            _run_tool(job_id, cmd, env)
            done = restore_job.model_copy(update={"status": "done", "finished_at": _utc_now()})
        except _JobCancelled:
            done = restore_job.model_copy(
                update={
                    "status": "cancelled",
                    "finished_at": _utc_now(),
                    "error": _CANCELLED_ERROR,
                }
            )
        except Exception as exc:  # noqa: BLE001 — job result must capture everything
            done = restore_job.model_copy(
                update={
                    "status": "failed",
                    "finished_at": _utc_now(),
                    "error": _failure_message(tool, exc, secrets),
                }
            )
        registry[job_id] = done
        _write_sidecar(directory, done)

    _start_worker(job_id, "restore", _run)
    return restore_job
