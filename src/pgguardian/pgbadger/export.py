"""Shareable reports, whole or part by part, as HTML or Markdown."""

from __future__ import annotations

from html import escape
from typing import Any

SECTIONS = ("all", "summary", "findings", "backend", "ui", "db")
_ROLE_NAMES = {"backend": "Backend", "ui": "UI", "db": "DBA"}
_SEVERITY = {
    "tr": {"critical": "Kritik", "high": "Yüksek", "medium": "Orta", "low": "Düşük"},
    "en": {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"},
}
_STATUS = {
    "tr": {"todo": "Yapılacak", "doing": "Devam ediyor", "done": "Tamamlandı"},
    "en": {"todo": "To do", "doing": "In progress", "done": "Done"},
}
_WORDS = {
    "tr": {
        "title": "pgBadger Analiz Raporu",
        "summary": "Özet",
        "findings": "Sorunlar",
        "tasks": "İş listesi",
        "profile": "Profil",
        "file": "Kaynak dosya",
        "period": "Rapor dönemi",
        "queries": "Sorgu",
        "total": "Toplam süre",
        "peak": "Tepe",
        "events": "Olay",
        "locks": "Kilit beklemesi",
        "load": "Yük dağılımı",
        "kind": "Kaynak",
        "share": "Pay",
        "note": "SQL'lerdeki değerler ve hata mesajlarındaki veriler maskelenmiştir. Index önerileri adaydır, uygulamadan önce EXPLAIN ile doğrulayın.",
        "application": "Uygulama",
        "backup": "Yedekleme",
        "test": "Test uygulaması",
        "job": "Zamanlanmış iş",
        "tool": "Elle sorgu araçları",
        "unknown": "Adı bilinmeyen",
    },
    "en": {
        "title": "pgBadger Analysis Report",
        "summary": "Summary",
        "findings": "Findings",
        "tasks": "Tasks",
        "profile": "Profile",
        "file": "Source file",
        "period": "Report period",
        "queries": "Queries",
        "total": "Total time",
        "peak": "Peak",
        "events": "Events",
        "locks": "Lock waits",
        "load": "Load breakdown",
        "kind": "Source",
        "share": "Share",
        "note": "Values in SQL and data in error messages are masked. Index suggestions are candidates; verify them with EXPLAIN before applying.",
        "application": "Application",
        "backup": "Backups",
        "test": "Test application",
        "job": "Scheduled jobs",
        "tool": "Manual query tools",
        "unknown": "Unnamed",
    },
}

_STYLE = """
body{font:14px/1.5 system-ui,'Segoe UI',sans-serif;color:#1d1433;max-width:960px;margin:32px auto;padding:0 16px}
h1{color:#412C70;font-size:22px;margin-bottom:4px}h2{color:#412C70;font-size:17px;border-bottom:2px solid #EAE8FF;padding-bottom:4px;margin-top:28px}
h3{font-size:14px;margin:18px 0 4px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border:1px solid #DEDEDE;padding:4px 8px;text-align:left}th{background:#EAE8FF}
pre{background:#f6f5fb;border:1px solid #DEDEDE;border-radius:6px;padding:8px;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:none}
.sev{font-size:11px;font-weight:600;border-radius:4px;padding:1px 6px;background:#EAE8FF;color:#412C70}
.critical,.high{background:#fbe4e4;color:#a11f1f}.medium{background:#FFD499;color:#6d4300}
.meta,.note{color:#5a5170;font-size:12px}ul{padding-left:20px;margin:4px 0}.done{text-decoration:line-through;color:#6d6780}
@media print{pre{break-inside:avoid}h3{break-after:avoid}}
"""


def _visible(report: dict[str, Any], section: str) -> list[dict[str, Any]]:
    findings = report["findings"]
    if section in _ROLE_NAMES:
        return [f for f in findings if f["tasks"][section]]
    return findings


def _roles(section: str) -> tuple[str, ...]:
    return (section,) if section in _ROLE_NAMES else tuple(_ROLE_NAMES)


def to_html(report: dict[str, Any], section: str, lang: str) -> str:
    words = _WORDS[lang]
    summary = report["summary"]
    parts = [
        f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>{escape(words["title"])}</title>'
        f"<style>{_STYLE}</style></head><body>",
        f"<h1>{escape(words['title'])}{' - ' + _ROLE_NAMES[section] if section in _ROLE_NAMES else ''}</h1>",
        f'<p class="meta">{words["profile"]}: {escape(report["profile"])} · {words["file"]}: {escape(report["filename"])} · '
        f'{words["period"]}: {escape(str(summary.get("first_query")))} - {escape(str(summary.get("last_query")))}</p>',
        f'<p class="note">{escape(words["note"])}</p>',
    ]
    if section in ("all", "summary"):
        parts.append(f"<h2>{words['summary']}</h2><table>")
        for label, key in (
            ("queries", "queries"),
            ("total", "total_duration"),
            ("peak", "peak"),
            ("events", "events"),
            ("locks", "lock_wait"),
        ):
            parts.append(f"<tr><th>{words[label]}</th><td>{escape(str(summary.get(key)))}</td></tr>")
        parts.append(f"</table><h3>{words['load']}</h3><table><tr><th>{words['kind']}</th><th>{words['share']}</th><th>{words['total']}</th></tr>")
        for row in summary.get("load", []):
            parts.append(f"<tr><td>{escape(words.get(row['kind'], row['kind']))}</td><td>%{row['share']}</td><td>{escape(row['duration'])}</td></tr>")
        parts.append("</table>")
    if section != "summary":
        heading = words["tasks"] if section in _ROLE_NAMES else words["findings"]
        parts.append(f"<h2>{heading}</h2>")
        for finding in _visible(report, section):
            severity = finding["severity"]
            parts.append(
                f'<h3><span class="sev {severity}">{_SEVERITY[lang][severity]}</span> {escape(finding["title"])}</h3>'
                f'<p>{escape(finding["problem"])}</p>'
            )
            if finding["sql"]:
                parts.append(f"<pre>{escape(finding['sql'])}</pre>")
            if finding["messages"]:
                parts.append(f"<pre>{escape(chr(10).join(finding['messages']))}</pre>")
            for role in _roles(section):
                tasks = finding["tasks"][role]
                if not tasks:
                    continue
                parts.append(f"<strong>{_ROLE_NAMES[role]}</strong><ul>")
                for task in tasks:
                    css = ' class="done"' if task["status"] == "done" else ""
                    parts.append(f"<li{css}>[{_STATUS[lang][task['status']]}] {escape(task['text'])}</li>")
                parts.append("</ul>")
    parts.append("</body></html>")
    return "".join(parts)


def to_markdown(report: dict[str, Any], section: str, lang: str) -> str:
    words = _WORDS[lang]
    summary = report["summary"]
    suffix = f" - {_ROLE_NAMES[section]}" if section in _ROLE_NAMES else ""
    lines = [
        f"# {words['title']}{suffix}",
        "",
        f"{words['profile']}: {report['profile']} | {words['file']}: {report['filename']} | "
        f"{words['period']}: {summary.get('first_query')} - {summary.get('last_query')}",
        "",
        f"> {words['note']}",
        "",
    ]
    if section in ("all", "summary"):
        lines += [f"## {words['summary']}", ""]
        for label, key in (
            ("queries", "queries"),
            ("total", "total_duration"),
            ("peak", "peak"),
            ("events", "events"),
            ("locks", "lock_wait"),
        ):
            lines.append(f"- **{words[label]}:** {summary.get(key)}")
        lines += ["", f"### {words['load']}", "", f"| {words['kind']} | {words['share']} | {words['total']} |", "|---|---|---|"]
        for row in summary.get("load", []):
            lines.append(f"| {words.get(row['kind'], row['kind'])} | %{row['share']} | {row['duration']} |")
        lines.append("")
    if section != "summary":
        lines += [f"## {words['tasks'] if section in _ROLE_NAMES else words['findings']}", ""]
        for finding in _visible(report, section):
            lines += [f"### [{_SEVERITY[lang][finding['severity']]}] {finding['title']}", "", finding["problem"], ""]
            if finding["sql"]:
                lines += ["```sql", finding["sql"], "```", ""]
            if finding["messages"]:
                lines += ["```", *finding["messages"], "```", ""]
            for role in _roles(section):
                tasks = finding["tasks"][role]
                if tasks:
                    lines.append(f"**{_ROLE_NAMES[role]}**")
                    lines += [f"- [{'x' if t['status'] == 'done' else ' '}] {t['text']}" for t in tasks]
                    lines.append("")
    return "\n".join(lines)
