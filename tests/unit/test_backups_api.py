"""Backup API tests without a database: pg_dump/pg_restore are faked."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pgguardian.api.app import create_app
from pgguardian.api.deps import resolve_client
from pgguardian.api.routers import backups
from pgguardian.config.settings import PgGuardianSettings
from pgguardian.database.connection import DbClient

ENVIRONMENT = {
    "PGHOST": "127.0.0.1",
    "PGPORT": "55432",
    "PGDATABASE": "pgguardian_test",
    "PGUSER": "tester",
    "PGPASSWORD": "secret-test-pw-xyz",
    "PGGUARDIAN_CONNECT_TIMEOUT": "1",
    "PGGUARDIAN_AUTH_DISABLED": "1",
    "PGGUARDIAN_ALLOW_WRITES": "1",
    "PGGUARDIAN_ALLOW_DANGEROUS": "1",
}


class FakeClient:
    """Stands in for DbClient: real settings, no connection."""

    def __init__(self, profile: str | None = "prod", password: str = "s3cret-pw") -> None:
        self.settings = PgGuardianSettings(
            host="db.internal",
            port=5433,
            database="app",
            username="app_user",
            password=password,
            active_profile=profile,
        )

    def ping(self) -> None:
        return None


@pytest.fixture
def backup_dir(tmp_path: Path) -> Path:
    path = tmp_path / "backups"
    path.mkdir()
    return path


@pytest.fixture
def api(
    tmp_path: Path, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> TestClient:
    for key, value in ENVIRONMENT.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("PGGUARDIAN_API_TOKEN", raising=False)
    # Empty store: nothing here relies on a default profile.
    monkeypatch.setenv("PGGUARDIAN_PROFILES_FILE", str(tmp_path / "profiles.json"))
    monkeypatch.setattr(backups.shutil, "which", lambda name: f"/usr/bin/{name}")
    app = create_app()
    app.dependency_overrides[backups.get_api_settings] = lambda: _settings(backup_dir)
    app.dependency_overrides[resolve_client] = lambda: FakeClient()
    return TestClient(app)


def _settings(backup_dir: Path):
    from pgguardian.api.settings import ApiSettings

    settings = ApiSettings()
    settings.backup_dir = str(backup_dir)
    settings.allow_writes = True
    settings.allow_dangerous = True
    return settings


def _use_profile(api: TestClient, profile: str | None) -> None:
    api.app.dependency_overrides[resolve_client] = lambda: FakeClient(profile=profile)


def _sidecar(directory: Path, job_id: str, *, file: str | None = None, **fields) -> None:
    payload = {
        "id": job_id,
        "kind": "backup",
        "status": "done",
        "database": "app",
        "file": file,
        "started_at": "2026-01-01T00:00:00Z",
        **fields,
    }
    (directory / f"{job_id}.json").write_text(json.dumps(payload), encoding="utf-8")


def _wait_finished(api: TestClient, job_id: str) -> dict:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = api.get(f"/api/v1/backups/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not finish")


def _fake_run(calls: list[list[str]], *, stderr: bytes | None = None):
    """subprocess.run stand-in: creates pg_dump's -f target or fails with stderr."""

    def run(cmd, **kwargs):
        calls.append(cmd)
        if stderr is not None:
            if "-f" in cmd:
                Path(cmd[cmd.index("-f") + 1]).write_bytes(b"partial")
            raise subprocess.CalledProcessError(1, cmd, stderr=stderr)
        if "-f" in cmd and Path(cmd[0]).name == "pg_dump":
            target = Path(cmd[cmd.index("-f") + 1])
            if cmd[cmd.index("-F") + 1] == "d":
                target.mkdir()
                (target / "toc.dat").write_bytes(b"12345")
            else:
                target.write_bytes(b"1234567")
        return subprocess.CompletedProcess(cmd, 0)

    return run


def test_failed_backup_keeps_sanitized_stderr_tail(
    api: TestClient, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []
    noise = b"x" * 5000
    stderr = noise + b'\npg_dump: error: password s3cret-pw rejected for "app_user"\n'
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls, stderr=stderr))

    started = api.post("/api/v1/backups", json={"confirm": True})
    assert started.status_code == 200
    job = _wait_finished(api, started.json()["id"])

    assert job["status"] == "failed"
    assert "pg_dump exited with code 1" in job["error"]
    assert 'rejected for "app_user"' in job["error"]
    assert "s3cret-pw" not in job["error"]
    assert len(job["error"]) < 1100
    # The partial file must not look like a usable backup.
    assert not (backup_dir / job["file"]).exists()
    persisted = json.loads((backup_dir / f"{job['id']}.json").read_text(encoding="utf-8"))
    assert persisted["status"] == "failed"


