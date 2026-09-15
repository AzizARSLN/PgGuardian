"""Query models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class QueryInfo(BaseModel):
    """One running (or recent) backend query."""

    model_config = ConfigDict(frozen=True)

    pid: int
    duration_seconds: float | None = None
    user: str | None = None
    database: str | None = None
    state: str | None = None
    wait_event_type: str | None = None
    wait_event: str | None = None
    query: str | None = None


class QueryReport(BaseModel):
    """A bounded list of queries."""

    model_config = ConfigDict(frozen=True)

    kind: str = "active"
    limit: int = 20
    count: int = 0
    queries: list[QueryInfo] = Field(default_factory=list)
