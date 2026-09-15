"""Table export/import via CSV (read for export, guarded for import)."""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from psycopg.sql import SQL, Identifier

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import DryRunResult, RiskLevel, audit, ensure_writes_allowed
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient, get_connection

router = APIRouter(prefix="/api/v1/tables", tags=["table-io"])


@router.get("/{schema}/{table}/export")
def export_table(
    schema: str,
    table: str,
    limit: int = 1000,
    format: str = "csv",
    client: DbClient = Depends(resolve_client),
) -> StreamingResponse:
    """Export table rows as CSV (read-only, capped)."""
    if format.lower() != "csv":
        raise HTTPException(status_code=400, detail="Only csv format is supported")
    if limit < 1 or limit > 10000:
        raise HTTPException(status_code=400, detail="limit must be 1..10000")
    from pgguardian.api.safety import validate_identifier

    schema_name = validate_identifier(schema, what="schema name")
    table_name = validate_identifier(table, what="table name")
    with mapped_errors(client.settings):
        client.ping()
        cols = client.fetch_all(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
            (schema_name, table_name),
        )
        if not cols:
            raise HTTPException(
                status_code=404, detail=f"Table {schema_name}.{table_name} not found"
            )
        # Safe: identifiers validated, use quoted strings
        safe_sql = f'SELECT * FROM "{schema_name}"."{table_name}" LIMIT %s'
        rows = client.fetch_all(safe_sql, (limit,))
    output = io.StringIO()
    writer = csv.writer(output)
    if rows:
        writer.writerow(list(rows[0].keys()))
        for row in rows:
            writer.writerow([row.get(k) for k in rows[0].keys()])
    else:
        writer.writerow([str(c.get("column_name")) for c in cols])
    csv_data = output.getvalue()
    return StreamingResponse(
        iter([csv_data]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{table_name}.csv"'},
    )


@router.post("/{schema}/{table}/import")
def import_table(
    schema: str,
    table: str,
    file: UploadFile,
    confirm: bool = False,
    dry_run: bool = False,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Import CSV into table via COPY (needs writes + confirm)."""
    ensure_writes_allowed(settings, "table.import")
    from pgguardian.api.safety import validate_identifier

    schema_name = validate_identifier(schema, what="schema name")
    table_name = validate_identifier(table, what="table name")
    if dry_run:
        return DryRunResult(
            action="table.import",
            risk=RiskLevel.MAINTENANCE,
            sql=[f"COPY {schema_name}.{table_name} FROM STDIN WITH CSV HEADER"],
            target=f"{schema_name}.{table_name}",
        )
    if not confirm:
        raise HTTPException(status_code=400, detail="table.import requires confirm=true")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    with mapped_errors(settings):
        client.ping()
        with get_connection(client.settings) as conn:
            with conn.cursor() as cur:
                copy_sql = SQL("COPY {}.{} FROM STDIN WITH (FORMAT CSV, HEADER TRUE)").format(
                    Identifier(schema_name), Identifier(table_name)
                )
                # psycopg copy needs string with connection
                sql_str = copy_sql.as_string(conn)
                with cur.copy(sql_str) as copy:
                    copy.write(content.decode("utf-8", errors="strict"))
    audit("table.import", f"{schema_name}.{table_name}", RiskLevel.MAINTENANCE, settings)
    return {"imported": f"{schema_name}.{table_name}", "bytes": len(content)}


@router.post("/{schema}/{table}/analyze")
def analyze_table(
    schema: str,
    table: str,
    confirm: bool = False,
    dry_run: bool = False,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """ANALYZE a single table (MAINTENANCE)."""
    ensure_writes_allowed(settings, "table.analyze")
    from pgguardian.api.safety import validate_identifier

    schema_name = validate_identifier(schema, what="schema name")
    table_name = validate_identifier(table, what="table name")
    sql = SQL("ANALYZE {}.{}").format(Identifier(schema_name), Identifier(table_name))
    if dry_run:
        return DryRunResult(
            action="table.analyze",
            risk=RiskLevel.MAINTENANCE,
            sql=[f"ANALYZE {schema_name}.{table_name}"],
            target=f"{schema_name}.{table_name}",
        )
    if not confirm:
        raise HTTPException(status_code=400, detail="table.analyze requires confirm=true")
    with mapped_errors(settings):
        client.ping()
        with get_connection(client.settings, statement_timeout=False) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
    audit("table.analyze", f"{schema_name}.{table_name}", RiskLevel.MAINTENANCE, settings)
    return {"analyzed": f"{schema_name}.{table_name}"}
