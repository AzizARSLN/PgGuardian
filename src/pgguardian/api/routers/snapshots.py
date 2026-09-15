"""Snapshot tracking endpoints: capture aggregates, query trends per server/database."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.database.connection import DbClient
from pgguardian.snapshots.collector import take_snapshot
from pgguardian.snapshots.store import Snapshot, SnapshotStore

router = APIRouter(prefix="/api/v1/snapshots", tags=["snapshots"])


def _store() -> SnapshotStore:
    return SnapshotStore()


@router.get("", response_model=list[Snapshot])
def list_snapshots(
    profile: str | None = None,
    server: str | None = None,
    database: str | None = None,
    limit: int = 50,
) -> list[Snapshot]:
    """Newest-first snapshots, filterable by profile, server or database."""
    return _store().list(profile=profile, server=server, database=database, limit=min(limit, 1000))


@router.get("/latest", response_model=Snapshot)
def latest_snapshot(
    profile: str | None = None, server: str | None = None, database: str | None = None
) -> Snapshot:
    """Newest snapshot for a server/database scope (404 when none)."""
    snapshot = _store().latest(profile=profile, server=server, database=database)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No snapshots recorded for this scope yet.")
    return snapshot


@router.post("", response_model=Snapshot)
def capture_snapshot(
    profile: str | None = None,
    server: str | None = None,
    client: DbClient = Depends(resolve_client),
) -> Snapshot:
    """Take a snapshot of the current connection and store it."""
    with mapped_errors(client.settings):
        client.ping()
        snapshot = take_snapshot(client, profile=profile, server=server)
        return _store().save(snapshot)


@router.post("/prune")
def prune_snapshots(keep_days: int = 90, confirm: bool = False) -> dict:
    """Delete snapshots older than ``keep_days`` (needs ``?confirm=true``)."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pruning history needs ?confirm=true.")
    removed = _store().prune(keep_days=keep_days)
    return {"removed": removed, "keep_days": keep_days}
