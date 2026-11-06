"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Copy,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Wrench,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IfWriter } from "@/components/role-guard";

import { api, ApiError } from "@/lib/api/client";
import {
  endpoints,
  type DuplicateIndexGroup,
  type IndexAlert,
  type IndexDetail,
  type IndexMonitorPoint,
  type IndexSuggestion,
  type MissingIndexCandidate,
  type RedundantIndex,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import useConfirm from "@/lib/hooks/useConfirm";
import { OpStopButton, useOpControl } from "@/lib/hooks/use-op-control";
import { useI18n, useT } from "@/lib/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { useProfileStore } from "@/store/useProfileStore";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";

const REPORT_LIMIT = 500;
const PRUNE_DAYS = 90;
const HISTORY_LIMIT = 100;
const LONG_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
const INDEXES_PREFIX = ["indexes"];

const CELL = "px-2 py-1.5 text-xs";
const HEAD = "h-8 px-2 text-xs";

type IndexSortKey =
  | "index"
  | "table"
  | "type"
  | "size"
  | "scans"
  | "seqScans"
  | "cacheHit"
  | "bloat";
type SortDir = "asc" | "desc";

const LEVEL_TONE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  info: "bg-info/15 text-info border-info/30",
};

function scoreTone(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-destructive";
}

