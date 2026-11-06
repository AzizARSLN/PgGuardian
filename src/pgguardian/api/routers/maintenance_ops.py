"""Maintenance action endpoints: vacuum/analyze/reindex/drop-index (guarded, expert use).

Long operations run without a statement timeout (they routinely exceed it
on large databases) but keep the connection timeout. VACUUM FULL, REINDEX
and DROP INDEX are DANGEROUS and need explicit opt-in + confirmation.

``DROP INDEX CONCURRENTLY`` may not run inside an explicit transaction block;
the shared connections are opened with ``autocommit=True``, which is exactly
what this statement requires.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors as pg_errors
from psycopg.sql import SQL, Identifier, Literal
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import (
    get_api_settings,
    mapped_errors,
    resolve_client,
    verify_token_OR_jwt,
)
from pgguardian.api.operation_log import logged_operation
from pgguardian.api.ops import (
    clear_op_cancel,
    op_application_name,
    op_cancel_requested,
    validate_op_id,
)
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
    validate_identifier,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics.sequences import INTEGER_LIMITS

router = APIRouter(prefix="/api/v1/maintenance", tags=["maintenance-ops"])

# VACUUM FULL takes an ACCESS EXCLUSIVE lock. A short per-attempt lock_timeout
# keeps it from queueing behind other work — a waiting exclusive request would
# freeze every later query on the table, which is exactly what we must avoid on
# a live system. A few bounded retries then let it slip into a quiet window.
VACUUM_LOCK_TIMEOUT_MS = 3000
VACUUM_LOCK_ATTEMPTS = 5
VACUUM_LOCK_RETRY_DELAY_S = 3.0

# Sessions holding any lock on the target table (an ACCESS EXCLUSIVE request
# conflicts with every other lock mode, so all of them are blockers).
_BLOCKERS_SQL = (
    "SELECT a.pid, a.usename, a.application_name, a.state,"
    " EXTRACT(EPOCH FROM (now() - a.query_start))::int AS age_seconds, a.query"
    " FROM pg_locks l"
    " JOIN pg_stat_activity a ON a.pid = l.pid"
    " WHERE l.locktype = 'relation' AND l.granted"
    "   AND l.relation = ("
    "       SELECT c.oid FROM pg_class c"
    "       JOIN pg_namespace n ON n.oid = c.relnamespace"
    "       WHERE n.nspname = %s AND c.relname = %s)"
    "   AND l.pid <> pg_backend_pid()"
    " ORDER BY a.query_start NULLS LAST"
)

_TERMINATE_SQL = (
    "SELECT pid, pg_terminate_backend(pid) AS terminated"
    " FROM pg_stat_activity"
    " WHERE pid = ANY(%s::int[]) AND pid <> pg_backend_pid()"
)


def _find_blockers(client: DbClient, schema_name: str, table_name: str) -> list[BlockerInfo]:
    """Sessions currently holding a lock on the target table (other than ours)."""
    rows = client.fetch_all(_BLOCKERS_SQL, (schema_name, table_name))
    blockers: list[BlockerInfo] = []
    for row in rows:
        age = row.get("age_seconds")
        blockers.append(
            BlockerInfo(
                pid=int(row["pid"]),
                username=row.get("usename"),
                application_name=row.get("application_name"),
                state=row.get("state"),
                age_seconds=int(age) if age is not None else None,
                query=row.get("query"),
            )
        )
    return blockers


def _terminate_blockers(client: DbClient, pids: list[int]) -> set[int]:
    """Terminate the given backends; best effort (returns the pids that died)."""
    if not pids:
        return set()
    try:
        rows = client.fetch_all(_TERMINATE_SQL, (pids,))
    except Exception:  # noqa: BLE001 — killing is best effort; the 409 path reports blockers
        return set()
    return {int(row["pid"]) for row in rows if row.get("terminated")}


def _blocker_label(blocker: BlockerInfo) -> str:
    """A one-line, human-readable description of a blocking session."""
    parts = [f"pid {blocker.pid}"]
    if blocker.username:
        parts.append(blocker.username)
    if blocker.application_name:
        parts.append(blocker.application_name)
    if blocker.state:
        parts.append(blocker.state)
    if blocker.age_seconds is not None:
        parts.append(f"{blocker.age_seconds}s")
    label = ", ".join(parts)
    if blocker.query:
        label += f": {blocker.query.strip()[:200]}"
    return label


class VacuumRequest(MutationRequest):
    """Run VACUUM (optionally FULL/ANALYZE) on a table or the whole database."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    analyze: bool = True
    full: bool = False
    freeze: bool = False


