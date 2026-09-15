"""Diagnose aggregation: roll every important problem into findings."""

from __future__ import annotations

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.diagnostics import connections as connections_diag
from pgguardian.diagnostics import health as health_diag
from pgguardian.diagnostics import indexes as indexes_diag
from pgguardian.diagnostics import locks as locks_diag
from pgguardian.diagnostics import maintenance as maintenance_diag
from pgguardian.diagnostics import queries as queries_diag
from pgguardian.models.diagnostic import DiagnosticFinding
from pgguardian.models.finding import Severity
from pgguardian.utils import formatting as fmt


def _finding(
    code: str,
    severity: Severity,
    title: str,
    description: str,
    value: str | None = None,
    recommendation: str | None = None,
) -> DiagnosticFinding:
    return DiagnosticFinding(
        code=code,
        severity=severity,
        title=title,
        description=description,
        value=value,
        recommendation=recommendation,
    )


def _unavailable(area: str) -> DiagnosticFinding:
    return _finding(
        code=f"{area.upper()}_CHECK_UNAVAILABLE",
        severity=Severity.UNKNOWN,
        title=f"{area} check unavailable",
        description=f"The {area} diagnostic query failed or is unsupported on this server.",
        recommendation="Verify permissions and PostgreSQL version compatibility, then retry.",
    )


