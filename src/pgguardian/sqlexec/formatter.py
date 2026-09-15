"""SQL formatting for expert use (read-only, no DB needed)."""

from __future__ import annotations

import sqlparse


def format_sql(sql: str, *, keyword_case: str = "upper") -> str:
    """Format SQL with reindent and keyword casing (upper/lower)."""
    stripped = sql.strip()
    if not stripped:
        return ""
    return sqlparse.format(
        stripped,
        reindent=True,
        keyword_case=keyword_case,
        strip_comments=False,
        use_space_around_operators=True,
    ).strip()
