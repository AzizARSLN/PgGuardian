"""Health diagnostics.

Every check is independent: if one query fails (missing permissions,
unsupported version, timeout), that check reports ``UNKNOWN`` while the
remaining checks continue normally.
"""

from __future__ import annotations

import re

from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.finding import Severity
from pgguardian.models.health import HealthCheck, HealthReport
from pgguardian.scoring.health_score import HealthScoreCalculator
from pgguardian.utils import formatting as fmt
from pgguardian.utils.security import sanitize_error


def evaluate_threshold(
    value: float | int | None,
    *,
    warning: float,
    critical: float,
    higher_is_worse: bool = True,
) -> Severity:
    """Map a numeric value to a severity; ``None``/unparseable → UNKNOWN."""
    if value is None:
        return Severity.UNKNOWN
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return Severity.UNKNOWN
    if higher_is_worse:
        if numeric >= critical:
            return Severity.CRITICAL
        if numeric >= warning:
            return Severity.WARNING
        return Severity.OK
    if numeric <= critical:
        return Severity.CRITICAL
    if numeric <= warning:
        return Severity.WARNING
    return Severity.OK


def short_version(server_version: str) -> str:
    """Extract ``16.10`` from ``PostgreSQL 16.10 on x86_64-...``."""
    match = re.search(r"PostgreSQL\s+([\d.]+)", server_version or "")
    return match.group(1) if match else "unknown"


def _check(
    name: str,
    severity: Severity,
    value: str | None,
    threshold: str | None,
    description: str,
) -> HealthCheck:
    return HealthCheck(
        name=name,
        status=severity,
        value=value,
        threshold=threshold,
        severity=severity,
        description=description,
    )


def _unknown(name: str, description: str) -> HealthCheck:
    return _check(name, Severity.UNKNOWN, None, None, description)


def build_overview_checks(overview: dict, settings: PgGuardianSettings) -> list[HealthCheck]:
    """Pure check builder over the ``health/overview`` row (fully unit-testable)."""
    checks: list[HealthCheck] = []
    version = str(overview.get("server_version") or "")
    checks.append(
        _check(
            "postgresql_version",
            Severity.INFO,
            short_version(version),
            None,
            f"Server version string: {version.split(',')[0][:80] if version else 'unknown'}.",
        )
    )
    uptime = overview.get("uptime_seconds")
    checks.append(
        _check(
            "server_uptime",
            Severity.INFO,
            fmt.format_duration(uptime) if uptime is not None else "n/a",
            None,
            "Time since postmaster start.",
        )
    )
    checks.append(
        _check(
            "database_size",
            Severity.INFO,
            fmt.format_bytes(overview.get("database_size_bytes")),
            None,
            f"Size of database {overview.get('database_name') or 'current'}.",
        )
    )

    max_conn = overview.get("max_connections") or 0
    total_conn = overview.get("total_connections") or 0
    usage = (total_conn / max_conn * 100) if max_conn else None
    severity = evaluate_threshold(
        usage,
        warning=settings.connection_usage_warning,
        critical=settings.connection_usage_critical,
    )
    checks.append(
        _check(
            "connection_usage",
            severity,
            f"{total_conn} / {max_conn}" if max_conn else f"{total_conn} / n/a",
            f"warn>={settings.connection_usage_warning}% critical>={settings.connection_usage_critical}%",
            "Share of max_connections currently in use.",
        )
    )

    idle_txn = overview.get("idle_in_transaction") or 0
    idle_sev = (
        Severity.OK
        if idle_txn == 0
        else (
            Severity.CRITICAL
            if idle_txn >= 25
            else Severity.WARNING
            if idle_txn >= 10
            else Severity.INFO
        )
    )
    checks.append(
        _check(
            "idle_in_transaction",
            idle_sev,
            str(int(idle_txn)),
            "warn>=10 critical>=25",
            "Backends holding open transactions while idle; they block VACUUM.",
        )
    )

    cache = overview.get("cache_hit_ratio_percent")
    cache_sev = evaluate_threshold(
        cache,
        warning=settings.cache_hit_warning,
        critical=settings.cache_hit_critical,
        higher_is_worse=False,
    )
    checks.append(
        _check(
            "cache_hit_ratio",
            cache_sev,
            fmt.format_percent(cache) if cache is not None else "n/a",
            f"warn<={settings.cache_hit_warning}% critical<={settings.cache_hit_critical}%",
            "Share of block reads served from shared buffers / OS cache.",
        )
    )

    commits = overview.get("xact_commit") or 0
    rollbacks = overview.get("xact_rollback") or 0
    total_xact = commits + rollbacks
    rollback_pct = (rollbacks / total_xact * 100) if total_xact else 0.0
    rb_sev = evaluate_threshold(rollback_pct, warning=5.0, critical=20.0)
    checks.append(
        _check(
            "rollback_ratio",
            rb_sev,
            fmt.format_percent(rollback_pct),
            "warn>=5% critical>=20%",
            f"{fmt.format_count(commits)} commits vs {fmt.format_count(rollbacks)} rollbacks.",
        )
    )

    deadlocks = overview.get("deadlocks") or 0
    checks.append(
        _check(
            "deadlocks",
            Severity.OK if deadlocks == 0 else Severity.WARNING,
            fmt.format_count(deadlocks),
            None,
            "Cumulative deadlocks since stats reset; any occurrence deserves review.",
        )
    )

    temp_files = overview.get("temp_files") or 0
    temp_bytes = overview.get("temp_bytes") or 0
    temp_sev = Severity.OK
    if temp_files and temp_files > 0:
        temp_sev = Severity.WARNING if (temp_bytes or 0) > 100 * 1024 * 1024 else Severity.INFO
    checks.append(
        _check(
            "temp_files",
            temp_sev,
            f"{fmt.format_count(temp_files)} ({fmt.format_bytes(temp_bytes)})",
            None,
            "Temp files indicate sorts/hashes spilling to disk (work_mem pressure).",
        )
    )
    return checks


