"""Online table repack (``pg_repack``) endpoints.

``pg_repack`` rebuilds a bloated table without holding the long ACCESS
EXCLUSIVE lock that ``VACUUM FULL`` needs, so a live table keeps serving reads
and writes. It is a client tool (like ``pg_dump``) and cannot run over SQL, so
it runs as a background child process that a cancel request can terminate.

Missing prerequisites (the binary, the extension, or a primary key / unique
index on the table) are reported with a clear message instead of a silent
failure.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
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

router = APIRouter(prefix="/api/v1/maintenance/repack", tags=["maintenance-ops"])

_TOOL = "pg_repack"
_JOB_TIMEOUT_SECONDS = 6 * 3600
_OUTPUT_TAIL_CHARS = 4000
_CANCELLED_ERROR = "cancelled by operator."
_JOB_ID = re.compile(r"[\w-]{1,64}")

# The table must exist and be a plain/partitioned/materialized relation.
_TABLE_SQL = (
    "SELECT c.oid::int AS oid"
    " FROM pg_class c"
    " JOIN pg_namespace n ON n.oid = c.relnamespace"
    " WHERE n.nspname = %s AND c.relname = %s AND c.relkind IN ('r', 'm', 'p')"
)

# pg_repack needs a primary key or a unique index to match rows while it
# swaps the table; without one it refuses to run.
_KEY_SQL = (
    "SELECT EXISTS ("
    "  SELECT 1 FROM pg_index i"
    "  WHERE i.indrelid = %s::oid AND i.indisvalid"
    "    AND (i.indisprimary OR i.indisunique)"
    ") AS has_key"
)

_EXTENSION_SQL = (
    "SELECT default_version, installed_version"
    " FROM pg_available_extensions WHERE name = 'pg_repack'"
)


class RepackRequest(MutationRequest):
    """Repack one table online with pg_repack (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    table_name: str
    # Extra connections pg_repack opens to rebuild this table's indexes in
    # parallel (-j). 1 means the default, non-parallel rebuild.
    jobs: int = Field(default=1, ge=1, le=16)


class RepackJob(BaseModel):
    """State of a pg_repack background job."""

    model_config = ConfigDict(frozen=True)

    id: str
    status: str = "running"
    schema_name: str = ""
    table_name: str = ""
    # The pg_repack command line, for display; the password never appears here.
    command: str = ""
    pid: int | None = None
    started_at: str = ""
    finished_at: str | None = None
    error: str | None = None
    output: str | None = None


class RepackJobList(BaseModel):
    """All repack jobs known to this process, newest first."""

    model_config = ConfigDict(frozen=True)

    jobs: list[RepackJob] = Field(default_factory=list)


class _JobStore:
    """In-process registry of running/past repack jobs and their child processes."""

    def __init__(self) -> None:
        self.jobs: dict[str, RepackJob] = {}
        self.procs: dict[str, subprocess.Popen] = {}
        self.cancelled: set[str] = set()
        self.lock = threading.Lock()


class _JobCancelled(RuntimeError):
    """Raised inside a worker when the operator cancelled the job."""


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _store(request: Request) -> _JobStore:
    store = getattr(request.app.state, "repack_store", None)
    if store is None:
        store = _JobStore()
        request.app.state.repack_store = store
    return store


def _require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise HTTPException(
            status_code=501,
            detail=(
                f"'{name}' binary not found on the server. Install the pg_repack package "
                "(e.g. postgresql-<version>-repack) on the API host."
            ),
        )
    return path


def _tool_env(client: DbClient) -> tuple[dict[str, str], str, str, str, str]:
    """Environment + connection parameters for the pg_repack child process."""
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
    # The resolved password wins over any ambient PGPASSWORD set for another server.
    password = params.get("password") or settings.password
    if password:
        env["PGPASSWORD"] = str(password)
    if params.get("sslmode"):
        env["PGSSLMODE"] = str(params["sslmode"])
    env["PGAPPNAME"] = APPLICATION_NAME
    return env, host, port, database, username


def _update_job(store: _JobStore, job_id: str, **changes: object) -> RepackJob | None:
    with store.lock:
        job = store.jobs.get(job_id)
        if job is None:
            return None
        updated = job.model_copy(update=changes)
        store.jobs[job_id] = updated
        return updated


def _tail(text: str | None) -> str | None:
    if not text:
        return None
    return text.strip()[-_OUTPUT_TAIL_CHARS:]


def _failure_message(exc: Exception, secrets: list[str]) -> str:
    """Why a job failed: the tool's own output tail, without secrets."""
    raw = getattr(exc, "output", None) or getattr(exc, "stderr", None)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    tail = (raw or "").strip()[-_OUTPUT_TAIL_CHARS:]
    if isinstance(exc, subprocess.TimeoutExpired):
        headline = f"{_TOOL} timed out after {_JOB_TIMEOUT_SECONDS} seconds"
    elif isinstance(exc, subprocess.CalledProcessError):
        headline = f"{_TOOL} exited with code {exc.returncode}"
    else:
        return sanitize_error(exc, secrets)[:_OUTPUT_TAIL_CHARS]
    return sanitize_text(f"{headline}: {tail}" if tail else headline, secrets)


def _run_tool(job_id: str, cmd: list[str], env: dict[str, str], store: _JobStore) -> str:
    """Run pg_repack as a child process a cancel request can terminate.

    The handle is registered before waiting, so the cancel endpoint finds and
    stops it even while the tool is mid-run.
    """
    with store.lock:
        if job_id in store.cancelled:
            store.cancelled.discard(job_id)
            raise _JobCancelled()

    proc = subprocess.Popen(
        cmd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    with store.lock:
        store.procs[job_id] = proc
        job = store.jobs.get(job_id)
        if job is not None:
            store.jobs[job_id] = job.model_copy(update={"pid": proc.pid})
        # A cancel arriving between the check above and the registration now wins.
        cancelled = job_id in store.cancelled
    if cancelled:
        proc.terminate()
    try:
        output, _ = proc.communicate(timeout=_JOB_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise
    finally:
        with store.lock:
            store.procs.pop(job_id, None)
            was_cancelled = job_id in store.cancelled
            store.cancelled.discard(job_id)
    if was_cancelled:
        raise _JobCancelled()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, output=output)
    return output or ""


@router.post("", response_model=RepackJob)
def start_repack(
    body: RepackRequest,
    request: Request,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> RepackJob:
    """Rebuild one table online with pg_repack as a background job (DANGEROUS)."""
    ensure_dangerous_allowed(settings, "maintenance.repack")
    schema_name = validate_identifier(body.schema_name, what="schema name")
    table_name = validate_identifier(body.table_name, what="table name")
    target = f"{schema_name}.{table_name}"
    # Checked before anything else so a missing tool never looks like a bad table.
    binary = _require_binary(_TOOL)
    require_confirm(body, "maintenance.repack")
    with mapped_errors(settings):
        client.ping()
        table = client.fetch_one(_TABLE_SQL, (schema_name, table_name))
        if table is None:
            raise HTTPException(
                status_code=404, detail=f"Table '{target}' was not found in this database."
            )
        extension = client.fetch_one(_EXTENSION_SQL)
        if extension is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "The 'pg_repack' extension is not available on this server. Install the "
                    "pg_repack package for your PostgreSQL version, then run "
                    "CREATE EXTENSION pg_repack; in this database."
                ),
            )
        if extension.get("installed_version") is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"The 'pg_repack' extension is available ({extension.get('default_version')}) "
                    f"but not installed in database '{settings.database}'. "
                    "Run: CREATE EXTENSION pg_repack;"
                ),
            )
        key = client.fetch_one(_KEY_SQL, (int(table["oid"]),))
        if not (key or {}).get("has_key"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{target}' has no PRIMARY KEY or UNIQUE index, which pg_repack needs to "
                    "rebuild the table online. Add one, or use VACUUM FULL instead."
                ),
            )
        env, host, port, database, username = _tool_env(client)

    cmd = [
        binary,
        "-w",  # never prompt for a password; PGPASSWORD carries it
        "--no-superuser-check",
        "-h",
        host,
        "-p",
        port,
        "-U",
        username,
        "-d",
        database,
        "-t",
        target,
    ]
    # Only pass -j when parallelism is requested; pg_repack's own default is 0.
    if body.jobs > 1:
        cmd += ["-j", str(body.jobs)]
    secrets = [env.get("PGPASSWORD", "")]
    job_id = uuid.uuid4().hex[:12]
    job = RepackJob(
        id=job_id,
        status="running",
        schema_name=schema_name,
        table_name=table_name,
        command=" ".join(cmd),  # display only; the password travels in the environment
        started_at=_utc_now(),
    )
    store = _store(request)
    with store.lock:
        store.jobs[job_id] = job
    audit("maintenance.repack", target, RiskLevel.DANGEROUS, settings)

    def _run() -> None:
        try:
            output = _run_tool(job_id, cmd, env, store)
        except _JobCancelled:
            _update_job(
                store,
                job_id,
                status="cancelled",
                finished_at=_utc_now(),
                error=_CANCELLED_ERROR,
                pid=None,
            )
        except Exception as exc:  # noqa: BLE001 — the job must capture everything
            _update_job(
                store,
                job_id,
                status="failed",
                finished_at=_utc_now(),
                error=_failure_message(exc, secrets),
                pid=None,
            )
        else:
            _update_job(
                store,
                job_id,
                status="done",
                finished_at=_utc_now(),
                output=_tail(output),
                pid=None,
            )

    threading.Thread(target=_run, name=f"pgguardian-repack-{job_id}", daemon=True).start()
    return job


