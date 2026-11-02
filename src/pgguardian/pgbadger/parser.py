"""Extract the numbers and normalized statements out of a pgBadger HTML report.

These reports come from production logs. The "Examples" blocks hold real parameter
values, which on a hospital or bank system means personal data, so they are never
read. Everything kept goes through ``mask_literals`` as well, because a few tables
(slowest individual queries, waits) carry statements with their real values.
"""

from __future__ import annotations

import html
import re
from typing import Any

MAX_SQL_CHARS = 8000

_TAG = re.compile(r"<[^>]+>")
_SQL_DIV = re.compile(r'<div id="query-[^"]*" class="sql[^"]*">(.*?)</div>', re.S)
_DURATION = re.compile(r"(\d+(?:\.\d+)?)(ms|d|h|m|s)")
_SIZE = re.compile(r"([\d.,]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)?")
_UNIT_MS = {"ms": 1, "s": 1000, "m": 60_000, "h": 3_600_000, "d": 86_400_000}
_UNIT_BYTES = {
    "B": 1,
    "KiB": 1024,
    "kB": 1024,
    "MiB": 1024**2,
    "MB": 1024**2,
    "GiB": 1024**3,
    "GB": 1024**3,
    "TiB": 1024**4,
    "TB": 1024**4,
}
_INVOLVED = re.compile(
    r"<b>(User|Application|Host):</b>\s*(.*?)\s*-\s*<b>Total duration:</b>\s*(\S+)\s*-\s*"
    r"<b>Times executed:</b>\s*([\d,]+)"
)
_HOUR_ROW = re.compile(
    r"<tr><td>[^<]*</td><td>(\d{2})</td><td>([\d,]+)</td>(?:<td>([^<]*)</td>)?"
)
_META = re.compile(r"<b>(Date|Database|User|Remote|Application):?</b>:?\s*([^<]*?)\s*(?:-\s*)?(?=<b>|\])")


class NotPgBadgerReport(ValueError):
    """The upload is not a pgBadger HTML report."""


def text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", fragment))).strip()


def to_int(value: str) -> int:
    digits = re.sub(r"[^\d]", "", value or "")
    return int(digits) if digits else 0


def duration_ms(value: str) -> int:
    """'5d9h18m23s' or '6s685ms' to milliseconds."""
    return int(
        sum(float(amount) * _UNIT_MS[unit] for amount, unit in _DURATION.findall(value or ""))
    )


def size_bytes(value: str) -> int:
    match = _SIZE.search(value or "")
    if not match:
        return 0
    return int(float(match.group(1).replace(",", "")) * _UNIT_BYTES.get(match.group(2) or "B", 1))


def mask_literals(sql: str) -> str:
    """Replace values with ?. Identifiers such as t1 or "Tablo2" stay readable."""
    masked = re.sub(r"\$([A-Za-z_]\w*)?\$.*?\$\1\$", "?", sql, flags=re.S)
    masked = re.sub(r"[EeBbXx]?'(?:[^']|'')*'", "?", masked)
    return re.sub(r"(?<![\w$.\"])\d+(?:\.\d+)?(?![\w\"])", "?", masked)


def mask_event(message: str) -> str:
    """Log messages quote values in Key (x)=(y) details and single quotes."""
    masked = re.sub(r"\(([^()]{0,200})\)=\([^)]*\)", r"(\1)=(?)", message)
    masked = re.sub(r"'(?:[^']|'')*'", "'?'", masked)
    return re.sub(r"\b\d{4,}\b", "#", masked)


def _clean_sql(fragment: str) -> str:
    return mask_literals(html.unescape(_TAG.sub("", fragment)).strip())[:MAX_SQL_CHARS]