def _safe_fetch(
    client: DbClient, area: str, name: str, params: tuple[object, ...] = ()
) -> list[dict] | None:
    try:
        sql = load_sql(area, name)
        return client.fetch_all(sql, params or None)
    except Exception:
        return None


def collect_health(client: DbClient) -> HealthReport:
    """Run all health checks; individual failures degrade to UNKNOWN."""
    settings = client.settings
    checks: list[HealthCheck] = []
    overview: dict = {}
    database = "unknown"
    server_version = "unknown"

    rows = _safe_fetch(client, "health", "overview")
    if rows:
        overview = dict(rows[0])
        database = str(overview.get("database_name") or database)
        server_version = str(overview.get("server_version") or server_version)
        try:
            checks.extend(build_overview_checks(overview, settings))
        except Exception as exc:
            checks.append(
                _unknown("overview", f"Could not evaluate overview: {sanitize_error(exc)}")
            )
    else:
        checks.append(_unknown("overview", "Overview query failed or returned no rows."))

    # Long-running queries.
    long_rows = _safe_fetch(
        client,
        "health",
        "long_running",
        (settings.long_query_warning_seconds, 100),
    )
    if long_rows is None:
        checks.append(_unknown("long_running_queries", "Long-running query check unavailable."))
    else:
        worst = 0.0
        for row in long_rows:
            try:
                worst = max(worst, float(row.get("duration_seconds") or 0))
            except (TypeError, ValueError):
                continue
        if not long_rows:
            sev = Severity.OK
        elif worst >= settings.long_query_critical_seconds:
            sev = Severity.CRITICAL
        else:
            sev = Severity.WARNING
        checks.append(
            _check(
                "long_running_queries",
                sev,
                f"{len(long_rows)} running > {settings.long_query_warning_seconds}s",
                f"warn>{settings.long_query_warning_seconds}s critical>{settings.long_query_critical_seconds}s",
                f"Longest running query: {fmt.format_duration(worst)}."
                if long_rows
                else "No long-running queries.",
            )
        )

    # Blocking queries.
    blocking_rows = _safe_fetch(client, "health", "blocking")
    if blocking_rows is None:
        checks.append(_unknown("blocking_queries", "Blocking-query check unavailable."))
    else:
        checks.append(
            _check(
                "blocking_queries",
                Severity.OK if not blocking_rows else Severity.CRITICAL,
                str(len(blocking_rows)),
                None,
                "Lock-blocked backends; any blocking pair is critical (no auto-terminate).",
            )
        )

    # Oldest transaction age.
    oldest = overview.get("oldest_transaction_seconds") if overview else None
    age_sev = evaluate_threshold(
        oldest,
        warning=settings.transaction_age_warning_seconds,
        critical=settings.transaction_age_critical_seconds,
    )
    checks.append(
        _check(
            "transaction_age",
            age_sev,
            fmt.format_duration(oldest) if oldest is not None else "n/a",
            f"warn>{settings.transaction_age_warning_seconds}s critical>{settings.transaction_age_critical_seconds}s",
            "Age of the oldest open transaction; old transactions block VACUUM.",
        )
    )

    # Replication.
    repl_rows = _safe_fetch(client, "health", "replication")
    if repl_rows is None:
        checks.append(
            _unknown("replication", "Replication check unavailable (permissions/version).")
        )
    elif not repl_rows:
        checks.append(
            _check(
                "replication", Severity.INFO, "no replicas", None, "No streaming replicas attached."
            )
        )
    else:
        worst_lag = 0
        for row in repl_rows:
            try:
                lag = row.get("replay_lag_bytes")
                worst_lag = max(worst_lag, int(lag) if lag is not None else 0)
            except (TypeError, ValueError):
                continue
        lag_sev = evaluate_threshold(
            float(worst_lag),
            warning=float(settings.replication_lag_warning_bytes),
            critical=float(settings.replication_lag_critical_bytes),
        )
        checks.append(
            _check(
                "replication_lag",
                lag_sev,
                fmt.format_bytes(worst_lag),
                f"warn>={fmt.format_bytes(settings.replication_lag_warning_bytes)}",
                f"{len(repl_rows)} replica(s); worst replay lag shown.",
            )
        )

    # Maintenance rollup: dead tuples + autovacuum.
    maint_rows = _safe_fetch(client, "health", "maintenance_overview")
    if maint_rows is None:
        checks.append(_unknown("maintenance", "Maintenance rollup unavailable."))
    else:
        maint = dict(maint_rows[0]) if maint_rows else {}
        live = maint.get("total_live_tuples") or 0
        dead = maint.get("total_dead_tuples") or 0
        total = (live or 0) + (dead or 0)
        dead_pct = (dead / total * 100) if total else 0.0
        dead_sev = evaluate_threshold(
            dead_pct,
            warning=settings.dead_tuple_warning_percent,
            critical=settings.dead_tuple_critical_percent,
        )
        checks.append(
            _check(
                "dead_tuples",
                dead_sev,
                fmt.format_percent(dead_pct),
                f"warn>={settings.dead_tuple_warning_percent}% critical>={settings.dead_tuple_critical_percent}%",
                f"{fmt.format_count(dead)} dead vs {fmt.format_count(live)} live tuples cluster-wide.",
            )
        )
        workers = maint.get("autovacuum_workers") or 0
        never_vac = maint.get("tables_never_vacuumed") or 0
        av_sev = Severity.OK
        av_desc = f"{workers} autovacuum worker(s) active."
        if workers == 0 and (
            dead_pct >= settings.dead_tuple_warning_percent or (never_vac or 0) > 0
        ):
            av_sev = Severity.WARNING
            av_desc = "No autovacuum worker active while dead tuples/tables need vacuuming."
        checks.append(_check("autovacuum", av_sev, str(int(workers)), None, av_desc))

    calculator = HealthScoreCalculator()
    score, status = calculator.calculate(checks)
    uptime = overview.get("uptime_seconds") if overview else None
    try:
        uptime_int = int(uptime) if uptime is not None else None
    except (TypeError, ValueError):
        uptime_int = None
    return HealthReport(
        server_version=server_version,
        database=database,
        uptime_seconds=uptime_int,
        checks=checks,
        score=score,
        status=status,
    )
