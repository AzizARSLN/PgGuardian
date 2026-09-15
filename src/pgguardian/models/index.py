"""Index models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class IndexInfo(BaseModel):
    """Usage statistics for one index.

    Low scan counts are reported as *potentially* unused only — statistics
    may have been reset recently and workloads vary over time.
    """

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str
    index_size_bytes: int = 0
    index_scans: int = 0
    tuples_read: int = 0
    tuples_fetched: int = 0
    potentially_unused: bool = False
    reason: str | None = None


class IndexReport(BaseModel):
    """Index usage listing plus low-usage candidates."""

    model_config = ConfigDict(frozen=True)

    limit: int = 20
    count: int = 0
    indexes: list[IndexInfo] = Field(default_factory=list)
    potentially_unused: list[IndexInfo] = Field(default_factory=list)
