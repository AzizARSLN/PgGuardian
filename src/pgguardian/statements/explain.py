"""Plans for normalized statements ($1 placeholders) without running them.

Everything happens in a read-only transaction that is always rolled back.
PG16+ has EXPLAIN (GENERIC_PLAN); older servers go through PREPARE + EXECUTE,
which EXPLAIN plans but does not run.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from psycopg import errors as pgerrors
from psycopg.sql import SQL, Literal

from pgguardian.database.connection import DbClient
from pgguardian.sqlexec.classifier import (
    SqlRejectedError,
    StatementKind,
    classify,
    split_statements,
)
from pgguardian.utils.security import sanitize_error

EXPLAINABLE_HEADS = ("SELECT", "WITH", "VALUES", "TABLE")
_PREPARED = "pgg_advisor_plan"


@dataclass(frozen=True)
class PlanOutcome:
    """Plan JSON, or the reason there is none."""

    status: str
    plan: Any = None
    mode: str = "generic"
    reason: str | None = None
    message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "plan": self.plan,
            "mode": self.mode,
            "reason": self.reason,
            "message": self.message,
        }


def gate(query: str) -> tuple[str | None, str | None]:
    """Return (single statement, None) when it may be planned, else (None, reason)."""
    if not query or query.startswith("<insufficient"):
        return None, "no_text"
    try:
        statements = split_statements(query)
        if len(statements) != 1:
            return None, "not_single_statement"
        if classify(statements[0]) != StatementKind.READ:
            return None, "not_read"
    except SqlRejectedError:
        return None, "not_read"
    head = statements[0].lstrip("( \n\t").split(None, 1)[0].upper() if statements[0].strip() else ""
    if head not in EXPLAINABLE_HEADS:
        return None, "not_read"
    return statements[0], None


def explain(
    client: DbClient,
    query: str,
    *,
    version: int,
    params: list[str] | None = None,
    search_path: str | None = None,
    analyze: bool = False,
) -> PlanOutcome:
    """Plan one read statement. ``params`` switches to a custom plan with real values."""
    statement, reason = gate(query)
    mode = "custom" if params is not None or analyze else "generic"
    if statement is None:
        return PlanOutcome("not_explainable", mode=mode, reason=reason)
    try:
        with client.connection() as conn:
            conn.autocommit = False
            try:
                with conn.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute("SET LOCAL statement_timeout = '5s'")
                    cur.execute("SET LOCAL lock_timeout = '1s'")
                    if search_path:
                        cur.execute(
                            "SELECT set_config('search_path', %s, true)", (search_path,)
                        )
                    plan = _run(cur, statement, version, params, analyze)
            finally:
                conn.rollback()
                _deallocate(conn)
    except pgerrors.UndefinedTable as exc:
        return _failed("search_path", exc, mode)
    except pgerrors.IndeterminateDatatype as exc:
        return _failed("parameter_type", exc, mode)
    except pgerrors.InsufficientPrivilege as exc:
        return _failed("privilege", exc, mode)
    except pgerrors.LockNotAvailable as exc:
        return _failed("lock_timeout", exc, mode)
    except pgerrors.QueryCanceled as exc:
        return _failed("timeout", exc, mode)
    except pgerrors.Error as exc:
        return _failed("planner_error", exc, mode)
    return PlanOutcome("ok", plan=plan, mode=mode)


def _failed(reason: str, exc: Exception, mode: str) -> PlanOutcome:
    return PlanOutcome("failed", mode=mode, reason=reason, message=sanitize_error(exc))


def _first_value(row: Any) -> Any:
    return next(iter(row.values())) if isinstance(row, dict) else row[0]


def _run(
    cur: Any, statement: str, version: int, params: list[str] | None, analyze: bool
) -> Any:
    if params is None and not analyze and version >= 160000:
        cur.execute(f"EXPLAIN (GENERIC_PLAN, VERBOSE, SETTINGS, FORMAT JSON) {statement}")
        return _first_value(cur.fetchone())

    cache_mode = "force_generic_plan" if params is None else "force_custom_plan"
    cur.execute(f"SET LOCAL plan_cache_mode = {cache_mode}")
    cur.execute(f"PREPARE {_PREPARED} AS {statement}")
    cur.execute(
        "SELECT cardinality(parameter_types) AS n FROM pg_prepared_statements WHERE name = %s",
        (_PREPARED,),
    )
    count = int(_first_value(cur.fetchone()) or 0)
    values = list(params or [])
    if params is not None and len(values) != count:
        raise pgerrors.IndeterminateDatatype(f"Statement expects {count} parameter value(s).")
    arguments = [Literal(v) for v in values] if params is not None else [SQL("NULL")] * count
    options = "ANALYZE, BUFFERS, VERBOSE, FORMAT JSON" if analyze else "VERBOSE, SETTINGS, FORMAT JSON"
    execute = SQL("EXPLAIN ({}) EXECUTE {}").format(SQL(options), SQL(_PREPARED))
    if arguments:
        execute = SQL("{} ({})").format(execute, SQL(", ").join(arguments))
    cur.execute(execute)
    return _first_value(cur.fetchone())


def _deallocate(conn: Any) -> None:
    # PREPARE is not transactional; a pooled server connection would keep it.
    try:
        conn.autocommit = True
        with conn.cursor() as cur:

            cur.execute("DEALLOCATE ALL")
    except Exception:
        pass
