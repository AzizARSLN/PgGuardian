"""Local SQLite store for analysed reports, task progress and the activity log.

The uploaded HTML is not kept: only its hash and the masked data parsed out of it.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    filename TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_by TEXT,
    uploaded_at TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    parsed TEXT NOT NULL,
    analysis TEXT,
    analyzed_by TEXT,
    analyzed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_profile_sha ON reports (profile, sha256);
CREATE TABLE IF NOT EXISTS tasks (
    report_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (report_id, task_id)
);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL,
    profile TEXT NOT NULL,
    at TEXT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT
);
"""

_SUMMARY_COLUMNS = (
    "id, profile, filename, sha256, size_bytes, uploaded_by, uploaded_at, period_start, "
    "period_end, analyzed_by, analyzed_at"
)


def default_path() -> Path:
    custom = os.getenv("PGGUARDIAN_PGBADGER_FILE")
    if custom:
        return Path(custom).expanduser()
    return Path.home() / ".config" / "pgguardian" / "pgbadger.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class ReportStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def log(self, report_id: str, profile: str, actor: str | None, action: str, detail: str = "") -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO activity (report_id, profile, at, actor, action, detail)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (report_id, profile, _now(), actor, action, detail),
            )

    def find_by_hash(self, profile: str, sha256: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM reports WHERE profile = ? AND sha256 = ?", (profile, sha256)
            ).fetchone()
        return row["id"] if row else None

    def add(
        self,
        *,
        profile: str,
        filename: str,
        sha256: str,
        size_bytes: int,
        actor: str | None,
        parsed: dict[str, Any],
    ) -> str:
        report_id = uuid.uuid4().hex[:12]
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO reports (id, profile, filename, sha256, size_bytes, uploaded_by,"
                " uploaded_at, period_start, period_end, parsed)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    report_id,
                    profile,
                    filename,
                    sha256,
                    size_bytes,
                    actor,
                    _now(),
                    parsed.get("first_query"),
                    parsed.get("last_query"),
                    json.dumps(parsed, ensure_ascii=False),
                ),
            )
        self.log(report_id, profile, actor, "uploaded", filename)
        return report_id

    def list(self, profile: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT {_SUMMARY_COLUMNS} FROM reports WHERE profile = ? ORDER BY uploaded_at DESC",
                (profile,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get(self, report_id: str, profile: str) -> dict[str, Any] | None:
        """A report only exists within its own profile."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM reports WHERE id = ? AND profile = ?", (report_id, profile)
            ).fetchone()
        if row is None:
            return None
        report = dict(row)
        report["parsed"] = json.loads(report["parsed"])
        report["analysis"] = json.loads(report["analysis"]) if report["analysis"] else None
        return report

    def save_analysis(
        self, report_id: str, profile: str, actor: str | None, analysis: dict[str, Any]
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE reports SET analysis = ?, analyzed_by = ?, analyzed_at = ? WHERE id = ?",
                (json.dumps(analysis, ensure_ascii=False), actor, _now(), report_id),
            )
        self.log(report_id, profile, actor, "analyzed", f"{len(analysis['findings'])} findings")

    def task_states(self, report_id: str) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT task_id, status, updated_by, updated_at FROM tasks WHERE report_id = ?",
                (report_id,),
            ).fetchall()
        return {row["task_id"]: dict(row) for row in rows}

    def set_task(
        self, report_id: str, profile: str, task_id: str, status: str, actor: str | None
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO tasks (report_id, task_id, status, updated_by, updated_at)"
                " VALUES (?, ?, ?, ?, ?) ON CONFLICT (report_id, task_id) DO UPDATE SET"
                " status = excluded.status, updated_by = excluded.updated_by,"
                " updated_at = excluded.updated_at",
                (report_id, task_id, status, actor, _now()),
            )
        self.log(report_id, profile, actor, "task", f"{task_id} -> {status}")

    def activity(self, report_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT at, actor, action, detail FROM activity WHERE report_id = ? ORDER BY id DESC",
                (report_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def delete(self, report_id: str, profile: str, actor: str | None) -> bool:
        with self._connect() as conn:
            removed = conn.execute(
                "DELETE FROM reports WHERE id = ? AND profile = ?", (report_id, profile)
            ).rowcount
            conn.execute("DELETE FROM tasks WHERE report_id = ?", (report_id,))
        if removed:
            self.log(report_id, profile, actor, "deleted")
        return bool(removed)
