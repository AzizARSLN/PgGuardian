"""pgBadger reports per profile: upload, analyse, track tasks, share."""

from __future__ import annotations

import hashlib
import re
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from pgguardian.api.deps import mapped_errors, resolve_client, verify_token_OR_jwt
from pgguardian.database.connection import DbClient
from pgguardian.pgbadger.analyzer import analyse
from pgguardian.pgbadger.catalog import render_finding
from pgguardian.pgbadger.export import SECTIONS, to_html, to_markdown
from pgguardian.pgbadger.parser import NotPgBadgerReport, parse_report
from pgguardian.pgbadger.store import ReportStore

read_router = APIRouter(prefix="/api/v1/pgbadger", tags=["pgbadger"])
router = APIRouter(prefix="/api/v1/pgbadger", tags=["pgbadger"])

MAX_UPLOAD_BYTES = 200 * 1024 * 1024
Language = Literal["tr", "en"]


class TaskUpdate(BaseModel):
    status: Literal["todo", "doing", "done"]


def _profile(client: DbClient) -> str:
    return client.settings.active_profile or "(env)"


def _actor(claims: dict[str, Any] | None) -> str | None:
    return str(claims.get("email")) if claims else None


def _display_name(filename: str | None) -> str:
    name = PureWindowsPath(PurePosixPath(filename or "report.html").name).name
    return re.sub(r"[\x00-\x1f]", "", name)[:200] or "report.html"


def _report_or_404(store: ReportStore, report_id: str, client: DbClient) -> dict[str, Any]:
    report = store.get(report_id, _profile(client))
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found for this profile.")
    return report


def _render(store: ReportStore, report: dict[str, Any], lang: str) -> dict[str, Any]:
    analysis = report["analysis"]
    states = store.task_states(report["id"])
    findings = [render_finding(f, lang, states) for f in (analysis or {}).get("findings", [])]
    totals = {
        role: {
            "total": sum(len(f["tasks"][role]) for f in findings),
            "done": sum(1 for f in findings for t in f["tasks"][role] if t["status"] == "done"),
        }
        for role in ("backend", "ui", "db")
    }
    return {
        "id": report["id"],
        "profile": report["profile"],
        "filename": report["filename"],
        "sha256": report["sha256"],
        "size_bytes": report["size_bytes"],
        "uploaded_by": report["uploaded_by"],
        "uploaded_at": report["uploaded_at"],
        "period_start": report["period_start"],
        "period_end": report["period_end"],
        "analyzed_by": report["analyzed_by"],
        "analyzed_at": report["analyzed_at"],
        "analyzed": analysis is not None,
        "summary": (analysis or {}).get("summary"),
        "findings": findings,
        "totals": totals,
        "activity": store.activity(report["id"]),
    }


def _catalog_lookup(client: DbClient, database: str | None):
    """Read-only index check on the selected profile, when it has the report's database."""
    if not database:
        return None
    target = client.for_database(database)
    cache: dict[str, dict[str, Any] | None] = {}

    def lookup(table: str) -> dict[str, Any] | None:
        if table not in cache:
            cache[table] = _table_indexes(target, table)
        return cache[table]

    return lookup


def _table_indexes(client: DbClient, table: str) -> dict[str, Any] | None:
    row = client.fetch_one(
        "SELECT c.oid, n.nspname AS schema, c.reltuples::float8 AS rows FROM pg_class c"
        " JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE c.relname = %s AND c.relkind IN ('r', 'p') AND n.nspname !~ '^pg_'"
        " ORDER BY c.reltuples DESC LIMIT 1",
        (table,),
    )
    if not row:
        return None
    indexes = client.fetch_all(
        "SELECT (SELECT array_agg(a.attname::text ORDER BY k.ord)"
        "  FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)"
        "  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols"
        " FROM pg_index i WHERE i.indrelid = %s AND i.indisvalid",
        (row["oid"],),
    )
    return {
        "schema": row["schema"],
        "rows": row["rows"],
        "indexes": [index["cols"] for index in indexes if index["cols"]],
    }


