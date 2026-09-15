"""Lock and blocking diagnostics (read-only; never terminates backends)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.lock import LockInfo, LockReport, LockSummary, build_blocking_chains


def map_lock(row: dict) -> LockInfo:
    """Map a blocking-pair row to LockInfo (pure)."""
    duration = row.get("blocking_duration_seconds")
    try:
        duration_value = float(duration) if duration is not None else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        duration_value = None
    return LockInfo(
        blocking_pid=int(row.get("blocking_pid") or 0),
        blocked_pid=int(row.get("blocked_pid") or 0),
        blocking_user=str(row.get("blocking_user")) if row.get("blocking_user") else None,
        blocked_user=str(row.get("blocked_user")) if row.get("blocked_user") else None,
        database=str(row.get("database_name")) if row.get("database_name") else None,
        relation=str(row.get("relation")) if row.get("relation") else None,
        lock_type=str(row.get("lock_type")) if row.get("lock_type") else None,
        blocked_mode=str(row.get("blocked_mode")) if row.get("blocked_mode") else None,
        blocking_mode=str(row.get("blocking_mode")) if row.get("blocking_mode") else None,
        blocking_duration_seconds=duration_value,
        blocking_query=str(row.get("blocking_query")) if row.get("blocking_query") else None,
        blocked_query=str(row.get("blocked_query")) if row.get("blocked_query") else None,
    )


def collect_locks(client: DbClient, limit: int = 20) -> LockReport:
    """Blocking pairs, lock-mode summary and chains; degrades to empty on failure."""
    locks: list[LockInfo] = []
    try:
        rows = client.fetch_all(load_sql("locks", "blocking"))
        locks = [map_lock(dict(row)) for row in rows]
    except Exception:
        locks = []

    total = 0
    waiting = 0
    by_mode: dict[str, int] = {}
    try:
        rows = client.fetch_all(load_sql("locks", "summary"), (limit,))
        for row in rows:
            mode = str(row.get("mode") or "unknown")
            count = int(row.get("locks") or 0)
            total += count
            waiting += int(row.get("waiting") or 0)
            by_mode[mode] = by_mode.get(mode, 0) + count
    except Exception:
        pass

    summary = LockSummary(
        total_locks=total, waiting_locks=waiting, blocking_pairs=len(locks), by_mode=by_mode
    )
    chains = build_blocking_chains(locks)
    return LockReport(summary=summary, locks=locks, chains=chains)
