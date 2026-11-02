"""Backups through the API with real pg_dump, pg_restore and PostgreSQL.

Skipped unless PGGUARDIAN_TEST_STATEMENTS_DSN points at a disposable server
and the PostgreSQL client tools are on PATH.
"""

from __future__ import annotations

import os
import shutil
import time
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from pgguardian.api.app import create_app

DSN = os.getenv("PGGUARDIAN_TEST_STATEMENTS_DSN")
pytestmark = pytest.mark.skipif(
    not DSN or not shutil.which("pg_dump"), reason="needs a test server and pg_dump"
)


@pytest.fixture
def source(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    params = conninfo_to_dict(DSN)
    name = f"bk_{uuid.uuid4().hex[:8]}"
    empty = f"{name}_restore"
    with psycopg.connect(DSN, autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')
        admin.execute(f'CREATE DATABASE "{empty}"')
    with psycopg.connect(make_conninfo(DSN, dbname=name), autocommit=True) as conn:
        for schema in ("sales", "archive", "ağ-şema"):
            conn.execute(f'CREATE SCHEMA "{schema}"')
            conn.execute(f'CREATE TABLE "{schema}".t_{abs(hash(schema)) % 999} (id int)')
    monkeypatch.setenv("PGGUARDIAN_AUTH_DISABLED", "1")
    monkeypatch.setenv("PGGUARDIAN_ALLOW_WRITES", "1")
    monkeypatch.setenv("PGGUARDIAN_ALLOW_DANGEROUS", "1")
    monkeypatch.setenv("PGGUARDIAN_BACKUP_DIR", str(tmp_path / "default"))
    api = TestClient(create_app())
    api.post(
        "/api/v1/profiles",
        json={
            "name": "bk",
            "host": params["host"],
            "port": int(params["port"]),
            "database": "postgres",
            "username": params["user"],
        },
    )
    api.headers["X-Profile-Name"] = "bk"
    yield api, name, empty
    with psycopg.connect(DSN, autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.execute(f'DROP DATABASE IF EXISTS "{empty}" WITH (FORCE)')


def _wait(api: TestClient, job_id: str) -> dict:
    for _ in range(120):
        job = api.get(f"/api/v1/backups/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.25)
    raise AssertionError("job did not finish")


def test_schemas_of_another_database(source) -> None:
    api, name, _ = source
    assert api.get("/api/v1/backups/options").json()["default_database"] == "postgres"
    schemas = api.get("/api/v1/backups/schemas", params={"database": name}).json()
    assert {s["name"] for s in schemas} >= {"sales", "archive", "public", "ağ-şema"}
    assert next(s for s in schemas if s["name"] == "sales")["tables"] == 1
    assert not any(s["name"].startswith("pg_") for s in schemas)


def test_selected_schemas_go_to_the_chosen_directory(source, tmp_path: Path) -> None:
    api, name, _ = source
    target = tmp_path / "chosen" / "nested"
    started = api.post(
        "/api/v1/backups",
        json={
            "confirm": True,
            "database": name,
            "format": "plain",
            "directory": str(target),
            "schema_names": ["sales", "ağ-şema"],
        },
    )
    assert started.status_code == 200, started.text
    job = _wait(api, started.json()["id"])
    assert job["status"] == "done", job["error"]
    assert job["schemas"] == ["ağ-şema", "sales"]
    dump = (target / job["file"]).read_text(encoding="utf-8")
    assert "CREATE SCHEMA sales" in dump
    assert "ağ-şema" in dump
    assert "CREATE SCHEMA archive" not in dump
    download = api.get(f"/api/v1/backups/{job['id']}/download")
    assert download.status_code == 200
    assert "CREATE SCHEMA sales" in download.text


def test_custom_backup_from_chosen_directory_restores(source, tmp_path: Path) -> None:
    api, name, empty = source
    started = api.post(
        "/api/v1/backups",
        json={
            "confirm": True,
            "database": name,
            "format": "custom",
            "directory": str(tmp_path / "elsewhere"),
            "schema_names": ["sales"],
        },
    ).json()
    assert _wait(api, started["id"])["status"] == "done"
    restore = api.post(
        "/api/v1/backups/restore",
        json={"confirm": True, "confirm_name": empty, "backup_id": started["id"], "database": empty},
    )
    assert restore.status_code == 200, restore.text
    assert _wait(api, restore.json()["id"])["status"] == "done"
    with psycopg.connect(make_conninfo(DSN, dbname=empty)) as conn:
        found = {r[0] for r in conn.execute("SELECT nspname FROM pg_namespace")}
    assert "sales" in found and "archive" not in found


@pytest.mark.parametrize(
    "body,status",
    [
        ({"schema_names": ["no_such_schema"]}, 400),
        ({"directory": "relative/path"}, 400),
    ],
)
def test_bad_requests_are_refused(source, body: dict, status: int) -> None:
    api, name, _ = source
    response = api.post("/api/v1/backups", json={"confirm": True, "database": name, **body})
    assert response.status_code == status, response.text


def test_allowed_dirs_limit_the_location(source, tmp_path: Path, monkeypatch) -> None:
    api, name, _ = source
    monkeypatch.setenv("PGGUARDIAN_BACKUP_ALLOWED_DIRS", str(tmp_path / "ok"))
    outside = api.post(
        "/api/v1/backups",
        json={"confirm": True, "database": name, "directory": str(tmp_path / "other")},
    )
    assert outside.status_code == 403
    assert not (tmp_path / "other").exists()
    inside = api.post(
        "/api/v1/backups",
        json={"confirm": True, "database": name, "directory": str(tmp_path / "ok" / "x")},
    )
    assert inside.status_code == 200
    _wait(api, inside.json()["id"])
