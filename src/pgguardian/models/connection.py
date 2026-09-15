"""Connection models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ConnectionInfo(BaseModel):
    """One backend from pg_stat_activity."""

    model_config = ConfigDict(frozen=True)

    pid: int
    user: str | None = None
    database: str | None = None
    client_address: str | None = None
    application_name: str | None = None
    backend_type: str | None = None
    state: str | None = None
    wait_event_type: str | None = None
    wait_event: str | None = None
    query_duration_seconds: float | None = None
    transaction_duration_seconds: float | None = None
    query: str | None = None


class ConnectionSummary(BaseModel):
    """Totals plus per-state grouping."""

    model_config = ConfigDict(frozen=True)

    current_connections: int = 0
    max_connections: int = 0
    usage_percent: float = 0.0
    active: int = 0
    idle: int = 0
    idle_in_transaction: int = 0
    waiting: int = 0
    by_state: dict[str, int] = Field(default_factory=dict)


class ConnectionReport(BaseModel):
    """Connection listing plus summary."""

    model_config = ConfigDict(frozen=True)

    summary: ConnectionSummary = Field(default_factory=ConnectionSummary)
    connections: list[ConnectionInfo] = Field(default_factory=list)


def compute_usage_percent(current: int, maximum: int) -> float:
    """Connection usage percentage, safe against zero/NULL max_connections."""
    if maximum is None or maximum <= 0 or current is None or current < 0:
        return 0.0
    return round((current / maximum) * 100, 1)
