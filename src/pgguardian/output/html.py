"""HTML report renderer: single-file professional report, no dependencies."""

from __future__ import annotations

import html
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from pgguardian.output.json import to_dict

_CSS = """
body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
header{background:#1e293b;padding:24px 32px;border-bottom:1px solid #334155}
h1{margin:0;font-size:24px}h1 span{color:#38bdf8}
.meta{color:#94a3b8;font-size:13px;margin-top:6px}
main{padding:24px 32px;max-width:1100px;margin:0 auto}
section{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:18px 20px;margin-bottom:18px}
h2{margin:0 0 12px;font-size:17px;color:#f1f5f9}
.score{font-size:40px;font-weight:700}.ok{color:#4ade80}.warn{color:#facc15}.crit{color:#f87171}.info{color:#38bdf8}.unk{color:#94a3b8}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #334155;vertical-align:top}
th{color:#94a3b8;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.badge-OK{background:#14532d;color:#bbf7d0}.badge-WARNING{background:#713f12;color:#fde68a}
.badge-CRITICAL{background:#7f1d1d;color:#fecaca}.badge-INFO{background:#0c4a6e;color:#bae6fd}
.badge-UNKNOWN{background:#334155;color:#cbd5e1}
.finding{border-left:4px solid #334155;padding:10px 14px;margin:10px 0;background:#0f172a;border-radius:0 8px 8px 0}
.finding.CRITICAL{border-color:#f87171}.finding.WARNING{border-color:#facc15}.finding.INFO{border-color:#38bdf8}
code{background:#0f172a;padding:1px 6px;border-radius:4px;font-size:12px}
.rec{color:#a5b4fc;font-size:13px}
footer{color:#64748b;font-size:12px;text-align:center;padding:18px}
"""


def _esc(value: Any) -> str:
    if value is None:
        return "<span style='color:#64748b'>n/a</span>"
    return html.escape(str(value))


def _badge(severity: Any) -> str:
    sev = str(severity or "UNKNOWN")
    return f"<span class='badge badge-{html.escape(sev)}'>{html.escape(sev)}</span>"


def _table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        return "<p style='color:#64748b'>No rows.</p>"
    head = "".join(f"<th>{html.escape(h)}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{_esc(cell)}</td>" for cell in row) + "</tr>" for row in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _score_class(status: str) -> str:
    return {"HEALTHY": "ok", "DEGRADED": "warn", "CRITICAL": "crit"}.get(status, "unk")


class HtmlRenderer:
    """Render the aggregated report dictionary as a standalone HTML page."""

    def render_report(self, report: BaseModel | dict[str, Any]) -> str:
        """Render the full report (as produced by the report command)."""
        data = to_dict(report)
        if not isinstance(data, dict):
            data = {"report": data}
        generated = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        raw_health = data.get("health")
        health: dict[str, Any] = dict(raw_health) if isinstance(raw_health, dict) else {}
        raw_findings = data.get("findings")
        findings: list[Any] = list(raw_findings) if isinstance(raw_findings, list) else []
        critical = [f for f in findings if isinstance(f, dict) and f.get("severity") == "CRITICAL"]
        warnings = [f for f in findings if isinstance(f, dict) and f.get("severity") == "WARNING"]

        sections: list[str] = []

        score = health.get("score", "n/a")
        status = health.get("status", "UNKNOWN")
        sections.append(
            "<section><h2>Health Score</h2>"
            f"<div class='score {_score_class(str(status))}'>{_esc(score)} / 100</div>"
            f"<div>Status: {_badge(status)}</div></section>"
        )

        summary_rows = [
            ["Metric", "Value"],
            ["Server", health.get("server_version", "n/a")],
            ["Database", health.get("database", "n/a")],
            ["Score", f"{score} / 100"],
            ["Status", status],
            [
                "Findings",
                f"{len(critical)} critical, {len(warnings)} warnings, {len(findings)} total",
            ],
        ]
        sections.append(
            f"<section><h2>Summary</h2>{_table(['Metric', 'Value'], summary_rows[1:])}</section>"
        )

        if health.get("checks"):
            raw_checks = health["checks"]
            check_rows: list[list[Any]] = []
            if isinstance(raw_checks, list):
                for check_item in raw_checks:
                    if isinstance(check_item, dict):
                        check_rows.append(
                            [
                                check_item.get("name"),
                                check_item.get("severity"),
                                check_item.get("value"),
                                check_item.get("threshold"),
                                check_item.get("description"),
                            ]
                        )
            sections.append(
                f"<section><h2>Health Checks</h2>{_table(['Check', 'Severity', 'Value', 'Threshold', 'Description'], check_rows)}</section>"
            )

        def _finding_block(items: list[Any], title: str) -> str:
            if not items:
                return f"<section><h2>{title}</h2><p style='color:#64748b'>None.</p></section>"
            blocks = ""
            for item in items:
                if not isinstance(item, dict):
                    continue
                blocks += (
                    f"<div class='finding {html.escape(str(item.get('severity', '')))}'>"
                    f"<div>{_badge(item.get('severity'))} <code>{_esc(item.get('code'))}</code> "
                    f"<strong>{_esc(item.get('title'))}</strong></div>"
                    f"<div>{_esc(item.get('description'))}</div>"
                    + (f"<div>Value: {_esc(item.get('value'))}</div>" if item.get("value") else "")
                    + (
                        f"<div class='rec'>Recommendation: {_esc(item.get('recommendation'))}</div>"
                        if item.get("recommendation")
                        else ""
                    )
                    + "</div>"
                )
            return f"<section><h2>{title}</h2>{blocks}</section>"

        sections.append(_finding_block(critical, "Critical Findings"))
        sections.append(_finding_block(warnings, "Warnings"))
        others = [
            f
            for f in findings
            if isinstance(f, dict) and f.get("severity") not in ("CRITICAL", "WARNING")
        ]
        sections.append(_finding_block(others, "Other Findings"))

        for key, title in [
            ("connections", "Connections"),
            ("queries", "Queries"),
            ("locks", "Locks"),
            ("storage", "Storage"),
            ("indexes", "Indexes"),
            ("maintenance", "Maintenance"),
        ]:
            payload_section = data.get(key)
            if payload_section is None:
                continue
            sections.append(
                f"<section><h2>{title}</h2><pre style='white-space:pre-wrap;font-size:12px'>"
                f"{html.escape(str(payload_section))[:6000]}</pre></section>"
            )

        return (
            "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>PgGuardian Report</title><style>{_CSS}</style></head><body>"
            "<header><h1><span>PgGuardian</span> Report</h1>"
            f"<div class='meta'>PostgreSQL diagnostics &middot; generated {generated}</div></header>"
            "<main>" + "".join(sections) + "</main>"
            "<footer>Generated by PgGuardian — read-only PostgreSQL diagnostics.</footer>"
            "</body></html>"
        )
