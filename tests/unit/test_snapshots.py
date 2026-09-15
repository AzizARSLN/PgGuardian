"""Unit tests for the snapshot store (tmp SQLite, no database needed)."""

from __future__ import annotations

from pathlib import Path

from pgguardian.snapshots.store import Snapshot, SnapshotStore


def _store(tmp_path: Path) -> SnapshotStore:
    return SnapshotStore(tmp_path / "snapshots.db")


def test_save_list_latest(tmp_path: Path) -> None:
    store = _store(tmp_path)
    assert store.list() == []
    first = store.save(Snapshot(profile="prod", database="app", score=94, status="HEALTHY"))
    assert first.id == 1
    store.save(Snapshot(profile="prod", database="app", score=88, status="DEGRADED"))
    items = store.list(profile="prod")
    assert [snapshot.score for snapshot in items] == [88, 94]
    latest = store.latest(profile="prod", database="app")
    assert latest is not None
    assert latest.score == 88


def test_filters(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save(Snapshot(profile="a", server="s1", database="db1", score=90))
    store.save(Snapshot(profile="b", server="s1", database="db2", score=80))
    assert len(store.list(server="s1")) == 2
    assert len(store.list(database="db1")) == 1
    assert store.latest(profile="missing") is None


def test_snapshot_roundtrip(tmp_path: Path) -> None:
    store = _store(tmp_path)
    saved = store.save(
        Snapshot(
            profile="prod",
            host="db.internal",
            database="app",
            server_version="16.10",
            score=100,
            status="HEALTHY",
            connections=10,
            max_connections=200,
            cache_hit=99.2,
            db_size_bytes=1024,
        )
    )
    fetched = store.latest(profile="prod")
    assert fetched == saved
    assert fetched is not None
    assert fetched.cache_hit == 99.2


def test_prune(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save(Snapshot(profile="p", database="d", score=90))
    assert store.prune(keep_days=90) == 0
