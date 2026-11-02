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

# Server-side file/program access and extension code run with server privileges.
SERVER_ACCESS_FUNCTIONS = frozenset(
    {
        "pg_read_file",
        "pg_read_binary_file",
        "pg_ls_dir",
        "pg_stat_file",
        "lo_import",
        "lo_export",
        "dblink",
        "dblink_exec",
    }
)
_DATA_MODIFYING = re.compile(r"\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|MERGE\s+INTO)\b", re.I)
_SELECT_INTO = re.compile(r"\bSELECT\b(?:(?!\bFROM\b).)*?\bINTO\s+(?!STRICT\b)", re.I | re.S)
_PRIVILEGED_DDL = re.compile(
    r"^\s*(ALTER\s+SYSTEM\b|DO\b|COPY\b.*\bPROGRAM\b|CREATE\s+EXTENSION\b"
    r"|(ALTER|CREATE)\s+(ROLE|USER)\b.*\b(SUPERUSER|BYPASSRLS|REPLICATION)\b"
    r"|(CREATE|ALTER)\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b.*\bSECURITY\s+DEFINER\b)",
    re.I | re.S,
)
_EXPLAIN_HEAD = re.compile(r"^\s*EXPLAIN\s*(\((?P<opts>[^)]*)\)|(?P<bare>(\s*(ANALYZE|ANALYSE|VERBOSE))*))", re.I)

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


def _blank_literals(sql: str) -> str:
    """Replace string and quoted-identifier contents so keyword checks see only code."""
    sql = re.sub(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$.*?\$\1\$", "$$", sql, flags=re.S)
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)
    return re.sub(r'"(?:[^"]|"")*"', '""', sql)


def _explain_runs_statement(text: str) -> tuple[bool, str]:
    """Return (executes_for_real, inner_statement) for an EXPLAIN."""
    match = _EXPLAIN_HEAD.match(text)
    if not match:
        return False, ""
    options = match.group("opts") if match.group("opts") is not None else (match.group("bare") or "")
    analyzes = False
    for option in re.split(r"[,\s]+(?=ANALY[SZ]E)", options, flags=re.I):
        parsed = re.match(r"\s*ANALY[SZ]E(\s+(\w+))?", option, re.I)
        if parsed and (parsed.group(2) or "true").lower() not in ("false", "off", "0"):
            analyzes = True
    return analyzes, text[match.end() :].strip()


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
    code = _blank_literals(text)
    lowered = code.lower()
    if any(re.search(rf"\b{func}\b", lowered) for func in TERMINATE_FUNCTIONS | SERVER_ACCESS_FUNCTIONS):
        return StatementKind.DANGEROUS
    if first in DANGEROUS_KEYWORDS or _PRIVILEGED_DDL.match(code):
        return StatementKind.DANGEROUS
    if first == "EXPLAIN":
        runs, inner = _explain_runs_statement(text)
        return classify(inner) if runs and inner else StatementKind.READ
    if first in READ_KEYWORDS:
        if first in ("SELECT", "WITH") and (
            _SELECT_INTO.search(code) or (first == "WITH" and _DATA_MODIFYING.search(code))
        ):
            return StatementKind.WRITE
        if first in ("SELECT", "WITH", "TABLE", "VALUES") and _LOCKING_CLAUSE.search(code):
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
