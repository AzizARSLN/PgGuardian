"""Storage models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DatabaseSize(BaseModel):
    """Size of one database."""

    model_config = ConfigDict(frozen=True)

    database: str
    size_bytes: int = 0


class TableSize(BaseModel):
    """Size breakdown of one table."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str
    total_size_bytes: int = 0
    table_size_bytes: int = 0
    indexes_size_bytes: int = 0


class IndexSize(BaseModel):
    """Size of one index."""

    model_config = ConfigDict(frozen=True)

    schema_name: str | None = None
    table_name: str | None = None
    index_name: str
    size_bytes: int = 0


class StorageReport(BaseModel):
    """Database / table / index sizes (top-N each)."""

    model_config = ConfigDict(frozen=True)

    databases: list[DatabaseSize] = Field(default_factory=list)
    tables: list[TableSize] = Field(default_factory=list)
    indexes: list[IndexSize] = Field(default_factory=list)
    limit: int = 20