@read_router.get("/reports")
def list_reports(client: DbClient = Depends(resolve_client)) -> list[dict]:
    """Reports uploaded for the selected profile."""
    return ReportStore().list(_profile(client))


@router.post("/reports", status_code=201)
def upload_report(
    file: UploadFile = File(...),
    client: DbClient = Depends(resolve_client),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> dict:
    """Parse a report and keep only masked data. The HTML itself is not stored."""
    raw = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Report is larger than 200 MB.")
    digest = hashlib.sha256(raw).hexdigest()
    store = ReportStore()
    profile = _profile(client)
    existing = store.find_by_hash(profile, digest)
    if existing:
        raise HTTPException(
            status_code=409, detail=f"This report was already uploaded for this profile: {existing}"
        )
    try:
        parsed = parse_report(raw.decode("utf-8", errors="replace"))
    except NotPgBadgerReport as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    report_id = store.add(
        profile=profile,
        filename=_display_name(file.filename),
        sha256=digest,
        size_bytes=len(raw),
        actor=_actor(claims),
        parsed=parsed,
    )
    return {"id": report_id}


@read_router.get("/reports/{report_id}")
def report_detail(
    report_id: str, lang: Language = "tr", client: DbClient = Depends(resolve_client)
) -> dict:
    store = ReportStore()
    return _render(store, _report_or_404(store, report_id, client), lang)


@router.post("/reports/{report_id}/analyze")
def analyze_report(
    report_id: str,
    lang: Language = "tr",
    client: DbClient = Depends(resolve_client),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> dict:
    """Run the review. Task progress of an earlier run stays attached."""
    store = ReportStore()
    report = _report_or_404(store, report_id, client)
    parsed = report["parsed"]
    databases = sorted(parsed.get("by_database", []), key=lambda d: d["ms"], reverse=True)
    with mapped_errors(client.settings):
        analysis = analyse(
            parsed, _catalog_lookup(client, databases[0]["name"] if databases else None)
        )
    store.save_analysis(report_id, report["profile"], _actor(claims), analysis)
    return _render(store, store.get(report_id, report["profile"]) or report, lang)


@router.put("/reports/{report_id}/tasks/{task_id:path}")
def update_task(
    report_id: str,
    task_id: str,
    body: TaskUpdate,
    client: DbClient = Depends(resolve_client),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> dict:
    store = ReportStore()
    report = _report_or_404(store, report_id, client)
    store.set_task(report_id, report["profile"], task_id, body.status, _actor(claims))
    return {"id": task_id, "status": body.status}


@read_router.get("/reports/{report_id}/export")
def export_report(
    report_id: str,
    section: str = "all",
    format: Literal["html", "md"] = "html",
    lang: Language = "tr",
    client: DbClient = Depends(resolve_client),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> Response:
    """Download the whole report or one part of it (summary, findings, a role)."""
    if section not in SECTIONS:
        raise HTTPException(status_code=400, detail=f"section must be one of {', '.join(SECTIONS)}.")
    store = ReportStore()
    report = _report_or_404(store, report_id, client)
    if report["analysis"] is None:
        raise HTTPException(status_code=409, detail="Run the analysis first.")
    view = _render(store, report, lang)
    body = to_html(view, section, lang) if format == "html" else to_markdown(view, section, lang)
    store.log(report_id, report["profile"], _actor(claims), "exported", f"{section}.{format}")
    media = "text/html" if format == "html" else "text/markdown"
    return Response(
        content=body,
        media_type=f"{media}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="pgbadger-{report_id}-{section}.{format}"'},
    )


@router.delete("/reports/{report_id}")
def delete_report(
    report_id: str,
    client: DbClient = Depends(resolve_client),
    claims: dict[str, Any] | None = Depends(verify_token_OR_jwt),
) -> dict:
    if not ReportStore().delete(report_id, _profile(client), _actor(claims)):
        raise HTTPException(status_code=404, detail="Report not found for this profile.")
    return {"deleted": report_id}