function useFormatAgo() {
  const { locale } = useI18n();
  return React.useCallback(
    (value: string) => {
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return "-";
      const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const seconds = Math.round((time - Date.now()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 60) return format.format(seconds, "second");
      if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
      if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
      return format.format(Math.round(seconds / 86400), "day");
    },
    [locale]
  );
}

function indexSortValue(idx: IndexDetail, key: IndexSortKey): number | string {
  switch (key) {
    case "index":
      return idx.index_name;
    case "table":
      return `${idx.schema_name ?? ""}.${idx.table_name ?? ""}`;
    case "type":
      return idx.index_type ?? "";
    case "size":
      return idx.index_size_bytes;
    case "scans":
      return idx.index_scans;
    case "seqScans":
      return idx.table_seq_scan;
    case "cacheHit":
      return idx.cache_hit_percent ?? -1;
    case "bloat":
      return idx.bloat_percent ?? -1;
  }
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function useIndexAction(
  op: ReturnType<typeof useOpControl>,
  onDone: () => void
) {
  const t = useT();
  return useMutation({
    mutationFn: (vars: {
      path: "reindex" | "drop-index";
      body: Record<string, unknown>;
    }) => {
      const handle = op.begin(vars.path);
      return api.post(`/maintenance/${vars.path}`, vars.body, {
        timeout: LONG_ACTION_TIMEOUT_MS,
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: (_result, vars) => {
      toast.success(
        t("indexMonitor.toast.actionDone", {
          action:
            vars.path === "reindex"
              ? t("indexMonitor.actions.reindex")
              : t("indexMonitor.actions.drop"),
        })
      );
      onDone();
    },
    onError: (error, vars) => {
      if (error instanceof ApiError && error.status === 499) return;
      toast.error(
        t("indexMonitor.toast.actionFailed", {
          action:
            vars.path === "reindex"
              ? t("indexMonitor.actions.reindex")
              : t("indexMonitor.actions.drop"),
        })
      );
    },
    onSettled: () => op.end(),
  });
}

export default function IndexMonitorPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const qc = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const actionOp = useOpControl();
  const captureOp = useOpControl();
  const pruneOp = useOpControl();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const profile = useProfileStore((s) => s.selectedProfileName) ?? undefined;
  const refMs = autoRefresh ? pollInterval : false;

  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: IndexSortKey; dir: SortDir } | null>({
    key: "size",
    dir: "desc",
  });
  const [selected, setSelected] = useState<IndexDetail | null>(null);

  const reportQuery = useQuery({
    queryKey: qk.indexes.monitor(REPORT_LIMIT),
    queryFn: () => endpoints.getIndexMonitor(REPORT_LIMIT),
    refetchInterval: (q) => (q.state.status === "error" ? false : refMs),
  });
  const historyQuery = useQuery({
    queryKey: qk.indexes.history(profile, undefined, HISTORY_LIMIT),
    queryFn: () => endpoints.getIndexHistory(profile, undefined, HISTORY_LIMIT),
    enabled: tab === "history",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: INDEXES_PREFIX });

  const actionMutation = useIndexAction(actionOp, invalidate);

  const captureMutation = useMutation({
    mutationFn: () => {
      const handle = captureOp.begin("snapshot");
      return endpoints.captureIndexSnapshot(profile, {
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success(t("indexMonitor.toast.captured"));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 499) return;
      toast.error(t("indexMonitor.toast.captureFailed"));
    },
    onSettled: () => captureOp.end(),
  });

  const pruneMutation = useMutation({
    mutationFn: () => {
      const handle = pruneOp.begin("prune");
      return endpoints.pruneIndexHistory(PRUNE_DAYS, {
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(
        t("indexMonitor.toast.pruned", {
          removed: result.removed,
          days: result.keep_days,
        })
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status !== 499) {
        toast.error(t("indexMonitor.toast.pruneFailed"));
      }
    },
    onSettled: () => pruneOp.end(),
  });

  const report = reportQuery.data;
  const summary = report?.summary;
  const alerts = report?.alerts ?? [];
  const suggestions = report?.suggestions ?? [];

  const alertCounts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let info = 0;
    for (const a of alerts) {
      if (a.level === "critical") critical += 1;
      else if (a.level === "warning") warning += 1;
      else info += 1;
    }
    return { critical, warning, info };
  }, [alerts]);

  const toggleSort = (key: IndexSortKey) => {
    setSort((prev) => {
      if (prev && prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: key === "index" || key === "table" || key === "type" ? "asc" : "desc" };
    });
  };

  const filteredIndexes = useMemo(() => {
    const rows = report?.indexes ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((idx) =>
          [
            idx.index_name,
            idx.table_name,
            idx.schema_name,
            idx.index_type,
            idx.key_columns.join(" "),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : rows;
    if (!sort) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = compareValues(
        indexSortValue(a, sort.key),
        indexSortValue(b, sort.key)
      );
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [report, query, sort]);

  const runAction = async (suggestion: IndexSuggestion) => {
    if (!suggestion.schema_name || !suggestion.index_name) return;
    const isDrop = suggestion.kind.startsWith("drop_");
    const indexName = suggestion.index_name;
    const ok = await confirm({
      title: isDrop
        ? t("indexMonitor.confirm.dropTitle", { index: indexName })
        : t("indexMonitor.confirm.reindexTitle", { index: indexName }),
      description: isDrop
        ? t("indexMonitor.confirm.drop")
        : t("indexMonitor.confirm.reindex"),
      risk_level: isDrop ? "DANGEROUS" : "MAINTENANCE",
      confirm_name_required: isDrop,
      confirm_name_value: isDrop ? indexName : undefined,
      confirm_name_description: isDrop
        ? t("indexMonitor.confirm.dropName")
        : undefined,
      confirm_label: isDrop
        ? t("indexMonitor.actions.drop")
        : t("indexMonitor.actions.reindex"),
      cancel_label: t("common.cancel"),
    });
    if (!ok) return;
    if (isDrop) {
      actionMutation.mutate({
        path: "drop-index",
        body: {
          schema_name: suggestion.schema_name,
          index_name: indexName,
          confirm: true,
          confirm_name: indexName,
        },
      });
    } else {
      actionMutation.mutate({
        path: "reindex",
        body: {
          schema_name: suggestion.schema_name,
          index_name: indexName,
          concurrently: true,
          confirm: true,
        },
      });
    }
  };

  const handleReindexIndex = (idx: IndexDetail) => {
    if (!idx.schema_name) return;
    void (async () => {
      const ok = await confirm({
        title: t("indexMonitor.confirm.reindexTitle", { index: idx.index_name }),
        description: t("indexMonitor.confirm.reindex"),
        risk_level: "MAINTENANCE",
        confirm_label: t("indexMonitor.actions.reindex"),
        cancel_label: t("common.cancel"),
      });
      if (!ok) return;
      actionMutation.mutate({
        path: "reindex",
        body: {
          schema_name: idx.schema_name,
          index_name: idx.index_name,
          concurrently: true,
          confirm: true,
        },
      });
    })();
  };

  const handleDropIndex = (schema: string | null | undefined, indexName: string) => {
    if (!schema) return;
    void (async () => {
      const ok = await confirm({
        title: t("indexMonitor.confirm.dropTitle", { index: indexName }),
        description: t("indexMonitor.confirm.drop"),
        risk_level: "DANGEROUS",
        confirm_name_required: true,
        confirm_name_value: indexName,
        confirm_name_description: t("indexMonitor.confirm.dropName"),
        confirm_label: t("indexMonitor.actions.drop"),
        cancel_label: t("common.cancel"),
      });
      if (!ok) return;
      actionMutation.mutate({
        path: "drop-index",
        body: {
          schema_name: schema,
          index_name: indexName,
          confirm: true,
          confirm_name: indexName,
        },
      });
    })();
  };

  const handleCapture = async () => {
    const ok = await confirm({
      title: t("indexMonitor.capture"),
      description: t("indexMonitor.confirm.capture"),
      risk_level: "MAINTENANCE",
      confirm_label: t("indexMonitor.capture"),
      cancel_label: t("common.cancel"),
    });
    if (ok) captureMutation.mutate();
  };

  const handlePrune = async () => {
    const ok = await confirm({
      title: t("indexMonitor.confirm.pruneTitle"),
      description: t("indexMonitor.confirm.prune", { days: PRUNE_DAYS }),
      risk_level: "DANGEROUS",
      confirm_name_required: true,
      confirm_name_value: "prune",
      confirm_name_placeholder: t("indexMonitor.confirm.prunePlaceholder"),
      confirm_label: t("common.delete"),
      cancel_label: t("common.cancel"),
    });
    if (ok) pruneMutation.mutate();
  };

  const pollLabel = refMs
    ? t("indexMonitor.pollEvery", { seconds: refMs / 1000 })
    : t("indexMonitor.pollManual");

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Layers className="h-4 w-4 text-info" />
            {t("indexMonitor.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("indexMonitor.subtitle")}
            {report ? (
              <>
                {" · "}
                <span className="font-mono">{report.database}</span>
                {report.stats_age_hours != null ? (
                  <>
                    {" · "}
                    {t("indexMonitor.statsWindow", {
                      hours: formatNumber(report.stats_age_hours, {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => reportQuery.refetch()}
          >
            <RefreshCw
              className={cn(
                "mr-1.5 h-3.5 w-3.5",
                reportQuery.isFetching && "animate-spin"
              )}
            />
            {t("common.refresh")}
          </Button>
          <IfWriter>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              onClick={handlePrune}
              disabled={pruneMutation.isPending}
            >
              {pruneMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("indexMonitor.prune", { days: PRUNE_DAYS })}
            </Button>
            <OpStopButton control={pruneOp} className="h-8 text-xs" />
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleCapture}
              disabled={captureMutation.isPending}
            >
              {captureMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("indexMonitor.capture")}
            </Button>
            <OpStopButton control={captureOp} className="h-8 text-xs" />
          </IfWriter>
        </div>
      </div>

      {!reportQuery.isError && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {reportQuery.isLoading || !summary ? (
            [0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[70px] w-full rounded-md" />
            ))
          ) : (
            <>
              <StatTile
                icon={<TrendingUp className="h-3.5 w-3.5 text-success" />}
                label={t("indexMonitor.stats.healthScore")}
                value={formatNumber(summary.health_score)}
                tone={scoreTone(summary.health_score)}
                hint={
                  report
                    ? t("indexMonitor.stats.hint", {
                        total: formatNumber(summary.total_indexes),
                        size: formatBytes(summary.total_size_bytes, 1),
                      })
                    : "-"
                }
              />
              <StatTile
                icon={<Layers className="h-3.5 w-3.5 text-info" />}
                label={t("indexMonitor.stats.totalIndexes")}
                value={formatNumber(summary.total_indexes)}
                hint={formatBytes(summary.total_size_bytes, 1)}
              />
              <StatTile
                icon={<HardDrive className="h-3.5 w-3.5 text-warning" />}
                label={t("indexMonitor.stats.unusedSize")}
                value={formatBytes(summary.unused_size_bytes, 1)}
                tone={summary.unused_size_bytes > 0 ? "text-warning" : undefined}
                hint={t("indexMonitor.stats.hint", {
                  total: formatNumber(summary.unused_count),
                  size: formatBytes(summary.unused_size_bytes, 1),
                })}
              />
              <StatTile
                icon={<ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
                label={t("indexMonitor.stats.invalid")}
                value={formatNumber(summary.invalid_count)}
                tone={summary.invalid_count > 0 ? "text-destructive" : undefined}
                hint={`${t("indexMonitor.stats.duplicates")}: ${formatNumber(
                  summary.duplicate_group_count
                )}`}
              />
              <StatTile
                icon={<Layers className="h-3.5 w-3.5 text-warning" />}
                label={t("indexMonitor.stats.redundant")}
                value={formatNumber(summary.redundant_count)}
                tone={summary.redundant_count > 0 ? "text-warning" : undefined}
                hint={formatBytes(summary.redundant_size_bytes, 1)}
              />
              <StatTile
                icon={<HardDrive className="h-3.5 w-3.5 text-warning" />}
                label={t("indexMonitor.stats.bloat")}
                value={
                  summary.bloat_known
                    ? formatBytes(summary.bloat_size_bytes, 1)
                    : t("indexMonitor.stats.unknown")
                }
                hint={`${t("indexMonitor.stats.missing")}: ${formatNumber(
                  summary.missing_candidate_count
                )}`}
              />
            </>
          )}
        </div>
      )}

      {!reportQuery.isError && report && (alerts.length > 0 || suggestions.length > 0) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <AlertsPanel
            alerts={alerts}
            critical={alertCounts.critical}
            warning={alertCounts.warning}
            info={alertCounts.info}
          />
          <SuggestionsPanel
            suggestions={suggestions}
            busy={actionMutation.isPending}
            onApply={runAction}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t("indexMonitor.list.title")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("indexMonitor.list.subtitle", {
                shown: formatNumber(filteredIndexes.length),
                total: formatNumber(report?.indexes.length ?? 0),
                poll: pollLabel,
              })}
            </p>
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("indexMonitor.list.filterPlaceholder")}
            aria-label={t("common.search")}
            className="h-8 w-full text-xs sm:max-w-xs"
          />
        </div>

        {reportQuery.isError ? (
          <div className="flex items-center justify-between gap-2 px-3 py-3" role="alert">
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t("indexMonitor.loadFailed")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => reportQuery.refetch()}
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              {t("common.retry")}
            </Button>
          </div>
        ) : reportQuery.isLoading || !report ? (
          <div className="space-y-1.5 p-3" aria-label={t("common.loading")}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="p-3 pt-2">
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">
                {t("indexMonitor.tabs.all")} ({formatNumber(report.indexes.length)})
              </TabsTrigger>
              <TabsTrigger value="duplicates">
                {t("indexMonitor.tabs.duplicates")} ({formatNumber(report.duplicates.length)})
              </TabsTrigger>
              <TabsTrigger value="redundant">
                {t("indexMonitor.tabs.redundant")} ({formatNumber(report.redundant.length)})
              </TabsTrigger>
              <TabsTrigger value="invalid">
                {t("indexMonitor.tabs.invalid")} ({formatNumber(report.invalid.length)})
              </TabsTrigger>
              <TabsTrigger value="missing">
                {t("indexMonitor.tabs.missing")} ({formatNumber(report.missing.length)})
              </TabsTrigger>
              <TabsTrigger value="history">{t("indexMonitor.tabs.history")}</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-2">
              <IndexTable
                indexes={filteredIndexes}
                sort={sort}
                onToggle={toggleSort}
                total={report.indexes.length}
                onSelect={setSelected}
                onReindex={handleReindexIndex}
                onDrop={handleDropIndex}
                busy={actionMutation.isPending}
              />
            </TabsContent>

            <TabsContent value="duplicates" className="mt-2">
              <DuplicatesTable
                groups={report.duplicates}
                onDrop={handleDropIndex}
                busy={actionMutation.isPending}
              />
            </TabsContent>

            <TabsContent value="redundant" className="mt-2">
              <RedundantTable
                rows={report.redundant}
                onDrop={handleDropIndex}
                busy={actionMutation.isPending}
              />
            </TabsContent>

            <TabsContent value="invalid" className="mt-2">
              <InvalidTable
                rows={report.invalid}
                onReindex={handleReindexIndex}
                busy={actionMutation.isPending}
              />
            </TabsContent>

            <TabsContent value="missing" className="mt-2">
              <MissingTable rows={report.missing} />
            </TabsContent>

            <TabsContent value="history" className="mt-2">
              <HistoryTable
                points={historyQuery.data ?? []}
                loading={historyQuery.isLoading}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {selected ? (
        <DetailDrawer
          idx={selected}
          onClose={() => setSelected(null)}
          onReindex={handleReindexIndex}
          onDrop={handleDropIndex}
          busy={actionMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("font-mono text-base font-semibold", tone)}>{value}</div>
      <div className="truncate text-xs text-muted-foreground" title={hint}>
        {hint}
      </div>
    </div>
  );
}

function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="max-h-80 overflow-y-auto p-2">{children}</div>
    </div>
  );
}

function AlertsPanel({
  alerts,
  critical,
  warning,
  info,
}: {
  alerts: IndexAlert[];
  critical: number;
  warning: number;
  info: number;
}) {
  const t = useT();
  return (
    <PanelShell
      title={t("indexMonitor.alerts.title")}
      subtitle={t("indexMonitor.alerts.subtitle", { critical, warning, info })}
    >
      {alerts.length === 0 ? (
        <EmptyOK message={t("indexMonitor.alerts.empty")} />
      ) : (
        <ul className="space-y-1.5">
          {alerts.map((a, i) => (
            <li
              key={`${a.code}-${i}`}
              className={cn(
                "flex gap-2 rounded-md border px-2.5 py-2",
                LEVEL_TONE[a.level] ?? "border-border"
              )}
            >
              <span className="mt-0.5 shrink-0">
                {a.level === "critical" ? (
                  <ShieldAlert className="h-3.5 w-3.5" />
                ) : a.level === "warning" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <Info className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold">{a.title}</div>
                <div className="text-xs text-muted-foreground">{a.detail}</div>
                {a.target ? (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {a.target}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

function SuggestionsPanel({
  suggestions,
  busy,
  onApply,
}: {
  suggestions: IndexSuggestion[];
  busy: boolean;
  onApply: (s: IndexSuggestion) => void;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  return (
    <PanelShell
      title={t("indexMonitor.suggestions.title")}
      subtitle={t("indexMonitor.suggestions.subtitle", {
        count: formatNumber(suggestions.length),
      })}
    >
      {suggestions.length === 0 ? (
        <EmptyOK message={t("indexMonitor.suggestions.empty")} />
      ) : (
        <ul className="space-y-1.5">
          {suggestions.map((s, i) => {
            const actionable = s.kind !== "create_missing" && !!s.schema_name && !!s.index_name;
            return (
              <li
                key={`${s.kind}-${s.index_name ?? i}-${i}`}
                className="rounded-md border border-border px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] font-semibold">
                    {t(`indexMonitor.suggestions.kind.${s.kind}`)}
                  </Badge>
                  <span className="text-xs font-semibold">{s.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {t("indexMonitor.suggestions.confidence")}:{" "}
                    {t(`indexMonitor.suggestions.confidenceLevel.${s.confidence}`)}
                  </span>
                  {s.estimated_reclaim_bytes > 0 ? (
                    <span>
                      {t("indexMonitor.suggestions.reclaim", {
                        size: formatBytes(s.estimated_reclaim_bytes, 1),
                      })}
                    </span>
                  ) : null}
                </div>
                {s.command ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
                      {s.command}
                    </code>
                    <CopyButton text={s.command} />
                    {actionable ? (
                      <IfWriter>
                        <Button
                          size="sm"
                          variant={s.kind.startsWith("drop_") ? "destructive" : "outline"}
                          className="h-6 text-[11px]"
                          disabled={busy}
                          onClick={() => onApply(s)}
                        >
                          {s.kind.startsWith("drop_") ? (
                            <Trash2 className="mr-1 h-3 w-3" />
                          ) : (
                            <Wrench className="mr-1 h-3 w-3" />
                          )}
                          {t("indexMonitor.suggestions.action")}
                        </Button>
                      </IfWriter>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {t("indexMonitor.suggestions.manual")}
                      </span>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

function EmptyOK({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-4 text-xs text-success">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  onToggle,
  className,
}: {
  label: string;
  sortKey: IndexSortKey;
  sort: { key: IndexSortKey; dir: SortDir } | null;
  onToggle: (key: IndexSortKey) => void;
  className?: string;
}) {
  const dir = sort && sort.key === sortKey ? sort.dir : null;
  return (
    <TableHead
      className={cn(HEAD, "cursor-pointer select-none hover:text-foreground", className)}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {dir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : dir === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </TableHead>
  );
}

function Flags({ idx }: { idx: IndexDetail }) {
  const t = useT();
  const flags: { key: string; tone: string }[] = [];
  if (!idx.is_valid || !idx.is_ready) {
    flags.push({ key: t("indexMonitor.flags.invalid"), tone: "text-destructive border-destructive/40" });
  }
  if (idx.is_primary) flags.push({ key: t("indexMonitor.flags.primary"), tone: "" });
  if (idx.is_unique && !idx.is_primary) flags.push({ key: t("indexMonitor.flags.unique"), tone: "" });
  if (idx.is_partial) flags.push({ key: t("indexMonitor.flags.partial"), tone: "" });
  if (idx.is_expression) flags.push({ key: t("indexMonitor.flags.expression"), tone: "" });
  if (idx.has_include) flags.push({ key: t("indexMonitor.flags.include"), tone: "" });
  if (idx.potentially_unused) {
    flags.push({ key: t("indexMonitor.flags.unused"), tone: "text-warning border-warning/40" });
  }
  if (flags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f.key} variant="outline" className={cn("text-[10px]", f.tone)}>
          {f.key}
        </Badge>
      ))}
    </div>
  );
}

function pct(value: number | null | undefined, tone = true): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const cls =
    tone && value >= 50
      ? "text-destructive font-semibold"
      : tone && value >= 30
        ? "text-warning font-semibold"
        : "";
  return <span className={cls}>{value.toFixed(1)}%</span>;
}

function IndexTable({
  indexes,
  sort,
  onToggle,
  total,
  onSelect,
  onReindex,
  onDrop,
  busy,
}: {
  indexes: IndexDetail[];
  sort: { key: IndexSortKey; dir: SortDir } | null;
  onToggle: (key: IndexSortKey) => void;
  total: number;
  onSelect: (idx: IndexDetail) => void;
  onReindex: (idx: IndexDetail) => void;
  onDrop: (schema: string | null | undefined, index: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  if (indexes.length === 0) {
    return (
      <Empty message={t(total === 0 ? "indexMonitor.list.emptyTitle" : "indexMonitor.list.noMatchTitle")} hint={t(total === 0 ? "indexMonitor.list.emptyHint" : "indexMonitor.list.noMatchHint")} />
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label={t("indexMonitor.columns.index")} sortKey="index" sort={sort} onToggle={onToggle} />
            <SortHead label={t("indexMonitor.columns.table")} sortKey="table" sort={sort} onToggle={onToggle} />
            <TableHead className={HEAD}>{t("indexMonitor.columns.columns")}</TableHead>
            <SortHead label={t("indexMonitor.columns.type")} sortKey="type" sort={sort} onToggle={onToggle} />
            <SortHead label={t("indexMonitor.columns.size")} sortKey="size" sort={sort} onToggle={onToggle} className="text-right" />
            <SortHead label={t("indexMonitor.columns.scans")} sortKey="scans" sort={sort} onToggle={onToggle} className="text-right" />
            <SortHead label={t("indexMonitor.columns.seqScans")} sortKey="seqScans" sort={sort} onToggle={onToggle} className="text-right" />
            <SortHead label={t("indexMonitor.columns.cacheHit")} sortKey="cacheHit" sort={sort} onToggle={onToggle} className="text-right" />
            <SortHead label={t("indexMonitor.columns.bloat")} sortKey="bloat" sort={sort} onToggle={onToggle} className="text-right" />
            <TableHead className={HEAD}>{t("indexMonitor.columns.flags")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {indexes.map((idx) => (
            <TableRow
              key={`${idx.schema_name}.${idx.table_name}.${idx.index_name}`}
              className="cursor-pointer"
              onClick={() => onSelect(idx)}
            >
              <TableCell className={cn(CELL, "font-mono")}>
                <div className="flex items-center gap-1">
                  {!idx.is_valid || !idx.is_ready ? (
                    <ShieldAlert className="h-3 w-3 shrink-0 text-destructive" />
                  ) : null}
                  {idx.index_name}
                </div>
              </TableCell>
              <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                {idx.schema_name}.{idx.table_name}
              </TableCell>
              <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                <span className="line-clamp-1 max-w-[16rem]" title={idx.key_columns.join(", ")}>
                  {idx.key_columns.join(", ") || "—"}
                </span>
              </TableCell>
              <TableCell className={cn(CELL, "text-muted-foreground")}>
                {idx.index_type ?? "—"}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>
                {formatBytes(idx.index_size_bytes, 1)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono", idx.potentially_unused && "text-warning")}>
                {formatNumber(idx.index_scans)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                {formatNumber(idx.table_seq_scan)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>
                {idx.cache_hit_percent == null
                  ? "—"
                  : `${idx.cache_hit_percent.toFixed(1)}%`}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>
                {pct(idx.bloat_percent)}
              </TableCell>
              <TableCell className={CELL}>
                <div className="flex items-center justify-between gap-2">
                  <Flags idx={idx} />
                  <IfWriter>
                    <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        title={t("indexMonitor.actions.reindex")}
                        disabled={busy}
                        onClick={() => onReindex(idx)}
                      >
                        <Wrench className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        title={t("indexMonitor.actions.drop")}
                        disabled={busy}
                        onClick={() => onDrop(idx.schema_name, idx.index_name)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </IfWriter>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DuplicatesTable({
  groups,
  onDrop,
  busy,
}: {
  groups: DuplicateIndexGroup[];
  onDrop: (schema: string | null | undefined, index: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  if (groups.length === 0) {
    return <Empty message={t("indexMonitor.duplicates.empty")} />;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("indexMonitor.duplicates.hint")}</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>{t("indexMonitor.columns.table")}</TableHead>
              <TableHead className={HEAD}>{t("indexMonitor.columns.columns")}</TableHead>
              <TableHead className={HEAD}>{t("indexMonitor.columns.kept")}</TableHead>
              <TableHead className={HEAD}>{t("indexMonitor.columns.dropList")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.size")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g, i) => (
              <TableRow key={`${g.schema_name}.${g.table_name}-${i}`}>
                <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                  {g.schema_name}.{g.table_name}
                </TableCell>
                <TableCell className={cn(CELL, "font-mono")}>
                  {g.columns.join(", ") || "—"}
                  {g.predicate ? (
                    <span className="text-muted-foreground"> WHERE {g.predicate}</span>
                  ) : null}
                </TableCell>
                <TableCell className={cn(CELL, "font-mono text-success")}>
                  {g.recommended_keep ?? "—"}
                </TableCell>
                <TableCell className={CELL}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {g.recommended_drop.map((name) => (
                      <span key={name} className="inline-flex items-center gap-1">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{name}</code>
                        <IfWriter>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            title={t("indexMonitor.actions.drop")}
                            disabled={busy}
                            onClick={() => onDrop(g.schema_name, name)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </IfWriter>
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className={cn(CELL, "text-right font-mono")}>
                  {formatBytes(g.total_size_bytes, 1)}
                  <span className="ml-1 text-muted-foreground">({formatNumber(g.index_names.length)})</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RedundantTable({
  rows,
  onDrop,
  busy,
}: {
  rows: RedundantIndex[];
  onDrop: (schema: string | null | undefined, index: string) => void;
  busy: boolean;
}) {
  const t = useT();
  if (rows.length === 0) {
    return <Empty message={t("indexMonitor.redundant.empty")} />;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("indexMonitor.redundant.hint")}</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>{t("indexMonitor.columns.index")}</TableHead>
              <TableHead className={HEAD}>{t("indexMonitor.columns.table")}</TableHead>
              <TableHead className={HEAD}>{t("indexMonitor.columns.coveredBy")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.size")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.schema_name}.${r.index_name}`}>
                <TableCell className={cn(CELL, "font-mono")}>{r.index_name}</TableCell>
                <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                  {r.schema_name}.{r.table_name}
                </TableCell>
                <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>{r.covered_by}</TableCell>
                <TableCell className={cn(CELL, "text-right font-mono")}>{formatBytes(r.size_bytes, 1)}</TableCell>
                <TableCell className={cn(CELL, "text-right")}>
                  <IfWriter>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      title={t("indexMonitor.actions.drop")}
                      disabled={busy}
                      onClick={() => onDrop(r.schema_name, r.index_name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </IfWriter>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function InvalidTable({
  rows,
  onReindex,
  busy,
}: {
  rows: IndexDetail[];
  onReindex: (idx: IndexDetail) => void;
  busy: boolean;
}) {
  const t = useT();
  if (rows.length === 0) {
    return <Empty message={t("indexMonitor.invalid.empty")} />;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>{t("indexMonitor.columns.index")}</TableHead>
            <TableHead className={HEAD}>{t("indexMonitor.columns.table")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.size")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((idx) => (
            <TableRow key={`${idx.schema_name}.${idx.index_name}`}>
              <TableCell className={cn(CELL, "font-mono")}>
                <span className="inline-flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3 text-destructive" />
                  {idx.index_name}
                </span>
              </TableCell>
              <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                {idx.schema_name}.{idx.table_name}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>
                {formatBytes(idx.index_size_bytes, 1)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right")}>
                <IfWriter>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    title={t("indexMonitor.actions.reindex")}
                    disabled={busy}
                    onClick={() => onReindex(idx)}
                  >
                    <Wrench className="mr-1 h-3 w-3" />
                    {t("indexMonitor.actions.reindex")}
                  </Button>
                </IfWriter>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MissingTable({ rows }: { rows: MissingIndexCandidate[] }) {
  const t = useT();
  const { formatNumber } = useI18n();
  if (rows.length === 0) {
    return <Empty message={t("indexMonitor.missing.empty")} />;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("indexMonitor.missing.hint")}</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>{t("indexMonitor.columns.table")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.seqScans")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.scans")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.liveTuples")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.tableSize")}</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.indexCount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={`${m.schema_name}.${m.table_name}`}>
                <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                  {m.schema_name}.{m.table_name}
                </TableCell>
                <TableCell className={cn(CELL, "text-right font-mono text-warning")}>
                  {formatNumber(m.seq_scan)}
                </TableCell>
                <TableCell className={cn(CELL, "text-right font-mono")}>
                  {formatNumber(m.idx_scan)}
                </TableCell>
                <TableCell className={cn(CELL, "text-right font-mono")}>
                  {formatNumber(m.live_tuples)}
                </TableCell>
                <TableCell className={cn(CELL, "text-right font-mono")}>
                  {formatBytes(m.table_size_bytes, 1)}
                </TableCell>
                <TableCell className={cn(CELL, "text-right font-mono")}>
                  {formatNumber(m.index_count)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function HistoryTable({
  points,
  loading,
}: {
  points: IndexMonitorPoint[];
  loading: boolean;
}) {
  const t = useT();
  const { formatNumber, formatDate } = useI18n();
  const formatAgo = useFormatAgo();
  if (loading) {
    return (
      <div className="space-y-1.5" aria-label={t("common.loading")}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (points.length === 0) {
    return <Empty message={t("indexMonitor.history.empty")} hint={t("indexMonitor.history.hint")} />;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>{t("indexMonitor.columns.taken")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.healthScore")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.totalIndexes")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.totalSize")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.unusedSize")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.invalid")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.duplicates")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.redundant")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.bloatSize")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.missing")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.criticalAlerts")}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{t("indexMonitor.columns.warningAlerts")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.id}>
              <TableCell className={cn(CELL, "whitespace-nowrap font-mono")}>
                <div>{formatDate(p.taken_at)}</div>
                <div className="text-muted-foreground">{formatAgo(p.taken_at)}</div>
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono font-semibold", scoreTone(p.health_score))}>
                {formatNumber(p.health_score)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatNumber(p.total_indexes)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatBytes(p.total_size_bytes, 1)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatBytes(p.unused_size_bytes, 1)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono", p.invalid_count > 0 && "text-destructive")}>
                {formatNumber(p.invalid_count)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatNumber(p.duplicate_group_count)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatNumber(p.redundant_count)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatBytes(p.bloat_size_bytes, 1)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono")}>{formatNumber(p.missing_candidate_count)}</TableCell>
              <TableCell className={cn(CELL, "text-right font-mono", p.critical_alerts > 0 && "text-destructive")}>
                {formatNumber(p.critical_alerts)}
              </TableCell>
              <TableCell className={cn(CELL, "text-right font-mono", p.warning_alerts > 0 && "text-warning")}>
                {formatNumber(p.warning_alerts)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("indexMonitor.suggestions.copied"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable outside a secure context.
    }
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 w-6 shrink-0 p-0"
      title={t("indexMonitor.suggestions.copyCommand")}
      onClick={onCopy}
    >
      {copied ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="px-3 py-6 text-center">
      <p className="text-sm font-medium">{message}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DetailDrawer({
  idx,
  onClose,
  onReindex,
  onDrop,
  busy,
}: {
  idx: IndexDetail;
  onClose: () => void;
  onReindex: (idx: IndexDetail) => void;
  onDrop: (schema: string | null | undefined, index: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label={t("indexMonitor.detail.title")}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="truncate font-mono text-sm font-semibold">{idx.index_name}</h2>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {idx.schema_name}.{idx.table_name}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IfWriter>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => onReindex(idx)}
              >
                <Wrench className="mr-1 h-3 w-3" />
                {t("indexMonitor.actions.reindex")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => onDrop(idx.schema_name, idx.index_name)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                {t("indexMonitor.actions.drop")}
              </Button>
            </IfWriter>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t("indexMonitor.detail.close")}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-1.5">
            <Flags idx={idx} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DetailMetric label={t("indexMonitor.detail.size")} value={formatBytes(idx.index_size_bytes, 1)} />
            <DetailMetric label={t("indexMonitor.detail.indexType")} value={idx.index_type ?? "—"} />
            <DetailMetric label={t("indexMonitor.detail.scans")} value={formatNumber(idx.index_scans)} />
            <DetailMetric label={t("indexMonitor.detail.tableSeqScan")} value={formatNumber(idx.table_seq_scan)} />
            <DetailMetric label={t("indexMonitor.detail.tuplesRead")} value={formatNumber(idx.tuples_read)} />
            <DetailMetric label={t("indexMonitor.detail.tuplesFetched")} value={formatNumber(idx.tuples_fetched)} />
            <DetailMetric
              label={t("indexMonitor.detail.cacheHit")}
              value={idx.cache_hit_percent == null ? "—" : `${idx.cache_hit_percent.toFixed(1)}%`}
            />
            <DetailMetric
              label={t("indexMonitor.detail.bloat")}
              value={idx.bloat_percent == null ? "—" : `${idx.bloat_percent.toFixed(1)}%`}
            />
          </div>

          {idx.key_columns.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                {t("indexMonitor.detail.keyColumns")}
              </div>
              <div className="flex flex-wrap gap-1">
                {idx.key_columns.map((c) => (
                  <Badge key={c} variant="outline" className="font-mono text-[11px]">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {idx.definition ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("indexMonitor.detail.definition")}
                </span>
                <CopyButton text={idx.definition} />
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-black/30 p-2 font-mono text-[11px]">
                {idx.definition}
              </pre>
            </div>
          ) : null}

          {idx.reason ? (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                {t("indexMonitor.detail.reason")}
              </div>
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                {idx.reason}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}
