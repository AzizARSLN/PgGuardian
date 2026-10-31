"""Every packaged diagnostic query must survive psycopg's placeholder parser."""

from __future__ import annotations

from pathlib import Path

import pytest

from pgguardian.database.queries import load_sql

SQL_ROOT = Path(__file__).resolve().parents[2] / "sql"
FILES = sorted(SQL_ROOT.glob("*/*.sql"))


@pytest.mark.parametrize("path", FILES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_comments_do_not_add_placeholders(path: Path) -> None:
    loaded = load_sql(path.parent.name, path.stem)
    assert not any(line.lstrip().startswith("--") for line in loaded.splitlines())
    code_lines = [
        line for line in path.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("--")
    ]
    assert loaded.count("%s") == "\n".join(code_lines).count("%s")
