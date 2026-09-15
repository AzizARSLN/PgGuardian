"""Expert SQL execution with guardrails for large databases.

- Read statements run in an explicit ``READ ONLY`` transaction.
- Results are capped client-side (``fetchmany``) so a huge table can never
  flood the CLI/API; ``truncated`` reports when the cap was hit.
- Writes run only when explicitly allowed + confirmed, inside a transaction
  that rolls back on any error.
"""

from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from pgguardian.database.connection import DbClient, get_connection
from pgguardian.sqlexec.classifier import StatementKind, classify, ensure_allowed

DEFAULT_MAX_ROWS = 100
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
    settings = client.settings

    with get_connection(settings) as conn:
        if kind == StatementKind.READ:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute(sql, tuple(params or ()))
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
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(sql, tuple(params or ()))
                row_count = cur.rowcount if cur.rowcount and cur.rowcount >= 0 else 0
                command = (
                    (cur.statusmessage or "").split(" ")[0] if cur.statusmessage else kind.value
                )
        duration_ms = int((time.perf_counter() - started) * 1000)
        return SqlResult(
            kind=kind,
            columns=[],
            rows=[],
            row_count=row_count,
            truncated=False,
            duration_ms=duration_ms,
            command=command,
        )
