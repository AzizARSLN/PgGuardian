"""Storage diagnostics: database / table / index sizes (top-N)."""

from __future__ import annotations

from pgguardian.database.connection import DbClient
from pgguardian.database.queries import load_sql
from pgguardian.models.storage import DatabaseSize, IndexSize, StorageReport, TableSize
from pgguardian.utils.formatting import to_int as _int


def collect_storage(client: DbClient, limit: int = 20) -> StorageReport:
    """Fetch sizes; each section degrades to empty independently on failure."""
    databases: list[DatabaseSize] = []
    tables: list[TableSize] = []
    indexes: list[IndexSize] = []
    try:
        for row in client.fetch_all(load_sql("storage", "databases")):
            databases.append(
                DatabaseSize(
                    database=str(row.get("database") or "unknown"),
                    size_bytes=_int(row.get("size_bytes")),
                )
            )
    except Exception:
        databases = []
    try:
        for row in client.fetch_all(load_sql("storage", "tables"), (limit,)):
            tables.append(
                TableSize(
                    schema_name=str(row.get("schema_name")) if row.get("schema_name") else None,
                    table_name=str(row.get("table_name") or "unknown"),
                    total_size_bytes=_int(row.get("total_size_bytes")),
                    table_size_bytes=_int(row.get("table_size_bytes")),
                    indexes_size_bytes=_int(row.get("indexes_size_bytes")),
                )
            )
    except Exception:
        tables = []
    try:
        for row in client.fetch_all(load_sql("storage", "indexes"), (limit,)):
            indexes.append(
                IndexSize(
                    schema_name=str(row.get("schema_name")) if row.get("schema_name") else None,
                    table_name=str(row.get("table_name")) if row.get("table_name") else None,
                    index_name=str(row.get("index_name") or "unknown"),
                    size_bytes=_int(row.get("size_bytes")),
                )
            )
    except Exception:
        indexes = []
    return StorageReport(databases=databases, tables=tables, indexes=indexes, limit=limit)