def test_backup_records_profile_and_builds_command(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls))

    started = api.post(
        "/api/v1/backups",
        json={
            "confirm": True,
            "compression": 3,
            "schema_name": "public",
            "table_name": "orders",
            "filename": "nightly.dump",
        },
    )
    assert started.status_code == 200
    assert started.json()["profile"] == "prod"
    job = _wait_finished(api, started.json()["id"])

    assert job["status"] == "done"
    assert job["size_bytes"] == 7
    assert job["file"] == f"nightly-{job['id']}.dump"
    cmd = calls[0]
    assert "--compress=3" in cmd
    assert '--table="public"."orders"' in cmd
    assert cmd[-1] == "app"
    assert "s3cret-pw" not in " ".join(cmd)
    listed = api.get("/api/v1/backups").json()
    assert [(item["id"], item["profile"]) for item in listed] == [(job["id"], "prod")]


@pytest.mark.parametrize(
    "body",
    [
        {"format": "pgdump"},
        {"schema_only": True, "data_only": True},
        {"format": "plain", "compression": 6},
        {"filename": "../../evil"},
        {"schema_name": 'x"; DROP'},
        {"database": "app\n"},
    ],
)
def test_backup_rejects_bad_options(
    api: TestClient, monkeypatch: pytest.MonkeyPatch, body: dict
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls))
    response = api.post("/api/v1/backups", json={"confirm": True, **body})
    assert response.status_code == 400
    assert calls == []


def test_ambient_pgpassword_does_not_override_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PGPASSWORD", "ambient-other-server")
    client = DbClient(FakeClient(profile="prod", password="profile-pw").settings)
    env, host, port, database, username = backups._dump_env(client)
    assert env["PGPASSWORD"] == "profile-pw"
    assert (host, port, database, username) == ("db.internal", "5433", "app", "app_user")


def test_password_with_space_reaches_the_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGPASSWORD", "ambient-other-server")
    client = DbClient(FakeClient(profile="prod", password="with space").settings)
    env, host, *_ = backups._dump_env(client)
    assert env["PGPASSWORD"] == "with space"
    assert host == "db.internal"


def test_running_job_without_thread_loads_as_interrupted(
    api: TestClient, backup_dir: Path
) -> None:
    _sidecar(backup_dir, "orphan", status="running", file="orphan.dump")

    job = api.get("/api/v1/backups/orphan").json()
    assert job["status"] == "failed"
    assert "interrupted" in job["error"]
    assert job["finished_at"]
    assert api.get("/api/v1/backups").json()[0]["status"] == "failed"
    persisted = json.loads((backup_dir / "orphan.json").read_text(encoding="utf-8"))
    assert persisted["status"] == "failed"


def test_running_job_with_live_owner_stays_running(
    api: TestClient, backup_dir: Path
) -> None:
    _sidecar(backup_dir, "alive", status="running", file="alive.dump")
    backups._claim("alive")
    try:
        assert api.get("/api/v1/backups/alive").json()["status"] == "running"
    finally:
        backups._active_jobs.discard("alive")


def test_listing_orphan_in_memory_registry_is_settled(api: TestClient) -> None:
    api.app.state.backup_jobs = {
        "stale": backups.BackupJob(id="stale", status="running", started_at="2026-01-01")
    }
    assert api.get("/api/v1/backups").json()[0]["status"] == "failed"


def test_restore_into_other_profile_is_refused(
    api: TestClient, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls))
    (backup_dir / "b1.dump").write_bytes(b"x")
    _sidecar(backup_dir, "b1", file="b1.dump", profile="staging")

    response = api.post(
        "/api/v1/backups/restore",
        json={"confirm": True, "confirm_name": "app", "backup_id": "b1", "database": "app"},
    )
    assert response.status_code == 409
    assert "staging" in response.json()["detail"]
    assert calls == []


def test_restore_into_unprofiled_server_is_refused(
    api: TestClient, backup_dir: Path
) -> None:
    _use_profile(api, None)
    (backup_dir / "b1.dump").write_bytes(b"x")
    _sidecar(backup_dir, "b1", file="b1.dump", profile="staging")
    response = api.post(
        "/api/v1/backups/restore",
        json={"confirm": True, "confirm_name": "app", "backup_id": "b1", "database": "app"},
    )
    assert response.status_code == 409


