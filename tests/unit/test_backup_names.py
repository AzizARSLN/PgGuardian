"""Database names reach pg_dump's command line and the backup file path."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from pgguardian.api.routers.backups import _safe_database_name


@pytest.mark.parametrize("name", ["app", "şirket_db", "my-db.v2", "Sales 2024"])
def test_accepts_real_names(name: str) -> None:
    assert _safe_database_name(name) == name


@pytest.mark.parametrize("name", ["host=evil dbname=x", "../../x", "--help", "", "a/b"])
def test_rejects_conninfo_and_paths(name: str) -> None:
    with pytest.raises(HTTPException):
        _safe_database_name(name)
