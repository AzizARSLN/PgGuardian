"""Index-monitor time series kept in a local SQLite database.

Only aggregate counters are stored — never query text or secrets — so trends
can be charted for large estates without a metrics server. The file sits next
to the snapshot store and can be relocated with
``PGGUARDIAN_INDEX_HISTORY_FILE``.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from pgguardian.models.index import IndexMonitorPoint, IndexMonitorReport

_SCHEMA = """
CREATE TABLE IF NOT EXISTS index_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at TEXT NOT NULL,
    profile TEXT,
    database TEXT NOT NULL,
    total_indexes INTEGER NOT NULL DEFAULT 0,
    total_size_bytes INTEGER NOT NULL DEFAULT 0,
    unused_count INTEGER NOT NULL DEFAULT 0,
    unused_size_bytes INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    duplicate_group_count INTEGER NOT NULL DEFAULT 0,
    redundant_count INTEGER NOT NULL DEFAULT 0,
    bloat_size_bytes INTEGER NOT NULL DEFAULT 0,
    missing_candidate_count INTEGER NOT NULL DEFAULT 0,
    low_cache_hit_count INTEGER NOT NULL DEFAULT 0,
    health_score INTEGER NOT NULL DEFAULT 100,
    critical_alerts INTEGER NOT NULL DEFAULT 0,
    warning_alerts INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_index_snapshots_lookup
    ON index_snapshots (profile, database, taken_at DESC);
"""

_FIELDS = (
    "total_indexes",
    "total_size_bytes",
    "unused_count",
    "unused_size_bytes",
    "invalid_count",
    "duplicate_group_count",
    "redundant_count",
    "bloat_size_bytes",
    "missing_candidate_count",
    "low_cache_hit_count",
    "health_score",
    "critical_alerts",
    "warning_alerts",
)


def default_index_history_path() -> Path:
    """History DB path, overridable via ``PGGUARDIAN_INDEX_HISTORY_FILE``."""
    custom = os.getenv("PGGUARDIAN_INDEX_HISTORY_FILE")
    if custom:
        return Path(custom).expanduser()
    return Path.home() / ".config" / "pgguardian" / "index_history.db"


def point_from_report(report: IndexMonitorReport, profile: str | None = None) -> IndexMonitorPoint:
    """Reduce a report to one time-series point (pure)."""
    summary = report.summary
    return IndexMonitorPoint(
        taken_at=report.taken_at,
        profile=profile,
        database=report.database,
        critical_alerts=sum(1 for a in report.alerts if a.level == "critical"),
        warning_alerts=sum(1 for a in report.alerts if a.level == "warning"),
        **{field: getattr(summary, field) for field in _FIELDS if hasattr(summary, field)},
    )


class IndexHistoryStore:
    """SQLite store for index-monitor aggregate points."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_index_history_path()

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.path))
        conn.executescript(_SCHEMA)
        return conn

    def save(self, point: IndexMonitorPoint, payload: dict | None = None) -> IndexMonitorPoint:
        """Persist one point; returns it with the assigned id."""
        data = point.model_dump(mode="json")
        data.pop("id", None)
        data["taken_at"] = point.taken_at.isoformat()
        data["payload_json"] = json.dumps(payload or {})
        columns = ", ".join(data.keys())
        placeholders = ", ".join("?" for _ in data)
        with self._connect() as conn:
            cur = conn.execute(
                f"INSERT INTO index_snapshots ({columns}) VALUES ({placeholders})",
                list(data.values()),
            )
            point_id = cur.lastrowid or 0
        return point.model_copy(update={"id": int(point_id)})

    def save_report(
        self, report: IndexMonitorReport, profile: str | None = None
    ) -> IndexMonitorPoint:
        """Store a point derived from a full report, keeping the summary payload."""
        point = point_from_report(report, profile=profile)
        payload = {"summary": report.summary.model_dump(mode="json")}
        return self.save(point, payload)

    def list(
        self,
        *,
        profile: str | None = None,
        database: str | None = None,
        limit: int = 100,
    ) -> list[IndexMonitorPoint]:
        """Newest-first points with optional profile/database filters."""
        query = f"SELECT id, taken_at, profile, database, {', '.join(_FIELDS)} FROM index_snapshots"
        clauses: list[str] = []
        params: list[object] = []
        if profile:
            clauses.append("profile = ?")
            params.append(profile)
        if database:
            clauses.append("database = ?")
            params.append(database)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY taken_at DESC LIMIT ?"
        params.append(max(1, min(limit, 5000)))
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_point(dict(row)) for row in rows]

    def prune(self, keep_days: int = 90) -> int:
        """Delete points older than ``keep_days``; returns rows removed."""
        cutoff = datetime.utcnow().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM index_snapshots WHERE taken_at < datetime(?, ?)",
                (cutoff, f"-{max(1, keep_days)} days"),
            )
            return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

    @staticmethod
    def _row_to_point(row: dict) -> IndexMonitorPoint:
        taken_at = row.get("taken_at")
        try:
            parsed = datetime.fromisoformat(str(taken_at)) if taken_at else datetime.utcnow()
        except ValueError:
            parsed = datetime.utcnow()
        payload = {
            field: int(row.get(field) or 0) for field in _FIELDS
        }
        return IndexMonitorPoint(
            id=int(row.get("id") or 0),
            taken_at=parsed,
            profile=row.get("profile"),
            database=str(row.get("database") or "postgres"),
            **payload,
        )
