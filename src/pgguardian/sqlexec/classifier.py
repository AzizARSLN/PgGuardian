"""SQL statement classification for safe expert execution.

Read-only statements run freely; anything that writes or takes strong locks
requires explicit opt-in (``allow_writes`` / ``allow_dangerous`` + confirm).
Multi-statement strings are rejected — run one statement at a time so every
execution is classified precisely.
"""

from __future__ import annotations

import re
from enum import StrEnum

READ_KEYWORDS = frozenset({"SELECT", "WITH", "VALUES", "TABLE", "SHOW", "EXPLAIN"})
WRITE_KEYWORDS = frozenset(
    {
        "INSERT",
        "UPDATE",
        "DELETE",
        "MERGE",
        "COPY",
        "CREATE",
        "ALTER",
        "GRANT",
        "REVOKE",
        "COMMENT",
        "SECURITY",
        "VACUUM",
        "ANALYZE",
        "REINDEX",
        "CLUSTER",
        "REFRESH",
        "CALL",
        "DO",
        "LISTEN",
        "NOTIFY",
        "PREPARE",
        "EXECUTE",
        "DEALLOCATE",
        "SET",
        "RESET",
        "DISCARD",
    }
)
DANGEROUS_KEYWORDS = frozenset({"DROP", "TRUNCATE"})
TERMINATE_FUNCTIONS = frozenset({"pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf"})

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_FIRST_WORD = re.compile(r"^\(?\s*([A-Za-z]+)")
_LOCKING_CLAUSE = re.compile(
    r"\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b", re.IGNORECASE
)


class StatementKind(StrEnum):
    """Classification of a single SQL statement."""

    READ = "READ"
    NEEDS_WRITE = "NEEDS_WRITE"  # reads that lock rows (SELECT ... FOR UPDATE)
    WRITE = "WRITE"
    DANGEROUS = "DANGEROUS"
    EMPTY = "EMPTY"


class SqlRejectedError(ValueError):
    """Raised when a statement is not allowed to run in the current mode."""


def strip_comments(sql: str) -> str:
    """Remove ``--`` and ``/* */`` comments (string-literal aware)."""
    out: list[str] = []
    i = 0
    n = len(sql)
    in_single = False
    in_double = False
    in_dollar: str | None = None
    while i < n:
        if in_dollar is not None:
            if sql.startswith(in_dollar, i):
                out.append(in_dollar)
                i += len(in_dollar)
                in_dollar = None
            else:
                out.append(sql[i])
                i += 1
            continue
        ch = sql[i]
        if in_single:
            out.append(ch)
            if ch == "'":
                if sql.startswith("''", i):
                    out.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue
        if in_double:
            out.append(ch)
            if ch == '"':
                in_double = False
            i += 1
            continue
        if ch == "'":
            in_single = True
            out.append(ch)
            i += 1
            continue
        if ch == '"':
            in_double = True
            out.append(ch)
            i += 1
            continue
        if ch == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[i:])
            if match:
                in_dollar = match.group(0)
                out.append(in_dollar)
                i += len(in_dollar)
                continue
            out.append(ch)
            i += 1
            continue
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            i = n if end == -1 else end
            continue
        if sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def split_statements(sql: str) -> list[str]:
    """Split on semicolons outside strings/comments/dollar-quoting."""
    cleaned = strip_comments(sql)
    statements: list[str] = []
    current: list[str] = []
    i = 0
    n = len(cleaned)
    in_single = False
    in_double = False
    in_dollar: str | None = None
    while i < n:
        if in_dollar is not None:
            if cleaned.startswith(in_dollar, i):
                current.append(in_dollar)
                i += len(in_dollar)
                in_dollar = None
            else:
                current.append(cleaned[i])
                i += 1
            continue
        ch = cleaned[i]
        if in_single:
            current.append(ch)
            if ch == "'":
                if cleaned.startswith("''", i):
                    current.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue
        if in_double:
            current.append(ch)
            if ch == '"':
                in_double = False
            i += 1
            continue
        if ch == "'":
            in_single = True
            current.append(ch)
            i += 1
            continue
        if ch == '"':
            in_double = True
            current.append(ch)
            i += 1
            continue
        if ch == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", cleaned[i:])
            if match:
                in_dollar = match.group(0)
                current.append(in_dollar)
                i += len(in_dollar)
                continue
            current.append(ch)
            i += 1
            continue
        if ch == ";":
            text = "".join(current).strip()
            if text:
                statements.append(text)
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def classify(sql: str) -> StatementKind:
    """Classify exactly one statement; raises on empty/multi statements."""
    statements = split_statements(sql)
    if not statements:
        return StatementKind.EMPTY
    if len(statements) > 1:
        raise SqlRejectedError(
            f"Refusing to run {len(statements)} statements at once. Run one statement at a time."
        )
    text = statements[0]
    match = _FIRST_WORD.match(text.lstrip("("))
    if not match:
        raise SqlRejectedError("Could not understand the statement; refusing to run it.")
    first = match.group(1).upper()
    lowered = text.lower()
    if any(func in lowered for func in TERMINATE_FUNCTIONS):
        return StatementKind.DANGEROUS
    if first in DANGEROUS_KEYWORDS:
        return StatementKind.DANGEROUS
    if first in READ_KEYWORDS:
        if first in ("SELECT", "WITH", "TABLE", "VALUES") and _LOCKING_CLAUSE.search(text):
            return StatementKind.NEEDS_WRITE
        return StatementKind.READ
    if first in WRITE_KEYWORDS:
        return StatementKind.WRITE
    raise SqlRejectedError(
        f"Statement type '{first}' is not on the known read/write lists; refusing to run it."
    )


def ensure_allowed(
    kind: StatementKind, *, allow_write: bool = False, allow_dangerous: bool = False
) -> None:
    """Enforce the read-only-by-default policy for a classified statement."""
    if kind == StatementKind.EMPTY:
        raise SqlRejectedError("Empty statement; nothing to run.")
    if kind in (StatementKind.WRITE, StatementKind.NEEDS_WRITE) and not allow_write:
        raise SqlRejectedError(
            "Statement writes or locks rows. Re-run with writes explicitly allowed "
            "and confirmed (--write + confirm)."
        )
    if kind == StatementKind.DANGEROUS and not (allow_write and allow_dangerous):
        raise SqlRejectedError(
            "Dangerous statement (DROP/TRUNCATE/backend control). "
            "Re-run with dangerous operations explicitly allowed and confirmed."
        )
