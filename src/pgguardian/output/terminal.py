"""Rich terminal renderer: clean, professional, color-aware output."""

from __future__ import annotations

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from pgguardian.diagnostics.health import short_version
from pgguardian.models.connection import ConnectionReport
from pgguardian.models.diagnostic import DiagnosticFinding
from pgguardian.models.finding import Severity
from pgguardian.models.health import HealthReport
from pgguardian.models.index import IndexReport
from pgguardian.models.lock import LockReport
from pgguardian.models.maintenance import MaintenanceReport
from pgguardian.models.query import QueryReport
from pgguardian.models.storage import StorageReport
from pgguardian.utils import formatting as fmt

SEVERITY_STYLE = {
    Severity.OK: "green",
    Severity.INFO: "cyan",
    Severity.WARNING: "yellow",
    Severity.CRITICAL: "red",
    Severity.UNKNOWN: "dim",
}


class TerminalRenderer:
    """Render diagnostic models with Rich tables and panels."""

    def __init__(self, no_color: bool = False, quiet: bool = False) -> None:
        self.console = Console(no_color=no_color, quiet=quiet)
        self.quiet = quiet

    def _check_value(self, report: HealthReport, name: str) -> str:
        for check in report.checks:
            if check.name == name:
                return check.value or "n/a"
        return "n/a"

    def render_health(self, report: HealthReport) -> None:
        """Render the health overview panel."""
        self.console.print(Panel.fit("[bold cyan]PgGuardian[/]  [dim]PostgreSQL Diagnostics[/]"))
        grid = Table.grid(padding=(0, 3))
        grid.add_column(style="dim")
        grid.add_column()
        grid.add_row("PostgreSQL", short_version(report.server_version))
        grid.add_row("Database", report.database)
        grid.add_row("Connections", self._check_value(report, "connection_usage"))
        grid.add_row("Cache Hit Ratio", self._check_value(report, "cache_hit_ratio"))
        grid.add_row("Long Queries", self._check_value(report, "long_running_queries"))
        grid.add_row("Blocking Queries", self._check_value(report, "blocking_queries"))
        grid.add_row("Deadlocks", self._check_value(report, "deadlocks"))
        grid.add_row("", "")
        grid.add_row("Health Score", f"[bold]{report.score} / 100[/]")
        status_style = {"HEALTHY": "green", "DEGRADED": "yellow", "CRITICAL": "red"}.get(
            report.status, "dim"
        )
        grid.add_row("Status", f"[bold {status_style}]{report.status}[/]")
        self.console.print(grid)

        problems = [c for c in report.checks if c.severity in (Severity.WARNING, Severity.CRITICAL)]
        if problems:
            table = Table(title="Attention required", show_lines=False)
            table.add_column("Check")
            table.add_column("Severity")
            table.add_column("Value")
            table.add_column("Detail")
            for check in problems:
                style = SEVERITY_STYLE.get(check.severity, "")
                table.add_row(
                    check.name,
                    f"[{style}]{check.severity.value}[/]",
                    check.value or "n/a",
                    check.description,
                )
            self.console.print(table)

    def render_findings(self, findings: list[DiagnosticFinding]) -> None:
        """Render diagnose findings as panels grouped by severity."""
        if not findings:
            self.console.print("[green]No findings — database looks healthy.[/]")
            return
        order = [Severity.CRITICAL, Severity.WARNING, Severity.INFO, Severity.UNKNOWN]
        for severity in order:
            group = [f for f in findings if f.severity == severity]
            if not group:
                continue
            style = SEVERITY_STYLE.get(severity, "")
            self.console.print(f"\n[bold {style}]{severity.value} ({len(group)})[/]")
            for finding in group:
                body = finding.description
                if finding.value:
                    body += f"\nValue: {finding.value}"
                if finding.recommendation:
                    body += f"\n[dim]Recommendation:[/] {finding.recommendation}"
                self.console.print(
                    Panel(
                        body,
                        title=f"[bold]{finding.code}[/] — {finding.title}",
                        border_style=style or "dim",
                    )
                )

    def render_connections(self, report: ConnectionReport) -> None:
        """Render the connection summary and listing."""
        summary = report.summary
        self.console.print(
            f"[bold]Connections[/] {summary.current_connections} / {summary.max_connections} "
            f"({summary.usage_percent}%)  "
            f"[dim]active={summary.active} idle={summary.idle} "
            f"idle-in-txn={summary.idle_in_transaction} waiting={summary.waiting}[/]"
        )
        table = Table(show_lines=False)
        for header in ["PID", "User", "Database", "State", "Duration", "Wait", "Query"]:
            table.add_column(header)
        for conn in report.connections:
            wait = conn.wait_event or conn.wait_event_type or ""
            table.add_row(
                str(conn.pid),
                conn.user or "",
                conn.database or "",
                conn.state or "",
                fmt.format_duration(conn.query_duration_seconds),
                wait,
                fmt.truncate(conn.query, 90),
            )
        self.console.print(table)

    def render_queries(self, report: QueryReport) -> None:
        """Render active/long-running queries."""
        self.console.print(f"[bold]Queries[/] [dim]({report.kind}, showing {report.count})[/]")
        table = Table(show_lines=False)
        for header in ["PID", "Duration", "User", "Database", "State", "Wait", "Query"]:
            table.add_column(header)
        for query in report.queries:
            table.add_row(
                str(query.pid),
                fmt.format_duration(query.duration_seconds),
                query.user or "",
                query.database or "",
                query.state or "",
                query.wait_event or query.wait_event_type or "",
                fmt.truncate(query.query, 90),
            )
        self.console.print(table)

    def render_locks(self, report: LockReport) -> None:
        """Render blocking pairs and chains."""
        summary = report.summary
        self.console.print(
            f"[bold]Locks[/] {summary.total_locks} total, "
            f"[yellow]{summary.waiting_locks} waiting[/], "
            f"[red]{summary.blocking_pairs} blocking pair(s)[/]"
        )
        if report.chains:
            self.console.print(Panel("\n".join(report.chains), title="Blocking chains"))
        if report.locks:
            table = Table(show_lines=False)
            for header in ["Blocked", "Blocking", "Database", "Relation", "Mode", "Duration"]:
                table.add_column(header)
            for lock in report.locks:
                table.add_row(
                    f"{lock.blocked_pid} ({lock.blocked_user or ''})",
                    f"[red]{lock.blocking_pid} ({lock.blocking_user or ''})[/]",
                    lock.database or "",
                    lock.relation or "",
                    lock.blocking_mode or lock.lock_type or "",
                    fmt.format_duration(lock.blocking_duration_seconds),
                )
            self.console.print(table)
        else:
            self.console.print("[green]No blocking detected.[/]")

    def render_storage(self, report: StorageReport) -> None:
        """Render database / table / index sizes."""
        if report.databases:
            table = Table(title="Databases", show_lines=False)
            table.add_column("Database")
            table.add_column("Size", justify="right")
            for db in report.databases:
                table.add_row(db.database, fmt.format_bytes(db.size_bytes))
            self.console.print(table)
        if report.tables:
            table = Table(title=f"Largest tables (top {report.limit})", show_lines=False)
            for header in ["Schema", "Table", "Total", "Table", "Indexes"]:
                table.add_column(header)
            for table_item in report.tables:
                table.add_row(
                    table_item.schema_name or "",
                    table_item.table_name,
                    fmt.format_bytes(table_item.total_size_bytes),
                    fmt.format_bytes(table_item.table_size_bytes),
                    fmt.format_bytes(table_item.indexes_size_bytes),
                )
            self.console.print(table)
        if report.indexes:
            table = Table(title=f"Largest indexes (top {report.limit})", show_lines=False)
            for header in ["Schema", "Table", "Index", "Size"]:
                table.add_column(header)
            for index_item in report.indexes:
                table.add_row(
                    index_item.schema_name or "",
                    index_item.table_name or "",
                    index_item.index_name,
                    fmt.format_bytes(index_item.size_bytes),
                )
            self.console.print(table)

    def render_indexes(self, report: IndexReport) -> None:
        """Render index usage and potentially-unused candidates."""
        table = Table(title=f"Index usage (top {report.limit})", show_lines=False)
        for header in ["Schema", "Table", "Index", "Size", "Scans", "Read", "Fetched"]:
            table.add_column(header)
        for index in report.indexes:
            table.add_row(
                index.schema_name or "",
                index.table_name or "",
                index.index_name,
                fmt.format_bytes(index.index_size_bytes),
                fmt.format_count(index.index_scans),
                fmt.format_count(index.tuples_read),
                fmt.format_count(index.tuples_fetched),
            )
        self.console.print(table)
        if report.potentially_unused:
            warn = Table(title="Potentially unused indexes", show_lines=False)
            warn.add_column("Index")
            warn.add_column("Size", justify="right")
            warn.add_column("Scans", justify="right")
            for index in report.potentially_unused:
                warn.add_row(
                    f"{index.schema_name}.{index.index_name}"
                    if index.schema_name
                    else index.index_name,
                    fmt.format_bytes(index.index_size_bytes),
                    fmt.format_count(index.index_scans),
                )
            self.console.print(warn)
            self.console.print(
                "[dim]Low scan counts are only potentially unused: statistics may have "
                "been reset and workloads vary. Verify before acting.[/]"
            )

    def render_maintenance(self, report: MaintenanceReport) -> None:
        """Render VACUUM/ANALYZE state."""
        summary = report.summary
        self.console.print(
            f"[bold]Maintenance[/] {fmt.format_percent(summary.dead_tuple_percent)} dead tuples "
            f"({fmt.format_count(summary.total_dead_tuples)} dead / "
            f"{fmt.format_count(summary.total_live_tuples)} live), "
            f"{summary.tables_never_vacuumed} table(s) never vacuumed, "
            f"{summary.autovacuum_workers} autovacuum worker(s)"
        )
        table = Table(show_lines=False)
        for header in ["Table", "Live", "Dead", "Dead %", "Last Vacuum", "Last Analyze", "Status"]:
            table.add_column(header)
        for item in report.tables:
            style = SEVERITY_STYLE.get(item.status, "")
            name = f"{item.schema_name}.{item.table_name}" if item.schema_name else item.table_name
            last_vac = fmt.format_timestamp(item.last_autovacuum or item.last_vacuum)
            last_an = fmt.format_timestamp(item.last_autoanalyze or item.last_analyze)
            table.add_row(
                name,
                fmt.format_count(item.live_tuples),
                fmt.format_count(item.dead_tuples),
                fmt.format_percent(item.dead_tuple_percent),
                last_vac,
                last_an,
                f"[{style}]{item.status.value}[/]",
            )
        self.console.print(table)
