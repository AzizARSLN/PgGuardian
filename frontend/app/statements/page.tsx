"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeBlock } from "@/components/statements/code-block";
import { blocksToBytes, formatBytes, formatDuration } from "@/components/statements/format";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/api/queryKeys";
import { statementsApi, type StatementRow, type StatementSort, type StatementStatus } from "@/lib/api/statements";
import { cn } from "@/lib/utils";
import { useProfileStore } from "@/store/useProfileStore";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";

const PAGE_SIZE = 50;

const PRESETS: { key: string; sort: StatementSort }[] = [
  { key: "repeated", sort: "calls" },
  { key: "load", sort: "total_time" },
  { key: "slowest", sort: "mean_time" },
  { key: "io", sort: "io" },
  { key: "temp", sort: "temp" },
  { key: "wal", sort: "wal" },
];

const COLUMNS: { key: string; sort?: StatementSort; align?: "right" }[] = [
  { key: "statement" },
  { key: "calls", sort: "calls", align: "right" },
  { key: "callsPerMin", sort: "calls_per_min", align: "right" },
  { key: "total", sort: "total_time", align: "right" },
  { key: "mean", sort: "mean_time", align: "right" },
  { key: "load", sort: "load", align: "right" },
  { key: "rowsPerCall", sort: "rows_per_call", align: "right" },
  { key: "cache", align: "right" },
  { key: "temp", sort: "temp", align: "right" },
  { key: "wal", sort: "wal", align: "right" },
];

function SetupCard({ status }: { status: StatementStatus }) {
  const { t } = useI18n();
  const commands =
    status.state === "not_installed"
      ? `-- postgresql.conf (needs a restart)\nshared_preload_libraries = 'pg_stat_statements'\n\n-- then, in database "${status.database}"\nCREATE EXTENSION pg_stat_statements;`
      : `-- postgresql.conf (needs a restart)\nshared_preload_libraries = 'pg_stat_statements'`;
  return (
    <div className="max-w-2xl space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 text-warning" />
        {t(`statements.setup.${status.state}.title`, { database: status.database ?? "" })}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {t(`statements.setup.${status.state}.desc`)}
      </p>
      <CodeBlock code={commands} />
    </div>
  );
}