@pytest.mark.parametrize("job_profile", ["prod", None])
def test_restore_allowed_for_same_profile_or_old_sidecar(
    api: TestClient,
    backup_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    job_profile: str | None,
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls))
    (backup_dir / "b1.dump").write_bytes(b"x")
    _sidecar(backup_dir, "b1", file="b1.dump", profile=job_profile)

    response = api.post(
        "/api/v1/backups/restore",
        json={"confirm": True, "confirm_name": "app", "backup_id": "b1", "database": "app"},
    )
    assert response.status_code == 200
    assert response.json()["profile"] == "prod"
    assert _wait_finished(api, response.json()["id"])["status"] == "done"
    assert Path(calls[0][0]).name == "pg_restore"


def test_restore_refuses_unfinished_backup(api: TestClient, backup_dir: Path) -> None:
    (backup_dir / "bad.dump").write_bytes(b"partial")
    _sidecar(backup_dir, "bad", file="bad.dump", status="failed", profile="prod")
    response = api.post(
        "/api/v1/backups/restore",
        json={"confirm": True, "confirm_name": "app", "backup_id": "bad", "database": "app"},
    )
    assert response.status_code == 409


def test_plain_restore_stops_on_error_and_rejects_clean(
    api: TestClient, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls))
    (backup_dir / "p.sql").write_text("SELECT 1;", encoding="utf-8")
    _sidecar(backup_dir, "p", file="p.sql", profile="prod")
    body = {"confirm": True, "confirm_name": "app", "backup_id": "p", "database": "app"}

    assert (
        api.post("/api/v1/backups/restore", json={**body, "clean": True}).status_code == 400
    )
    response = api.post("/api/v1/backups/restore", json=body)
    assert response.status_code == 200
    _wait_finished(api, response.json()["id"])
    assert Path(calls[0][0]).name == "psql"
    assert "ON_ERROR_STOP=1" in calls[0]


def test_directory_backup_size_download_and_restore(
    api: TestClient, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(backups.subprocess, "run", _fake_run(calls))
    started = api.post("/api/v1/backups", json={"confirm": True, "format": "directory"})
    assert started.status_code == 200
    job = _wait_finished(api, started.json()["id"])
    assert job["status"] == "done"
    assert job["size_bytes"] == 5

    download = api.get(f"/api/v1/backups/{job['id']}/download")
    assert download.status_code == 400
    assert "directory format" in download.json()["detail"]

    restore = api.post(
        "/api/v1/backups/restore",
        json={"confirm": True, "confirm_name": "app", "backup_id": job["id"], "database": "app"},
    )
    assert restore.status_code == 200
    _wait_finished(api, restore.json()["id"])
    assert Path(calls[-1][0]).name == "pg_restore"
    assert calls[-1][-1] == str(backup_dir / job["file"])


def test_download_regular_file_and_state_errors(api: TestClient, backup_dir: Path) -> None:
    (backup_dir / "ok.dump").write_bytes(b"payload")
    _sidecar(backup_dir, "ok", file="ok.dump")
    _sidecar(backup_dir, "rst", kind="restore", file="ok.dump")
    _sidecar(backup_dir, "gone", file="gone.dump")

    response = api.get("/api/v1/backups/ok/download")
    assert response.status_code == 200
    assert response.content == b"payload"
    assert api.get("/api/v1/backups/rst/download").status_code == 409
    assert api.get("/api/v1/backups/gone/download").status_code == 404
    assert api.get("/api/v1/backups/missing/download").status_code == 404


def test_job_id_cannot_escape_the_backup_directory(
    api: TestClient, tmp_path: Path, backup_dir: Path
) -> None:
    _sidecar(tmp_path, "outside", file="outside.dump")
    assert api.get("/api/v1/backups/..%5Coutside").status_code == 404


def test_saved_profile_without_selection_is_409(
    tmp_path: Path, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for key, value in ENVIRONMENT.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("PGGUARDIAN_API_TOKEN", raising=False)
    monkeypatch.setenv("PGGUARDIAN_PROFILES_FILE", str(tmp_path / "profiles.json"))
    app = create_app()
    app.dependency_overrides[backups.get_api_settings] = lambda: _settings(backup_dir)
    client = TestClient(app)
    created = client.post(
        "/api/v1/profiles",
        json={"name": "prod", "host": "db.internal", "database": "app", "username": "app"},
    )
    assert created.status_code == 200
    response = client.post("/api/v1/backups", json={"confirm": True})
    assert response.status_code == 409
    assert "profile" in response.json()["detail"].lower()