def collect_findings(client: DbClient) -> list[DiagnosticFinding]:
    """Aggregate findings across all diagnostic areas.

    Each area is isolated: a failure produces an UNKNOWN finding for that
    area while the remaining areas still run.
    """
    settings: PgGuardianSettings = client.settings
    findings: list[DiagnosticFinding] = []

    # --- health-derived findings -------------------------------------------------
    try:
        report = health_diag.collect_health(client)
        by_name = {check.name: check for check in report.checks}
        long_check = by_name.get("long_running_queries")
        if long_check and long_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "LONG_RUNNING_QUERY",
                    long_check.severity,
                    "Long-running queries detected",
                    f"{long_check.value or 'Some queries'}. {long_check.description}",
                    value=long_check.value,
                    recommendation="Review the query execution plan and transaction scope.",
                )
            )
        blocking_check = by_name.get("blocking_queries")
        if blocking_check and blocking_check.severity == Severity.CRITICAL:
            findings.append(
                _finding(
                    "BLOCKING_QUERY",
                    Severity.CRITICAL,
                    "Blocking queries detected",
                    f"{blocking_check.value or 'Some backends'} are blocked by locks.",
                    value=blocking_check.value,
                    recommendation="Identify the blocking session and resolve the contention; "
                    "PgGuardian never terminates backends automatically.",
                )
            )
        usage_check = by_name.get("connection_usage")
        if usage_check and usage_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "HIGH_CONNECTION_USAGE",
                    usage_check.severity,
                    "High connection usage",
                    f"Connection usage is {usage_check.value}.",
                    value=usage_check.value,
                    recommendation="Add connection pooling (e.g. PgBouncer) or raise max_connections carefully.",
                )
            )
        cache_check = by_name.get("cache_hit_ratio")
        if cache_check and cache_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "LOW_CACHE_HIT_RATIO",
                    cache_check.severity,
                    "Low cache hit ratio",
                    f"Cache hit ratio is {cache_check.value or 'below threshold'}.",
                    value=cache_check.value,
                    recommendation="Investigate I/O-heavy queries and consider shared_buffers / caching strategy.",
                )
            )
        idle_check = by_name.get("idle_in_transaction")
        if idle_check and idle_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "IDLE_IN_TRANSACTION",
                    idle_check.severity,
                    "Idle-in-transaction backends",
                    f"{idle_check.value} backend(s) hold transactions open while idle.",
                    value=idle_check.value,
                    recommendation="Fix transaction scope in the application; consider idle_in_transaction_session_timeout.",
                )
            )
        dead_check = by_name.get("dead_tuples")
        if dead_check and dead_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "HIGH_DEAD_TUPLES",
                    dead_check.severity,
                    "High dead-tuple ratio",
                    f"Dead-tuple ratio is {dead_check.value or 'above threshold'}. {dead_check.description}",
                    value=dead_check.value,
                    recommendation="Run VACUUM (never VACUUM FULL without planning) and verify autovacuum keeps up.",
                )
            )
        age_check = by_name.get("transaction_age")
        if age_check and age_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "HIGH_TRANSACTION_AGE",
                    age_check.severity,
                    "Old open transaction",
                    f"Oldest open transaction is {age_check.value}.",
                    value=age_check.value,
                    recommendation="Find and shorten the long-lived transaction; it blocks VACUUM and bloats tables.",
                )
            )
        repl_check = by_name.get("replication_lag")
        if repl_check and repl_check.severity in (Severity.WARNING, Severity.CRITICAL):
            findings.append(
                _finding(
                    "REPLICATION_LAG",
                    repl_check.severity,
                    "Replication lag detected",
                    f"Worst replay lag is {repl_check.value}.",
                    value=repl_check.value,
                    recommendation="Check replica load, network and WAL sender/receiver state.",
                )
            )
        auto_check = by_name.get("autovacuum")
        if auto_check and auto_check.severity == Severity.WARNING:
            findings.append(
                _finding(
                    "AUTOVACUUM_DELAY",
                    Severity.WARNING,
                    "Autovacuum may be falling behind",
                    auto_check.description,
                    value=auto_check.value,
                    recommendation="Tune autovacuum thresholds/workers for write-heavy tables.",
                )
            )
    except Exception:
        findings.append(_unavailable("health"))

    # --- locks -------------------------------------------------------------------
    try:
        lock_report = locks_diag.collect_locks(client)
        if lock_report.locks:
            worst = max((lock.blocking_duration_seconds or 0) for lock in lock_report.locks)
            findings.append(
                _finding(
                    "BLOCKING_QUERY",
                    Severity.CRITICAL
                    if worst >= settings.long_query_critical_seconds
                    else Severity.WARNING,
                    "Blocking chain detected",
                    f"{len(lock_report.locks)} blocking pair(s). "
                    + (" Chains: " + "; ".join(lock_report.chains) if lock_report.chains else ""),
                    recommendation="Resolve the root blocker first; PgGuardian never terminates backends automatically.",
                )
            )
    except Exception:
        findings.append(_unavailable("locks"))

    # --- connections ---------------------------------------------------------------
    try:
        conn_report = connections_diag.collect_connections(client, limit=settings.default_limit)
        usage = conn_report.summary.usage_percent
        if usage >= settings.connection_usage_critical:
            findings.append(
                _finding(
                    "HIGH_CONNECTION_USAGE",
                    Severity.CRITICAL,
                    "Connection usage critical",
                    f"Usage is {usage}% ({conn_report.summary.current_connections}/"
                    f"{conn_report.summary.max_connections}).",
                    value=f"{usage}%",
                    recommendation="Add pooling immediately or raise max_connections.",
                )
            )
        if conn_report.summary.idle_in_transaction >= 10:
            findings.append(
                _finding(
                    "IDLE_IN_TRANSACTION",
                    Severity.WARNING,
                    "Many idle-in-transaction backends",
                    f"{conn_report.summary.idle_in_transaction} backends idle in transaction.",
                    recommendation="Fix transaction scope in the application.",
                )
            )
    except Exception:
        findings.append(_unavailable("connections"))

    # --- long-running queries (detail) -----------------------------------------------
    try:
        long_report = queries_diag.collect_long_running_queries(
            client, min_seconds=settings.long_query_critical_seconds, limit=settings.default_limit
        )
        for query in long_report.queries:
            findings.append(
                _finding(
                    "LONG_RUNNING_QUERY",
                    Severity.CRITICAL,
                    f"Query running for {fmt.format_duration(query.duration_seconds)}",
                    f"PID {query.pid} ({query.user}@{query.database}) in state {query.state}.",
                    value=fmt.format_duration(query.duration_seconds),
                    recommendation="Review the query execution plan and transaction scope.",
                )
            )
            if len([f for f in findings if f.code == "LONG_RUNNING_QUERY"]) >= 10:
                break
    except Exception:
        findings.append(_unavailable("queries"))

    # --- maintenance ------------------------------------------------------------------
    try:
        maint_report = maintenance_diag.collect_maintenance(client, limit=settings.default_limit)
        for table in maint_report.tables:
            if table.status == Severity.CRITICAL:
                findings.append(
                    _finding(
                        "HIGH_DEAD_TUPLES",
                        Severity.CRITICAL,
                        f"High dead tuples in {table.table_name}",
                        f"{fmt.format_percent(table.dead_tuple_percent)} dead "
                        f"({fmt.format_count(table.dead_tuples)} tuples).",
                        value=fmt.format_percent(table.dead_tuple_percent),
                        recommendation="Run VACUUM and verify autovacuum keeps up.",
                    )
                )
                if len([f for f in findings if f.code == "HIGH_DEAD_TUPLES"]) >= 10:
                    break
        if maint_report.summary.autovacuum_workers == 0 and (
            maint_report.summary.tables_never_vacuumed > 0
            or maint_report.summary.dead_tuple_percent >= settings.dead_tuple_warning_percent
        ):
            findings.append(
                _finding(
                    "AUTOVACUUM_DELAY",
                    Severity.WARNING,
                    "Autovacuum delay suspected",
                    f"{maint_report.summary.tables_never_vacuumed} table(s) never vacuumed "
                    "and no autovacuum worker is active.",
                    recommendation="Tune autovacuum thresholds/workers for write-heavy tables.",
                )
            )
    except Exception:
        findings.append(_unavailable("maintenance"))

    # --- indexes -------------------------------------------------------------------------
    try:
        index_report = indexes_diag.collect_indexes(client, limit=settings.default_limit)
        for index in index_report.potentially_unused[:10]:
            findings.append(
                _finding(
                    "POTENTIALLY_UNUSED_INDEX",
                    Severity.INFO,
                    f"Potentially unused index {index.index_name}",
                    f"Only {index.index_scans} scans on {index.table_name} "
                    f"({fmt.format_bytes(index.index_size_bytes)}). Statistics may have been reset; "
                    "verify against a representative workload before acting.",
                    recommendation="Confirm low usage across a full workload cycle before dropping.",
                )
            )
    except Exception:
        findings.append(_unavailable("indexes"))

    # Deduplicate identical codes severities keep first occurrence order stable.
    deduped: list[DiagnosticFinding] = []
    seen: set[tuple[str, str, str]] = set()
    for finding in findings:
        key = (finding.code, finding.title, finding.value or "")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(finding)
    return deduped