function Row({ row }: { row: StatementRow }) {
  const { formatNumber, t } = useI18n();
  const number = (value: number | null, digits = 0) =>
    value === null ? "–" : formatNumber(value, { maximumFractionDigits: digits });
  const load = row.load_pct ?? 0;
  return (
    <tr className="border-b border-border/60 transition-colors hover:bg-muted/50">
      <td className="max-w-[440px] px-2.5 py-1.5">
        <Link
          href={`/statements/${row.queryid}`}
          className="block truncate font-mono text-xs text-foreground hover:text-info"
          title={row.query}
        >
          {row.query.replace(/\s+/g, " ")}
        </Link>
        <span className="text-[11px] text-muted-foreground">
          {row.kind} · {row.users?.join(", ")}
        </span>
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono text-xs font-semibold">
        {number(row.calls)}
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono text-xs">
        {row.calls_per_min === null ? (
          <span title={t("statements.noRate")}>–</span>
        ) : (
          number(row.calls_per_min, 1)
        )}
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono text-xs">{formatDuration(row.total_ms)}</td>
      <td className="px-2.5 py-1.5 text-right font-mono text-xs">{formatDuration(row.mean_ms)}</td>
      <td className="px-2.5 py-1.5">
        <div className="flex items-center justify-end gap-1.5">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full", load >= 20 ? "bg-destructive" : load >= 5 ? "bg-warning" : "bg-primary")}
              style={{ width: `${Math.min(100, load)}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs">{load.toFixed(1)}%</span>
        </div>
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono text-xs">{number(row.rows_per_call, 1)}</td>
      <td
        className={cn(
          "px-2.5 py-1.5 text-right font-mono text-xs",
          row.cache_hit_pct !== null && row.cache_hit_pct < 90 && "text-warning"
        )}
      >
        {row.cache_hit_pct === null ? "–" : `${row.cache_hit_pct.toFixed(1)}%`}
      </td>
      <td className={cn("px-2.5 py-1.5 text-right font-mono text-xs", row.temp_written > 0 && "text-warning")}>
        {row.temp_written > 0 ? formatBytes(blocksToBytes(row.temp_written)) : "–"}
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono text-xs">
        {row.wal_bytes ? formatBytes(row.wal_bytes) : "–"}
      </td>
    </tr>
  );
}

export default function StatementsPage() {
  const { t, formatNumber, formatDate } = useI18n();
  const profile = useProfileStore((s) => s.selectedProfileName);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);

  const [sort, setSort] = React.useState<StatementSort>("calls");
  const [direction, setDirection] = React.useState<"asc" | "desc">("desc");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [minCalls, setMinCalls] = React.useState(2);
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = { sort, direction, limit: PAGE_SIZE, offset, min_calls: minCalls, search };
  const query = useQuery({
    queryKey: qk.statements.list(profile, filters),
    queryFn: () => statementsApi.list(filters),
    refetchInterval: autoRefresh ? 30_000 : false,
    placeholderData: (previous) => previous,
  });

  const toggleSort = (next: StatementSort) => {
    setOffset(0);
    if (next === sort) {
      setDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(next);
      setDirection("desc");
    }
  };

  const data = query.data;
  const status = data?.status;
  const total = data?.totals?.statements ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("statements.title")}</h1>
          {status && (
            <p className="font-mono text-xs text-muted-foreground">
              {status.profile ?? "env"} · {status.database}
              {status.stats_since &&
                ` · ${t("statements.since", { date: formatDate(status.stats_since) })}`}
            </p>
          )}
        </div>
        {data?.totals && (
          <p className="text-xs text-muted-foreground">
            {t("statements.totals", {
              statements: formatNumber(total),
              calls: formatNumber(data.totals.calls),
              time: formatDuration(data.totals.total_ms),
            })}
          </p>
        )}
      </div>

      {status?.warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          {t(`statements.warnings.${warning}`)}
        </p>
      ))}

      {query.isError && !data ? (
        <div className="rounded-lg border border-destructive/40 p-4 text-[13px]">
          <p className="mb-2 font-medium">{t("common.loadFailed")}</p>
          <p className="mb-3 text-muted-foreground">{(query.error as Error).message}</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : status && status.state !== "ok" ? (
        <SetupCard status={status} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    setSort(preset.sort);
                    setDirection("desc");
                    setOffset(0);
                  }}
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    sort === preset.sort
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t(`statements.presets.${preset.key}`)}
                </button>
              ))}
            </div>
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("statements.searchPlaceholder")}
                className="h-8 pl-8 font-mono text-xs"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("statements.minCalls")}
              <Input
                type="number"
                min={1}
                value={minCalls}
                onChange={(e) => {
                  setMinCalls(Math.max(1, Number(e.target.value) || 1));
                  setOffset(0);
                }}
                className="h-8 w-20 font-mono text-xs"
              />
            </label>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn(
                        "px-2.5 py-2 font-medium",
                        column.align === "right" ? "text-right" : "text-left"
                      )}
                    >
                      {column.sort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.sort!)}
                          className={cn(
                            "inline-flex items-center gap-1 uppercase hover:text-foreground",
                            sort === column.sort && "text-foreground"
                          )}
                        >
                          {t(`statements.columns.${column.key}`)}
                          {sort === column.sort &&
                            (direction === "desc" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            ))}
                        </button>
                      ) : (
                        t(`statements.columns.${column.key}`)
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((row) => <Row key={row.queryid} row={row} />)}
                {data && data.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-3 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      {t("statements.empty")}
                    </td>
                  </tr>
                )}
                {!data && query.isLoading && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="py-8">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {formatNumber(total)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t("statements.previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("statements.next")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
