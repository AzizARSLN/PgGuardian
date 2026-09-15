"""Snapshot collection: aggregate tracking metrics from live diagnostics."""

from __future__ import annotations

from datetime import datetime

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.diagnostics.health import collect_health, short_version
from pgguardian.models.health import HealthCheck
from pgguardian.snapshots.store import Snapshot
from pgguardian.utils.formatting import to_float, to_int


def _check_value(checks: list[HealthCheck], name: str) -> str | None:
    for check in checks:
        if check.name == name:
            return check.value
    return None


def take_snapshot(
    client: DbClient, profile: str | None = None, server: str | None = None
) -> Snapshot:
    """Collect aggregate metrics (bounded queries only) for tracking."""
    settings = client.settings
    report = collect_health(client)

    overview: dict = {}
    maint: dict = {}
    try:
        row = client.fetch_one(load_sql("health", "overview"))
        overview = dict(row) if row else {}
    except Exception:
        overview = {}
    try:
        row = client.fetch_one(load_sql("health", "maintenance_overview"))
        maint = dict(row) if row else {}
    except Exception:
        maint = {}

    cache_raw = overview.get("cache_hit_ratio_percent")
    cache = to_float(cache_raw)
    return Snapshot(
        taken_at=datetime.utcnow(),
        profile=profile or settings.active_profile,
        server=server,
        host=settings.host,
        port=settings.port,
        database=report.database,
        server_version=short_version(report.server_version),
        score=report.score,
        status=report.status,
        connections=to_int(overview.get("total_connections")),
        max_connections=to_int(overview.get("max_connections")),
        cache_hit=cache,
        db_size_bytes=to_int(overview.get("database_size_bytes")),
        dead_tuples=to_int(maint.get("total_dead_tuples")),
        live_tuples=to_int(maint.get("total_live_tuples")),
        long_queries=_count_from_value(_check_value(report.checks, "long_running_queries")),
        blocking_pairs=_count_from_value(_check_value(report.checks, "blocking_queries")),
        deadlocks=_count_from_value(_check_value(report.checks, "deadlocks")),
    )


def _count_from_value(value: str | None) -> int:
    if not value:
        return 0
    import re

    match = re.search(r"(\d+)", value.replace(",", ""))
    if not match:
        return 0
    try:
        return int(match.group(1))
    except ValueError:
        return 0
