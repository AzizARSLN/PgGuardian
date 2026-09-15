"""Replication insight endpoints (read-only; degrade gracefully)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.database.connection import DbClient
from pgguardian.utils.formatting import to_int

router = APIRouter(prefix="/api/v1/replication", tags=["replication"])


class ReplicaInfo(BaseModel):
    """One streaming replica."""

    model_config = ConfigDict(frozen=True)

    client_address: str | None = None
    username: str | None = None
    application_name: str | None = None
    state: str | None = None
    replay_lag_bytes: int = 0


class SlotInfo(BaseModel):
    """One replication slot."""

    model_config = ConfigDict(frozen=True)

    slot_name: str
    slot_type: str | None = None
    active: bool = False


class ReplicationStatus(BaseModel):
    """Replicas plus slots."""

    model_config = ConfigDict(frozen=True)

    replicas: list[ReplicaInfo] = Field(default_factory=list)
    slots: list[SlotInfo] = Field(default_factory=list)


@router.get("", response_model=ReplicationStatus)
def get_replication(client: DbClient = Depends(resolve_client)) -> ReplicationStatus:
    """Streaming replicas and slots (read-only; empty when not a primary)."""
    replicas: list[ReplicaInfo] = []
    slots: list[SlotInfo] = []
    with mapped_errors(client.settings):
        client.ping()
        try:
            for row in client.fetch_all(
                "SELECT client_addr AS client_address, usename AS username,"
                " application_name, state,"
                " pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes"
                " FROM pg_stat_replication"
            ):
                lag = row.get("replay_lag_bytes")
                replicas.append(
                    ReplicaInfo(
                        client_address=str(row.get("client_address"))
                        if row.get("client_address")
                        else None,
                        username=str(row.get("username")) if row.get("username") else None,
                        application_name=str(row.get("application_name"))
                        if row.get("application_name")
                        else None,
                        state=str(row.get("state")) if row.get("state") else None,
                        replay_lag_bytes=to_int(lag) if lag is not None else 0,
                    )
                )
        except Exception:
            replicas = []
        try:
            for row in client.fetch_all(
                "SELECT slot_name, slot_type, active FROM pg_replication_slots ORDER BY 1"
            ):
                slots.append(
                    SlotInfo(
                        slot_name=str(row.get("slot_name")),
                        slot_type=str(row.get("slot_type")) if row.get("slot_type") else None,
                        active=bool(row.get("active", False)),
                    )
                )
        except Exception:
            slots = []
    return ReplicationStatus(replicas=replicas, slots=slots)