@router.get("", response_model=RepackJobList)
def list_repack_jobs(request: Request) -> RepackJobList:
    """Repack jobs known to this process (read-only)."""
    store = _store(request)
    with store.lock:
        jobs = list(store.jobs.values())
    return RepackJobList(jobs=sorted(jobs, key=lambda job: job.started_at, reverse=True))


@router.get("/{job_id}", response_model=RepackJob)
def get_repack_job(job_id: str, request: Request) -> RepackJob:
    """One repack job by id (404 when unknown)."""
    if not _JOB_ID.fullmatch(job_id):
        raise HTTPException(status_code=404, detail=f"Repack job '{job_id}' not found.")
    store = _store(request)
    with store.lock:
        job = store.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Repack job '{job_id}' not found.")
    return job


@router.post("/{job_id}/cancel", response_model=RepackJob)
def cancel_repack_job(
    job_id: str, request: Request, settings: ApiSettings = Depends(get_api_settings)
) -> RepackJob:
    """Stop a running pg_repack job (MAINTENANCE).

    The child process is terminated; pg_repack rolls its swap back, so the
    table keeps its original contents.
    """
    ensure_writes_allowed(settings, "maintenance.repack.cancel")
    if not _JOB_ID.fullmatch(job_id):
        raise HTTPException(status_code=404, detail=f"Repack job '{job_id}' not found.")
    store = _store(request)
    with store.lock:
        job = store.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Repack job '{job_id}' not found.")
        if job.status != "running":
            return job  # Already finished; nothing to stop.
        store.cancelled.add(job_id)
        proc = store.procs.get(job_id)
    if proc is not None and proc.poll() is None:
        proc.terminate()
    stopped = _update_job(
        store,
        job_id,
        status="cancelled",
        finished_at=_utc_now(),
        error=_CANCELLED_ERROR,
        pid=None,
    )
    audit(
        "maintenance.repack.cancel",
        f"{job.schema_name}.{job.table_name}",
        RiskLevel.MAINTENANCE,
        settings,
    )
    return stopped or job