class AnalyzeRequest(MutationRequest):
    """Run ANALYZE on a table or the whole database."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None


class ReindexRequest(MutationRequest):
    """REINDEX an index or table (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str | None = None
    concurrently: bool = True


class DropIndexRequest(MutationRequest):
    """DROP INDEX CONCURRENTLY (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    index_name: str


class RaiseSequenceMaxValueRequest(MutationRequest):
    """Raise a sequence MAXVALUE to a multiple of its current ceiling (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    sequence_name: str
    multiplier: int = Field(default=10, ge=2, le=1_000_000)


class BlockerInfo(BaseModel):
    """A session whose lock kept the maintenance action from proceeding."""

    model_config = ConfigDict(frozen=True)

    pid: int
    username: str | None = None
    application_name: str | None = None
    state: str | None = None
    age_seconds: int | None = None
    query: str | None = None


class MaintenanceActionResult(BaseModel):
    """Outcome of a maintenance action."""

    model_config = ConfigDict(frozen=True)

    action: str
    target: str
    command_status: str
    # Sessions we had to terminate so the action could take its lock.
    terminated_blockers: list[BlockerInfo] = Field(default_factory=list)


def _table_target(schema: str | None, table: str | None) -> tuple[object | None, str]:
    if table and not schema:
        raise HTTPException(status_code=400, detail="table_name needs schema_name.")
    if schema and table:
        full: object = SQL("{}.{}").format(
            Identifier(validate_identifier(schema, what="schema name")),
            Identifier(validate_identifier(table, what="table name")),
        )
        return full, f"{schema}.{table}"
    if schema and not table:
        raise HTTPException(
            status_code=400,
            detail="Pass table_name for table scope, or neither for database scope.",
        )
    return None, "database"


def _untimed(
    client: DbClient, op_id: str | None = None, *, lock_timeout_ms: int | None = None
) -> DbClient:
    """A no-statement-timeout client; ``op_id`` tags the backend so it can be cancelled.

    ``lock_timeout_ms`` bounds how long a statement waits for a lock: a short
    value makes a lock-heavy statement fail fast (55P03) instead of queueing.
    """
    return client.clone(
        statement_timeout=False,
        application_name=op_application_name(op_id) if op_id else None,
        lock_timeout_ms=lock_timeout_ms,
    )


def _cancelled() -> HTTPException:
    """The operator stopped the operation; the client treats 499 as "stopped"."""
    return HTTPException(status_code=499, detail="Operation cancelled by operator.")


def _execute_untimed(client: DbClient, query: object, op_id: str | None) -> str:
    """Run a long statement on an untimed, op-tagged client.

    These clients disable ``statement_timeout``, so a ``QueryCanceled`` here can
    only come from an operator cancel (``pg_cancel_backend``, i.e. "Durdur").
    PostgreSQL rolls the statement back cleanly, so it is reported as a 499 and
    logged as "cancelled" rather than surfacing as a failure.
    """
    try:
        return _untimed(client, op_id).execute_raw(query)
    except pg_errors.QueryCanceled as exc:
        raise _cancelled() from exc


def _log_ctx(
    settings: ApiSettings,
    claims: dict[str, Any] | None,
    *,
    action: str,
    command: object,
    target: str,
    op_id: str | None,
):
    """Wrap an action so its outcome is written to pgGuardian's own log."""
    return logged_operation(
        settings,
        claims,
        action=action,
        command=command.as_string(),
        target=target,
        database=settings.database,
        profile=settings.active_profile,
        op_id=op_id,
    )


def _execute_lock_aware(
    client: DbClient,
    query: object,
    op_id: str | None,
    *,
    schema_name: str | None,
    table_name: str | None,
) -> tuple[str, list[BlockerInfo]]:
    """Run a lock-heavy statement, clearing lock blockers so our action proceeds.

    ``lock_timeout`` makes a blocked attempt fail fast instead of queueing, so
    the table is never frozen behind a waiting ACCESS EXCLUSIVE request. When the
    lock is held by other sessions we terminate them and retry, so a routine
    VACUUM FULL is not lost to a stray long-running query. Between attempts the
    wait is a ``pg_sleep`` on the same backend: it keeps the operation active in
    ``pg_stat_activity`` (visible and cancellable via ``pg_cancel_backend``) and
    lets the loop stop promptly on an operator cancel.
    """
    if op_id:
        clear_op_cancel(op_id)
    terminated: list[BlockerInfo] = []
    terminated_pids: set[int] = set()
    blockers: list[BlockerInfo] = []
    last_error: Exception | None = None
    for attempt in range(VACUUM_LOCK_ATTEMPTS):
        if op_id and op_cancel_requested(op_id):
            raise _cancelled()
        try:
            return client.execute_raw(query), terminated
        except pg_errors.QueryCanceled as exc:
            raise _cancelled() from exc
        except pg_errors.LockNotAvailable as exc:
            last_error = exc
            if schema_name and table_name:
                blockers = _find_blockers(client, schema_name, table_name)
            # Terminate whatever still holds the lock, then retry right away: the
            # killed backends release their locks as pg_terminate_backend returns.
            killable = [b.pid for b in blockers if b.pid not in terminated_pids]
            killed = _terminate_blockers(client, killable)
            for blocker in blockers:
                if blocker.pid in killed and blocker.pid not in terminated_pids:
                    terminated.append(blocker)
                    terminated_pids.add(blocker.pid)
            if attempt == VACUUM_LOCK_ATTEMPTS - 1:
                break
            if not killed:
                try:
                    client.fetch_one("SELECT pg_sleep(%s)", (VACUUM_LOCK_RETRY_DELAY_S,))
                except pg_errors.QueryCanceled as exc:
                    raise _cancelled() from exc
    raise HTTPException(status_code=409, detail=_lock_detail(blockers)) from last_error


def _lock_detail(blockers: list[BlockerInfo]) -> str:
    """Explain which sessions kept the lock and why the action gave up."""
    base = (
        "The table is locked by another session and VACUUM FULL needs an exclusive "
        f"lock. Tried {VACUUM_LOCK_ATTEMPTS} times without blocking other queries"
    )
    if not blockers:
        return base + "; run it again when the table is idle."
    listed = "; ".join(_blocker_label(blocker) for blocker in blockers[:5])
    more = f" (+{len(blockers) - 5} more)" if len(blockers) > 5 else ""
    return (
        f"{base}, and the blocking session(s) could not be terminated automatically: "
        f"{listed}{more}."
    )


@router.post("/vacuum", response_model=DryRunResult | MaintenanceActionResult)
def run_vacuum(
    body: VacuumRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> DryRunResult | MaintenanceActionResult:
    """VACUUM [FULL] [ANALYZE] — FULL is DANGEROUS."""
    tracked = validate_op_id(op_id) if op_id else None
    if body.full:
        ensure_dangerous_allowed(settings, "maintenance.vacuum")
        risk = RiskLevel.DANGEROUS
    else:
        ensure_writes_allowed(settings, "maintenance.vacuum")
        risk = RiskLevel.MAINTENANCE
    target_sql, target = _table_target(body.schema_name, body.table_name)
    options: list = []
    if body.full:
        options.append(SQL("FULL"))
    if body.freeze:
        options.append(SQL("FREEZE"))
    if body.analyze:
        options.append(SQL("ANALYZE"))
    head = SQL("VACUUM{}").format(
        SQL(" ({})").format(SQL(", ").join(options)) if options else SQL("")
    )
    query = SQL("{} {}").format(head, target_sql) if target_sql is not None else head
    if body.dry_run:
        return DryRunResult(
            action="maintenance.vacuum", risk=risk, sql=[query.as_string()], target=target
        )
    require_confirm(body, "maintenance.vacuum")
    terminated: list[BlockerInfo] = []
    with _log_ctx(
        settings, claims, action="maintenance.vacuum", command=query, target=target, op_id=tracked
    ):
        with mapped_errors(settings):
            client.ping()
            # VACUUM (no FULL) locks nothing conflicting, so it runs as-is; FULL is
            # lock-heavy and gets the short lock timeout + bounded retry.
            if body.full:
                lock_client = _untimed(
                    client, tracked, lock_timeout_ms=VACUUM_LOCK_TIMEOUT_MS
                )
                status, terminated = _execute_lock_aware(
                    lock_client,
                    query,
                    tracked,
                    schema_name=body.schema_name,
                    table_name=body.table_name,
                )
            else:
                status = _execute_untimed(client, query, tracked)
    audit("maintenance.vacuum", target, risk, settings)
    if terminated:
        audit(
            "maintenance.vacuum.terminate_blockers",
            f"{len(terminated)} session(s): "
            + "; ".join(_blocker_label(blocker) for blocker in terminated[:5]),
            risk,
            settings,
        )
    return MaintenanceActionResult(
        action="vacuum",
        target=target,
        command_status=status,
        terminated_blockers=terminated,
    )


@router.post("/analyze", response_model=DryRunResult | MaintenanceActionResult)
def run_analyze(
    body: AnalyzeRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> DryRunResult | MaintenanceActionResult:
    """ANALYZE a table or the whole database (MAINTENANCE)."""
    tracked = validate_op_id(op_id) if op_id else None
    ensure_writes_allowed(settings, "maintenance.analyze")
    target_sql, target = _table_target(body.schema_name, body.table_name)
    query = SQL("ANALYZE {}").format(target_sql) if target_sql is not None else SQL("ANALYZE")
    if body.dry_run:
        return DryRunResult(
            action="maintenance.analyze",
            risk=RiskLevel.MAINTENANCE,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "maintenance.analyze")
    with _log_ctx(
        settings, claims, action="maintenance.analyze", command=query, target=target, op_id=tracked
    ):
        with mapped_errors(settings):
            client.ping()
            status = _execute_untimed(client, query, tracked)
    audit("maintenance.analyze", target, RiskLevel.MAINTENANCE, settings)
    return MaintenanceActionResult(action="analyze", target=target, command_status=status)


@router.post("/reindex", response_model=DryRunResult | MaintenanceActionResult)
def run_reindex(
    body: ReindexRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> DryRunResult | MaintenanceActionResult:
    """REINDEX an index or table (DANGEROUS)."""
    tracked = validate_op_id(op_id) if op_id else None
    ensure_dangerous_allowed(settings, "maintenance.reindex")
    if body.index_name and body.table_name:
        raise HTTPException(
            status_code=400, detail="Pass either index_name or table_name, not both."
        )
    if body.index_name:
        if not body.schema_name:
            raise HTTPException(status_code=400, detail="index_name needs schema_name.")
        target_sql: object = SQL("{}.{}").format(
            Identifier(validate_identifier(body.schema_name, what="schema name")),
            Identifier(validate_identifier(body.index_name, what="index name")),
        )
        target = f"{body.schema_name}.{body.index_name}"
        head = SQL("REINDEX INDEX CONCURRENTLY") if body.concurrently else SQL("REINDEX INDEX")
    elif body.table_name:
        target_sql, target = _table_target(body.schema_name, body.table_name)
        head = SQL("REINDEX TABLE CONCURRENTLY") if body.concurrently else SQL("REINDEX TABLE")
    else:
        raise HTTPException(status_code=400, detail="Pass index_name or table_name.")
    query = SQL("{} {}").format(head, target_sql)
    if body.dry_run:
        return DryRunResult(
            action="maintenance.reindex",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "maintenance.reindex")
    with _log_ctx(
        settings, claims, action="maintenance.reindex", command=query, target=target, op_id=tracked
    ):
        with mapped_errors(settings):
            client.ping()
            status = _execute_untimed(client, query, tracked)
    audit("maintenance.reindex", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="reindex", target=target, command_status=status)


@router.post("/drop-index", response_model=DryRunResult | MaintenanceActionResult)
def run_drop_index(
    body: DropIndexRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> DryRunResult | MaintenanceActionResult:
    """DROP INDEX CONCURRENTLY — removes a redundant/unused index (DANGEROUS)."""
    tracked = validate_op_id(op_id) if op_id else None
    ensure_dangerous_allowed(settings, "maintenance.drop_index")
    index_name = validate_identifier(body.index_name, what="index name")
    if body.schema_name:
        target_sql: object = SQL("{}.{}").format(
            Identifier(validate_identifier(body.schema_name, what="schema name")),
            Identifier(index_name),
        )
        target = f"{body.schema_name}.{body.index_name}"
    else:
        target_sql = Identifier(index_name)
        target = body.index_name
    query = SQL("DROP INDEX CONCURRENTLY IF EXISTS {}").format(target_sql)
    if body.dry_run:
        return DryRunResult(
            action="maintenance.drop_index",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    # The typed confirmation is the bare index name; the audit target stays qualified.
    require_confirm(body, "maintenance.drop_index", body.index_name)
    with _log_ctx(
        settings,
        claims,
        action="maintenance.drop_index",
        command=query,
        target=target,
        op_id=tracked,
    ):
        with mapped_errors(settings):
            client.ping()
            status = _execute_untimed(client, query, tracked)
    audit("maintenance.drop_index", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="drop_index", target=target, command_status=status)


@router.post("/sequence-maxvalue", response_model=DryRunResult | MaintenanceActionResult)
def raise_sequence_max_value(
    body: RaiseSequenceMaxValueRequest,
    op_id: str | None = None,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> DryRunResult | MaintenanceActionResult:
    """ALTER SEQUENCE ... MAXVALUE — raises the ceiling before nextval starts failing.

    The new bound is ``current MAXVALUE x multiplier`` and never touches
    ``last_value``, so existing primary keys cannot collide. A raise beyond the
    sequence's own integer type is rejected: that case needs a wider column.
    """
    tracked = validate_op_id(op_id) if op_id else None
    ensure_dangerous_allowed(settings, "maintenance.sequence_maxvalue")
    schema_name = validate_identifier(body.schema_name, what="schema name")
    sequence_name = validate_identifier(body.sequence_name, what="sequence name")
    target = f"{schema_name}.{sequence_name}"
    with mapped_errors(settings):
        row = client.fetch_one(
            """
            SELECT data_type, increment_by, max_value
            FROM pg_sequences
            WHERE schemaname = %s AND sequencename = %s
            """,
            (schema_name, sequence_name),
        )
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"Sequence '{target}' was not found in this database."
        )
    if int(row.get("increment_by") or 1) < 0:
        raise HTTPException(
            status_code=400,
            detail=f"'{target}' counts downwards; raise its MINVALUE instead of MAXVALUE.",
        )
    data_type = str(row.get("data_type") or "bigint")
    ceiling = INTEGER_LIMITS.get(data_type, INTEGER_LIMITS["bigint"])
    current_max = int(row["max_value"]) if row.get("max_value") is not None else ceiling
    new_max = current_max * body.multiplier
    if new_max > ceiling:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{target}' is a {data_type} sequence capped at {ceiling}; "
                f"{body.multiplier}x would need {new_max}. Widen the owning column type instead."
            ),
        )
    query = SQL("ALTER SEQUENCE {}.{} MAXVALUE {}").format(
        Identifier(schema_name), Identifier(sequence_name), Literal(new_max)
    )
    if body.dry_run:
        return DryRunResult(
            action="maintenance.sequence_maxvalue",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    # The typed confirmation is the bare sequence name; the audit target stays qualified.
    require_confirm(body, "maintenance.sequence_maxvalue", sequence_name)
    with _log_ctx(
        settings,
        claims,
        action="maintenance.sequence_maxvalue",
        command=query,
        target=target,
        op_id=tracked,
    ):
        with mapped_errors(settings):
            client.ping()
            status = _execute_untimed(client, query, tracked)
    audit("maintenance.sequence_maxvalue", target, RiskLevel.DANGEROUS, settings)
    return MaintenanceActionResult(action="sequence_maxvalue", target=target, command_status=status)
