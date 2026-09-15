"""Schema/table introspection endpoints (read-only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import mapped_errors, resolve_client
from pgguardian.api.safety import validate_identifier
from pgguardian.database.connection import DbClient
from pgguardian.models.maintenance import dead_tuple_percent
from pgguardian.utils.formatting import to_int

router = APIRouter(prefix="/api/v1", tags=["schemas"])


class SchemaInfo(BaseModel):
    """One namespace."""

    model_config = ConfigDict(frozen=True)

    name: str
    owner: str | None = None
    is_system: bool = False


class TableSummary(BaseModel):
    """One table with size and tuple stats."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    table_name: str
    total_size_bytes: int = 0
    live_tuples: int = 0
    dead_tuples: int = 0
    dead_tuple_percent: float = 0.0


class ColumnInfo(BaseModel):
    """One table column."""

    model_config = ConfigDict(frozen=True)

    name: str
    data_type: str
    nullable: bool = True
    default: str | None = None


class TableDetail(BaseModel):
    """Full table detail: columns, indexes, constraints, stats."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    table_name: str
    total_size_bytes: int = 0
    live_tuples: int = 0
    dead_tuples: int = 0
    columns: list[ColumnInfo] = Field(default_factory=list)
    indexes: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


@router.get("/schemas", response_model=list[SchemaInfo])
def list_schemas(client: DbClient = Depends(resolve_client)) -> list[SchemaInfo]:
    """Namespaces with owners (read-only)."""
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner"
            " FROM pg_namespace ORDER BY 1"
        )
    return [
        SchemaInfo(
            name=str(row.get("name")),
            owner=str(row.get("owner")) if row.get("owner") else None,
            is_system=str(row.get("name")).startswith("pg_")
            or str(row.get("name")) == "information_schema",
        )
        for row in rows
    ]


@router.get("/schemas/{schema}/tables", response_model=list[TableSummary])
def list_tables(
    schema: str, limit: int = 100, client: DbClient = Depends(resolve_client)
) -> list[TableSummary]:
    """Tables in a schema with sizes and dead-tuple ratios (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT schemaname AS schema_name, relname AS table_name,"
            " pg_total_relation_size(relid) AS total_size_bytes,"
            " n_live_tup AS live_tuples, n_dead_tup AS dead_tuples"
            " FROM pg_stat_user_tables WHERE schemaname = %s"
            " ORDER BY 3 DESC LIMIT %s",
            (schema_name, min(limit, 1000)),
        )
    result: list[TableSummary] = []
    for row in rows:
        live = to_int(row.get("live_tuples"))
        dead = to_int(row.get("dead_tuples"))
        result.append(
            TableSummary(
                schema_name=str(row.get("schema_name")),
                table_name=str(row.get("table_name")),
                total_size_bytes=to_int(row.get("total_size_bytes")),
                live_tuples=live,
                dead_tuples=dead,
                dead_tuple_percent=dead_tuple_percent(live, dead),
            )
        )
    return result


@router.get("/tables/{schema}/{table}", response_model=TableDetail)
def describe_table(
    schema: str, table: str, client: DbClient = Depends(resolve_client)
) -> TableDetail:
    """Columns, indexes, constraints and stats for one table (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    table_name = validate_identifier(table, what="table name")
    with mapped_errors(client.settings):
        client.ping()
        columns = client.fetch_all(
            "SELECT column_name AS name, data_type,"
            " (is_nullable = 'YES') AS nullable, column_default AS default_value"
            " FROM information_schema.columns"
            " WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
            (schema_name, table_name),
        )
        indexes = client.fetch_all(
            "SELECT indexname AS name FROM pg_indexes"
            " WHERE schemaname = %s AND tablename = %s ORDER BY 1",
            (schema_name, table_name),
        )
        constraints = client.fetch_all(
            "SELECT conname AS name FROM pg_constraint c"
            " JOIN pg_class t ON t.oid = c.conrelid"
            " JOIN pg_namespace n ON n.oid = t.relnamespace"
            " WHERE n.nspname = %s AND t.relname = %s ORDER BY 1",
            (schema_name, table_name),
        )
        stats = client.fetch_one(
            "SELECT n_live_tup AS live_tuples, n_dead_tup AS dead_tuples"
            " FROM pg_stat_user_tables WHERE schemaname = %s AND relname = %s",
            (schema_name, table_name),
        )
        size = client.fetch_one(
            "SELECT pg_total_relation_size(format('%%I.%%I', %s, %s)::regclass)"
            " AS total_size_bytes",
            (schema_name, table_name),
        )
    live = to_int((stats or {}).get("live_tuples"))
    dead = to_int((stats or {}).get("dead_tuples"))
    return TableDetail(
        schema_name=schema_name,
        table_name=table_name,
        total_size_bytes=to_int((size or {}).get("total_size_bytes")),
        live_tuples=live,
        dead_tuples=dead,
        columns=[
            ColumnInfo(
                name=str(col.get("name")),
                data_type=str(col.get("data_type")),
                nullable=bool(col.get("nullable", True)),
                default=str(col.get("default_value")) if col.get("default_value") else None,
            )
            for col in columns
        ],
        indexes=[str(idx.get("name")) for idx in indexes],
        constraints=[str(con.get("name")) for con in constraints],
    )
