"""Point-in-time metric snapshots for tracking servers/databases over time.

Snapshots store aggregates only (never query text or secrets) in a local
SQLite database — stdlib only, no server needed. This is what powers
end-of-day server/database reports and trend views for large estates.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at TEXT NOT NULL,
    profile TEXT,
    server TEXT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    database TEXT NOT NULL,
    server_version TEXT NOT NULL DEFAULT 'unknown',
    score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'UNKNOWN',
    connections INTEGER NOT NULL DEFAULT 0,
    max_connections INTEGER NOT NULL DEFAULT 0,
    cache_hit REAL,
    db_size_bytes INTEGER NOT NULL DEFAULT 0,
    dead_tuples INTEGER NOT NULL DEFAULT 0,
    live_tuples INTEGER NOT NULL DEFAULT 0,
    long_queries INTEGER NOT NULL DEFAULT 0,
    blocking_pairs INTEGER NOT NULL DEFAULT 0,
    deadlocks INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
    ON snapshots (profile, database, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_server
    ON snapshots (server, taken_at DESC);
"""


class Snapshot(BaseModel):
    """One stored aggregate snapshot."""

    model_config = ConfigDict(frozen=True)

    id: int = 0
    taken_at: datetime = Field(default_factory=datetime.utcnow)
    profile: str | None = None
    server: str | None = None
    host: str = "localhost"
    port: int = 5432
    database: str = "postgres"
    server_version: str = "unknown"
    score: int = 0
    status: str = "UNKNOWN"
    connections: int = 0
    max_connections: int = 0
    cache_hit: float | None = None
    db_size_bytes: int = 0
    dead_tuples: int = 0
    live_tuples: int = 0
    long_queries: int = 0
    blocking_pairs: int = 0
    deadlocks: int = 0


def default_snapshots_path() -> Path:
    """Snapshot DB path, overridable via ``PGGUARDIAN_SNAPSHOTS_FILE``."""
    custom = os.getenv("PGGUARDIAN_SNAPSHOTS_FILE")
    if custom:
        return Path(custom).expanduser()
    return Path.home() / ".config" / "pgguardian" / "snapshots.db"


class SnapshotStore:
    """SQLite snapshot store (aggregates only)."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_snapshots_path()

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.path))
        conn.executescript(_SCHEMA)
        return conn

    def save(self, snapshot: Snapshot, payload: dict | None = None) -> Snapshot:
        """Persist a snapshot; returns it with the assigned id."""
        data = snapshot.model_dump(mode="json")
        data.pop("id", None)
        data["taken_at"] = snapshot.taken_at.isoformat()
        data["payload_json"] = json.dumps(payload or {})
        columns = ", ".join(data.keys())
        placeholders = ", ".join("?" for _ in data)
        with self._connect() as conn:
            cur = conn.execute(
                f"INSERT INTO snapshots ({columns}) VALUES ({placeholders})",
                list(data.values()),
            )
            snapshot_id = cur.lastrowid or 0
        return snapshot.model_copy(update={"id": int(snapshot_id)})

    def list(
        self,
        *,
        profile: str | None = None,
        server: str | None = None,
        database: str | None = None,
        limit: int = 50,
    ) -> list[Snapshot]:
        """Newest-first snapshots with optional server/database filters."""
        query = (
            "SELECT id, taken_at, profile, server, host, port, database, server_version,"
            " score, status, connections, max_connections, cache_hit, db_size_bytes,"
            " dead_tuples, live_tuples, long_queries, blocking_pairs, deadlocks"
            " FROM snapshots"
        )
        clauses: list[str] = []
        params: list[object] = []
        if profile:
            clauses.append("profile = ?")
            params.append(profile)
        if server:
            clauses.append("server = ?")
            params.append(server)
        if database:
            clauses.append("database = ?")
            params.append(database)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY taken_at DESC LIMIT ?"
        params.append(max(1, min(limit, 1000)))
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_snapshot(dict(row)) for row in rows]

    def latest(
        self, *, profile: str | None = None, server: str | None = None, database: str | None = None
    ) -> Snapshot | None:
        """Newest snapshot for a scope, if any."""
        items = self.list(profile=profile, server=server, database=database, limit=1)
        return items[0] if items else None

    def prune(self, keep_days: int = 90) -> int:
        """Delete snapshots older than ``keep_days``; returns rows removed."""
        cutoff = datetime.utcnow().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM snapshots WHERE taken_at < datetime(?, ?)",
                (cutoff, f"-{max(1, keep_days)} days"),
            )
            return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

    @staticmethod
    def _row_to_snapshot(row: dict) -> Snapshot:
        taken_at = row.get("taken_at")
        try:
            parsed = datetime.fromisoformat(str(taken_at)) if taken_at else datetime.utcnow()
        except ValueError:
            parsed = datetime.utcnow()
        return Snapshot(
            id=int(row.get("id") or 0),
            taken_at=parsed,
            profile=row.get("profile"),
            server=row.get("server"),
            host=str(row.get("host") or "localhost"),
            port=int(row.get("port") or 5432),
            database=str(row.get("database") or "postgres"),
            server_version=str(row.get("server_version") or "unknown"),
            score=int(row.get("score") or 0),
            status=str(row.get("status") or "UNKNOWN"),
            connections=int(row.get("connections") or 0),
            max_connections=int(row.get("max_connections") or 0),
            cache_hit=row.get("cache_hit"),
            db_size_bytes=int(row.get("db_size_bytes") or 0),
            dead_tuples=int(row.get("dead_tuples") or 0),
            live_tuples=int(row.get("live_tuples") or 0),
            long_queries=int(row.get("long_queries") or 0),
            blocking_pairs=int(row.get("blocking_pairs") or 0),
            deadlocks=int(row.get("deadlocks") or 0),
        )
