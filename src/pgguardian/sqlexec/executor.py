"""Expert SQL execution with guardrails for large databases.

- Read statements run in an explicit ``READ ONLY`` transaction.
- Results are capped client-side (``fetchmany``) so a huge table can never
  flood the CLI/API; ``truncated`` reports when the cap was hit.
- Writes run only when explicitly allowed + confirmed, inside a transaction
  that rolls back on any error.
"""

from __future__ import annotations

import re
import time
from contextlib import nullcontext
from typing import Any

from psycopg.rows import tuple_row
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.classifier import StatementKind, classify, ensure_allowed

# These refuse to run inside an explicit transaction block, or manage their
# own transactions internally (a ``DO``/``CALL`` body may COMMIT/ROLLBACK).
# Running them with autocommit (no wrapping BEGIN) is what the server expects;
# otherwise a COMMIT inside the body fails with "invalid transaction
# termination".
_NON_TRANSACTIONAL = re.compile(
    r"^\s*(VACUUM\b|CREATE\s+DATABASE\b|DROP\s+DATABASE\b|ALTER\s+SYSTEM\b"
    r"|CREATE\s+TABLESPACE\b|DROP\s+TABLESPACE\b"
    r"|REINDEX\b.*\bCONCURRENTLY\b|CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b"
    r"|DROP\s+INDEX\s+CONCURRENTLY\b|DO\b|CALL\b)",
    re.I | re.S,
)

DEFAULT_MAX_ROWS = 5000
HARD_MAX_ROWS = 5000


class SqlResult(BaseModel):
    """Bounded result of one executed statement."""

    model_config = ConfigDict(frozen=True)

    kind: StatementKind = StatementKind.READ
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    duration_ms: int = 0
    command: str = ""


def _coerce(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def run_sql(
    client: DbClient,
    sql: str,
    params: list[Any] | None = None,
    *,
    max_rows: int = DEFAULT_MAX_ROWS,
    allow_write: bool = False,
    allow_dangerous: bool = False,
) -> SqlResult:
    """Classify, authorize and run exactly one statement, bounded."""
    kind = classify(sql)
    ensure_allowed(kind, allow_write=allow_write, allow_dangerous=allow_dangerous)
    cap = max(1, min(max_rows, HARD_MAX_ROWS))
    started = time.perf_counter()
    bound = tuple(params) if params else None

    with client.connection() as conn:
        if kind == StatementKind.READ:
            with conn.transaction():
                with conn.cursor(row_factory=tuple_row) as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute(sql, bound)
                    columns = [desc[0] for desc in (cur.description or [])]
                    fetched = cur.fetchmany(cap + 1) if cur.description else []
            truncated = len(fetched) > cap
            rows = [[_coerce(v) for v in row] for row in fetched[:cap]]
            duration_ms = int((time.perf_counter() - started) * 1000)
            return SqlResult(
                kind=kind,
                columns=columns,
                rows=rows,
                row_count=len(rows),
                truncated=truncated,
                duration_ms=duration_ms,
                command="SELECT" if not columns else "SELECT",
            )
        scope = nullcontext() if _NON_TRANSACTIONAL.match(sql) else conn.transaction()
        with scope:
            with conn.cursor(row_factory=tuple_row) as cur:
                cur.execute(sql, bound)
                row_count = cur.rowcount if cur.rowcount and cur.rowcount >= 0 else 0
                command = (
                    (cur.statusmessage or "").split(" ")[0] if cur.statusmessage else kind.value
                )
                # RETURNING and friends produce rows on write statements too.
                columns = [desc[0] for desc in (cur.description or [])]
                fetched = cur.fetchmany(cap + 1) if cur.description else []
        duration_ms = int((time.perf_counter() - started) * 1000)
        return SqlResult(
            kind=kind,
            columns=columns,
            rows=[[_coerce(v) for v in row] for row in fetched[:cap]],
            row_count=row_count,
            truncated=len(fetched) > cap,
            duration_ms=duration_ms,
            command=command,
        )