class _Document:
    def __init__(self, raw: str) -> None:
        stripped = re.sub(r"<script\b.*?</script>", "", raw, flags=re.S | re.I)
        stripped = re.sub(r"<style\b.*?</style>", "", stripped, flags=re.S | re.I)
        self.body = stripped[max(stripped.find("<body"), 0) :]

    def section(self, name: str) -> str:
        start = self.body.find(f'id="{name}"')
        if start < 0:
            return ""
        # Skip this section's own tag, whose class may follow its id.
        opened = self.body.find(">", start) + 1
        following = [
            found
            for found in (
                self.body.find('class="analysis-item', opened),
                self.body.find('-slide"', opened),
            )
            if found > 0
        ]
        return self.body[start : min(following)] if following else self.body[start:]

    def figures(self, name: str) -> dict[str, str]:
        """Key figures of a section, as {label: value}."""
        pairs = re.findall(
            r'<span class="figure">(.*?)</span>\s*<span class="figure-label">(.*?)</span>',
            self.section(name),
            re.S,
        )
        return {text(label): text(value) for value, label in pairs}

    def rows(self, table_id: str) -> list[list[str]]:
        start = self.body.find(f'id="{table_id}"')
        if start < 0:
            return []
        end = self.body.find("</table>", start)
        result = []
        for row in re.split(r"<tr[^>]*>", self.body[start:end])[1:]:
            cells = [text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if cells and "NO DATASET" not in cells[0]:
                result.append(cells)
        return result


def _grouped_totals(rows: list[list[str]]) -> list[dict[str, Any]]:
    """Tables of 'name / request type / count / duration', one block per name."""
    groups: list[dict[str, Any]] = []
    for cells in rows:
        if len(cells) < 4:
            continue
        name, kind, count, duration = cells[:4]
        if name and kind == "Total":
            groups.append(
                {"name": name, "count": to_int(count), "ms": duration_ms(duration), "types": {}}
            )
        elif groups and kind:
            groups[-1]["types"][kind] = {"count": to_int(count), "ms": duration_ms(duration)}
    return groups


def _ranked_statements(doc: _Document, section: str, table: str) -> list[dict[str, Any]]:
    """Rows of a top-N statement table: the normalized SQL, hours, users and apps."""
    block = doc.section(section)
    marker = re.compile(rf'<td id="{table}-examples-details-rank-(\d+)">')
    spots = list(marker.finditer(block))
    rows = []
    previous_end = 0
    for index, spot in enumerate(spots):
        end = spots[index + 1].start() if index + 1 < len(spots) else len(block)
        # Examples live further down each row and are never touched.
        body = block[spot.end() : end].split('-examples-rank-', 1)[0]
        head = block[previous_end : spot.start()]
        previous_end = spot.end()
        row_start = head.rfind("<tr>")
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", head[row_start:], re.S)]
        sql = _SQL_DIV.search(body)
        hours = [
            {"hour": hour, "count": to_int(count), "ms": duration_ms(duration or "")}
            for hour, count, duration in _HOUR_ROW.findall(body)
        ]
        involved: dict[str, list[dict[str, Any]]] = {"User": [], "Application": [], "Host": []}
        tail = block[spot.end() : end]
        for kind, name, total, count in _INVOLVED.findall(tail):
            involved[kind].append(
                {"name": text(name), "ms": duration_ms(total), "count": to_int(count)}
            )
        rows.append(
            {
                "rank": int(spot.group(1)),
                "cells": cells[1:],
                "sql": _clean_sql(sql.group(1)) if sql else "",
                "hours": hours,
                "users": involved["User"],
                "apps": involved["Application"],
            }
        )
    return rows


def _time_queries(doc: _Document, section: str, table: str, order: str) -> list[dict[str, Any]]:
    result = []
    for row in _ranked_statements(doc, section, table):
        cells = row.pop("cells")
        if len(cells) < 5:
            continue
        if order == "stats_first":
            low, high, average, calls, total = cells[:5]
        elif order == "count_first":
            calls, total, low, high, average = cells[:5]
        else:
            total, calls, low, high, average = cells[:5]
        row.update(
            total_ms=duration_ms(total),
            calls=to_int(calls),
            min_ms=duration_ms(low),
            max_ms=duration_ms(high),
            avg_ms=duration_ms(average),
        )
        result.append(row)
    return result


def _single_statements(doc: _Document, section: str, table: str) -> list[dict[str, Any]]:
    """Slowest and most-waiting tables: one execution each, with its origin."""
    block = doc.section(section)
    result = []
    for match in re.finditer(
        rf"<tr>\s*<td>(\d+)</td>\s*<td>([^<]*)</td>\s*<td id=\"{table}[^\"]*rank-\d+\">(.*?)</td>",
        block,
        re.S,
    ):
        body = match.group(3)
        sql = _SQL_DIV.search(body)
        meta = {key.lower(): value for key, value in _META.findall(body)}
        result.append(
            {
                "rank": int(match.group(1)),
                "ms": duration_ms(match.group(2)),
                "sql": _clean_sql(sql.group(1)) if sql else "",
                "date": meta.get("date", ""),
                "database": meta.get("database", ""),
                "user": meta.get("user", ""),
                "host": meta.get("remote", ""),
                "app": meta.get("application", ""),
            }
        )
    return result


def _temp_queries(doc: _Document, section: str, table: str) -> list[dict[str, Any]]:
    result = []
    for row in _ranked_statements(doc, section, table):
        cells = row.pop("cells")
        if len(cells) >= 5:
            row.update(
                count=to_int(cells[0]),
                total_bytes=size_bytes(cells[1]),
                max_bytes=size_bytes(cells[3]),
                avg_bytes=size_bytes(cells[4]),
            )
        elif len(cells) >= 1:
            # The "largest" table has only a size column per statement.
            row.update(count=0, total_bytes=size_bytes(cells[0]), max_bytes=size_bytes(cells[0]))
        result.append(row)
    return result


def _events(doc: _Document) -> list[dict[str, Any]]:
    block = doc.section("most-frequent-errors-events")
    spots = list(re.finditer(r'<td id="most-frequent-errors-events-examples-details-rank-(\d+)">', block))
    events = []
    for index, spot in enumerate(spots):
        end = spots[index + 1].start() if index + 1 < len(spots) else len(block)
        row_start = block.rfind("<tr>", 0, spot.start())
        count = re.search(r"<td>\s*\d+\s*</td>\s*<td>\s*([\d,]+)", block[row_start:spot.start()])
        body = block[spot.end() : end]
        message = re.search(r'<p class="error-pre">(.*?)</p>', body, re.S)
        if not message:
            continue
        events.append(
            {
                "rank": int(spot.group(1)),
                "count": to_int(count.group(1)) if count else 0,
                "message": mask_event(text(message.group(1)))[:500],
                "hours": [
                    {"hour": hour, "count": to_int(c)} for hour, c, _ in _HOUR_ROW.findall(body)
                ],
            }
        )
    return events


def parse_report(raw_html: str) -> dict[str, Any]:
    """Everything the analyser needs, free of real parameter values."""
    version = re.search(r"pgBadger v([\d.]+)", raw_html)
    if not version or 'id="global-stats"' not in raw_html:
        raise NotPgBadgerReport("This is not a pgBadger HTML report.")
    doc = _Document(raw_html)
    stats = doc.figures("global-stats")
    return {
        "version": version.group(1),
        "stats": stats,
        "first_query": stats.get("First query", ""),
        "last_query": stats.get("Last query", ""),
        "total_query_ms": duration_ms(stats.get("Total query duration", "")),
        "prepared": doc.figures("prepared-queries-ratio"),
        "checkpoints": {
            "buffers": doc.figures("checkpoints-buffers"),
            "wal": doc.figures("checkpoints-files"),
            "distance": doc.figures("checkpoints-distance"),
            "causes": {r[0]: to_int(r[1]) for r in doc.rows("checkpoints-cause-table") if len(r) > 1},
        },
        "temp_figures": {
            **doc.figures("tempfiles-size"),
            **doc.figures("tempfiles-number"),
        },
        "by_type": [
            {"type": r[0], "count": to_int(r[1])} for r in doc.rows("queries-by-type-table") if len(r) > 1
        ],
        "by_database": _grouped_totals(doc.rows("queries-by-database-table")),
        "by_user": _grouped_totals(doc.rows("duration-by-user-table")),
        "by_host": _grouped_totals(doc.rows("queries-by-host-table")),
        "by_app": _grouped_totals(doc.rows("queries-by-application-table")),
        "locks": [
            {"type": r[0], "count": to_int(r[-3]), "ms": duration_ms(r[-2])}
            for r in doc.rows("locks-types-table")
            if len(r) >= 4 and r[0] and r[0] != "Total"
        ],
        "log_levels": {
            cells[0]: to_int(cells[1])
            for cells in (
                [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
                for row in re.split(r"<tr[^>]*>", doc.section("log-levels"))[1:]
            )
            if len(cells) > 1
        },
        "time_consuming": _time_queries(doc, "time-consuming-queries", "time-consuming-queries", "total_first"),
        "most_frequent": _time_queries(doc, "most-frequent-queries", "most-frequent-queries", "count_first"),
        "normalized_slowest": _time_queries(
            doc, "normalized-slowest-queries", "normalized-slowest-queries", "stats_first"
        ),
        "temp_most": _temp_queries(
            doc, "queries-generating-most-temporary-files", "queries-generating-most-temporary-files"
        ),
        "waiting_most": _single_statements(doc, "queries-that-waited-most", "queries-that-waited-most"),
        "slowest_single": _single_statements(doc, "slowest-individual-queries", "slowest-individual-queries"),
        "events": _events(doc),
    }
