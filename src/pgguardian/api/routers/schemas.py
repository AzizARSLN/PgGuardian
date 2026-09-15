"""Schema/table introspection endpoints (read-only, with ownership)."""

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
    """One table with size, tuple stats and owner."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    table_name: str
    owner: str | None = None
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
    """Full table detail: columns, indexes, constraints, stats and owner."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    table_name: str
    owner: str | None = None
    total_size_bytes: int = 0
    live_tuples: int = 0
    dead_tuples: int = 0
    columns: list[ColumnInfo] = Field(default_factory=list)
    indexes: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


class ViewInfo(BaseModel):
    """One view or materialized view with owner."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    view_name: str
    owner: str | None = None
    is_materialized: bool = False


class SequenceInfo(BaseModel):
    """One sequence with owner."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    sequence_name: str
    owner: str | None = None
    size_bytes: int = 0


class FunctionInfo(BaseModel):
    """One function/procedure with owner."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    function_name: str
    owner: str | None = None
    arguments: str | None = None
    kind: str | None = None


class DbObjectInfo(BaseModel):
    """Generic DB object with owner and type."""

    model_config = ConfigDict(frozen=True)

    schema_name: str
    object_name: str
    object_type: str
    owner: str | None = None
    size_bytes: int = 0


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
    """Tables in a schema with sizes, dead-tuple ratios and owners (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT s.schemaname AS schema_name, s.relname AS table_name,"
            " pg_get_userbyid(c.relowner) AS owner,"
            " pg_total_relation_size(c.oid) AS total_size_bytes,"
            " s.n_live_tup AS live_tuples, s.n_dead_tup AS dead_tuples"
            " FROM pg_stat_user_tables s"
            " JOIN pg_class c ON c.oid = s.relid"
            " WHERE s.schemaname = %s"
            " ORDER BY 4 DESC LIMIT %s",
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
                owner=str(row.get("owner")) if row.get("owner") else None,
                total_size_bytes=to_int(row.get("total_size_bytes")),
                live_tuples=live,
                dead_tuples=dead,
                dead_tuple_percent=dead_tuple_percent(live, dead),
            )
        )
    return result


@router.get("/schemas/{schema}/views", response_model=list[ViewInfo])
def list_views(schema: str, client: DbClient = Depends(resolve_client)) -> list[ViewInfo]:
    """Views and materialized views in a schema with owners (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT schemaname AS schema_name, viewname AS view_name, viewowner AS owner, false AS is_materialized"
            " FROM pg_views WHERE schemaname = %s"
            " UNION ALL"
            " SELECT schemaname, matviewname, matviewowner, true FROM pg_matviews WHERE schemaname = %s"
            " ORDER BY 2",
            (schema_name, schema_name),
        )
    return [
        ViewInfo(
            schema_name=str(row.get("schema_name")),
            view_name=str(row.get("view_name")),
            owner=str(row.get("owner")) if row.get("owner") else None,
            is_materialized=bool(row.get("is_materialized")),
        )
        for row in rows
    ]


@router.get("/schemas/{schema}/sequences", response_model=list[SequenceInfo])
def list_sequences(schema: str, client: DbClient = Depends(resolve_client)) -> list[SequenceInfo]:
    """Sequences in a schema with owners (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT n.nspname AS schema_name, c.relname AS sequence_name,"
            " pg_get_userbyid(c.relowner) AS owner, pg_relation_size(c.oid) AS size_bytes"
            " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE c.relkind = 'S' AND n.nspname = %s ORDER BY 2",
            (schema_name,),
        )
    return [
        SequenceInfo(
            schema_name=str(row.get("schema_name")),
            sequence_name=str(row.get("sequence_name")),
            owner=str(row.get("owner")) if row.get("owner") else None,
            size_bytes=to_int(row.get("size_bytes")),
        )
        for row in rows
    ]


@router.get("/schemas/{schema}/functions", response_model=list[FunctionInfo])
def list_functions(schema: str, client: DbClient = Depends(resolve_client)) -> list[FunctionInfo]:
    """Functions/procedures in a schema with owners (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT n.nspname AS schema_name, p.proname AS function_name,"
            " pg_get_userbyid(p.proowner) AS owner,"
            " pg_get_function_identity_arguments(p.oid) AS arguments, p.prokind AS kind"
            " FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace"
            " WHERE n.nspname = %s ORDER BY 2, 4",
            (schema_name,),
        )
    return [
        FunctionInfo(
            schema_name=str(row.get("schema_name")),
            function_name=str(row.get("function_name")),
            owner=str(row.get("owner")) if row.get("owner") else None,
            arguments=str(row.get("arguments")) if row.get("arguments") else None,
            kind=str(row.get("kind")) if row.get("kind") else None,
        )
        for row in rows
    ]


@router.get("/schemas/{schema}/objects", response_model=list[DbObjectInfo])
def list_objects(
    schema: str, limit: int = 200, client: DbClient = Depends(resolve_client)
) -> list[DbObjectInfo]:
    """All objects in a schema with owners and sizes (read-only)."""
    schema_name = validate_identifier(schema, what="schema name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT n.nspname AS schema_name, c.relname AS object_name,"
            " CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'"
            " WHEN 'S' THEN 'sequence' WHEN 'p' THEN 'partition' WHEN 'f' THEN 'foreign_table'"
            " ELSE c.relkind END AS object_type,"
            " pg_get_userbyid(c.relowner) AS owner, pg_relation_size(c.oid) AS size_bytes"
            " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = %s AND c.relkind IN ('r','v','m','S','p','f','i')"
            " ORDER BY 3, 2 LIMIT %s",
            (schema_name, min(limit, 1000)),
        )
    return [
        DbObjectInfo(
            schema_name=str(row.get("schema_name")),
            object_name=str(row.get("object_name")),
            object_type=str(row.get("object_type")),
            owner=str(row.get("owner")) if row.get("owner") else None,
            size_bytes=to_int(row.get("size_bytes")),
        )
        for row in rows
    ]


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
        owner_row = client.fetch_one(
            "SELECT pg_get_userbyid(c.relowner) AS owner"
            " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = %s AND c.relname = %s",
            (schema_name, table_name),
        )
    live = to_int((stats or {}).get("live_tuples"))
    dead = to_int((stats or {}).get("dead_tuples"))
    return TableDetail(
        schema_name=schema_name,
        table_name=table_name,
        owner=str((owner_row or {}).get("owner")) if (owner_row or {}).get("owner") else None,
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
