"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  ListChecks,
  Loader2,
  PlayCircle,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Target,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError, api } from "@/lib/api/client";
import {
  endpoints,
  type AnalyzeRequest,
  type DryRunResult,
  type IndexUsageInfo,
  type MaintenanceActionResult,
  type MutationRequest,
  type ReindexRequest,
  type SqlResult,
  type TableMaintenance,
  type TableSummary,
  type VacuumRequest,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useConfirm } from "@/lib/hooks/useConfirm";
import {
  OpBlockedHint,
  OpStopButton,
  useOpControl,
  type OpControl,
} from "@/lib/hooks/use-op-control";
import { useI18n, useT } from "@/lib/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { IfWriter } from "@/components/role-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LONG_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
const REPORT_LIMIT = 5000;
/** Rows per page in the table maintenance list; keeps the grid responsive. */
const TABLE_PAGE_SIZE = 250;

const CELL = "px-2 py-1.5 text-xs";
const HEAD = "h-8 px-2 text-xs";
const PANEL = "rounded-md border border-border bg-card";
const ACTION_BUTTON = "h-8 flex-1 text-xs";

interface VacuumForm {
  schema_name: string;
  table_name: string;
  full: boolean;
  analyze: boolean;
  freeze: boolean;
}

interface AnalyzeForm {
  schema_name: string;
  table_name: string;
}

interface ReindexForm {
  schema_name: string;
  table_name: string;
  index_name: string;
  concurrently: boolean;
}

type MaintenancePreview = {
  sql: string[];
  risk: "MAINTENANCE" | "DANGEROUS";
} | null;

function toPreview(result: DryRunResult): MaintenancePreview {
  return {
    sql: result.sql,
    risk: result.risk === "DANGEROUS" ? "DANGEROUS" : "MAINTENANCE",
  };
}

function latestTimestamp(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function severityToRisk(status: TableMaintenance["status"]): RiskLevel {
  if (status === "CRITICAL") return "DANGEROUS";
  if (status === "WARNING") return "WARNING";
  if (status === "OK") return "OK";
  return "INFO";
}

function deadTone(percent: number): string {
  if (percent > 10) return "text-destructive";
  if (percent > 3) return "text-warning";
  return "text-success";
}

/** Stable identity for a report row; also the selection key. */
const tableKey = (row: TableMaintenance) => `${row.schema_name ?? ""}.${row.table_name}`;

/** Stable identity for a schema table row; also its selection key. */
const summaryKey = (row: TableSummary) => `${row.schema_name}.${row.table_name}`;

const RISKY_STATUSES: TableMaintenance["status"][] = ["WARNING", "CRITICAL"];

/** Table status filter; "ALL" shows everything. */
type StatusFilter = "ALL" | TableMaintenance["status"];

/** How many per-table SQL previews the confirmation dialog shows. */
const PREVIEW_LIMIT = 10;

type BatchStatus = "pending" | "running" | "ok" | "failed" | "stopped";

interface BatchRow {
  key: string;
  label: string;
  status: BatchStatus;
  detail: string;
}

function useMaintenanceAction<TBody extends MutationRequest>(
  op: OpControl,
  path: "vacuum" | "analyze" | "reindex",
  command: string,
  onDone: () => void
) {
  const t = useT();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => {
      const handle = op.begin(path);
      return api.post<MaintenanceActionResult>(`/maintenance/${path}`, body, {
        timeout: LONG_ACTION_TIMEOUT_MS,
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: (result) => {
      toast.success(t("maintenance.toast.done", { command }), {
        description: result?.command_status,
      });
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance(REPORT_LIMIT) });
      onDone();
    },
    onError: (error) => {
      // 499 is our own client abort ("Durdur"); the API client stays quiet too.
      if (error instanceof ApiError && error.status === 499) return;
      toast.error(t("maintenance.toast.failed", { command }));
    },
    onSettled: () => op.end(),
  });
}

export default function MaintenancePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { formatNumber, formatDate } = useI18n();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState("vacuum");
  // Only a status filter is offered, per request: OK / WARNING / CRITICAL.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [pageIndex, setPageIndex] = useState(0);
  const op = useOpControl();
  // The batch run loops over many tables, so it tracks its own operation.
  const batchOp = useOpControl();

  const [vacuumPreview, setVacuumPreview] = useState<MaintenancePreview>(null);
  const [analyzePreview, setAnalyzePreview] = useState<MaintenancePreview>(null);
  const [reindexPreview, setReindexPreview] = useState<MaintenancePreview>(null);

  const vacuumForm = useForm<VacuumForm>({
    defaultValues: { schema_name: "", table_name: "", full: false, analyze: false, freeze: false },
  });
  const analyzeForm = useForm<AnalyzeForm>({
    defaultValues: { schema_name: "", table_name: "" },
  });
  const reindexForm = useForm<ReindexForm>({
    defaultValues: { schema_name: "", table_name: "", index_name: "", concurrently: true },
  });

  // A preview describes the options it was generated from. Dropping it on any
  // change stops Apply from running SQL the user never saw.
  useEffect(() => {
    const subscription = vacuumForm.watch(() => setVacuumPreview(null));
    return () => subscription.unsubscribe();
  }, [vacuumForm]);
  useEffect(() => {
    const subscription = analyzeForm.watch(() => setAnalyzePreview(null));
    return () => subscription.unsubscribe();
  }, [analyzeForm]);
  useEffect(() => {
    const subscription = reindexForm.watch(() => setReindexPreview(null));
    return () => subscription.unsubscribe();
  }, [reindexForm]);

  const report = useQuery({
    queryKey: qk.diagnostics.maintenance(REPORT_LIMIT),
    queryFn: () => endpoints.getMaintenance(REPORT_LIMIT),
  });

  const vacuumMutation = useMaintenanceAction<VacuumRequest>(op, "vacuum", "VACUUM", () => {
    setVacuumPreview(null);
    vacuumForm.reset();
  });
  const analyzeMutation = useMaintenanceAction<AnalyzeRequest>(op, "analyze", "ANALYZE", () => {
    setAnalyzePreview(null);
    analyzeForm.reset();
  });
  const reindexMutation = useMaintenanceAction<ReindexRequest>(op, "reindex", "REINDEX", () => {
    setReindexPreview(null);
    reindexForm.reset();
  });

  const vacuumPayload = (): VacuumRequest => {
    const v = vacuumForm.getValues();
    return {
      schema_name: v.schema_name.trim() || null,
      table_name: v.table_name.trim() || null,
      full: v.full,
      analyze: v.analyze,
      freeze: v.freeze,
    };
  };
  const analyzePayload = (): AnalyzeRequest => {
    const v = analyzeForm.getValues();
    return {
      schema_name: v.schema_name.trim() || null,
      table_name: v.table_name.trim() || null,
    };
  };
  const reindexPayload = (): ReindexRequest => {
    const v = reindexForm.getValues();
    return {
      schema_name: v.schema_name.trim() || null,
      table_name: v.table_name.trim() || null,
      index_name: v.index_name.trim() || null,
      concurrently: v.concurrently,
    };
  };

  /** The API takes schema + table together, or neither for the whole database. */
  const validPair = (schema?: string | null, table?: string | null) => {
    if (Boolean(schema) === Boolean(table)) return true;
    toast.error(t("maintenance.errors.scopePair"));
    return false;
  };

  const runDryRun = async (
    path: "vacuum" | "analyze" | "reindex",
    body: MutationRequest,
    apply: (preview: MaintenancePreview) => void
  ) => {
    try {
      const result = await api.post<DryRunResult>(`/maintenance/${path}`, {
        ...body,
        dry_run: true,
      });
      if (result?.sql) {
        apply(toPreview(result));
      } else {
        toast.info(t("maintenance.toast.noDryRun"));
      }
    } catch {
      // The API client has already shown the error.
    }
  };

  const handleVacuumDryRun = () => {
    const body = vacuumPayload();
    if (validPair(body.schema_name, body.table_name)) {
      void runDryRun("vacuum", body, setVacuumPreview);
    }
  };
  const handleAnalyzeDryRun = () => {
    const body = analyzePayload();
    if (validPair(body.schema_name, body.table_name)) {
      void runDryRun("analyze", body, setAnalyzePreview);
    }
  };
  const handleReindexDryRun = () => {
    const body = reindexPayload();
    if (!body.schema_name || Boolean(body.table_name) === Boolean(body.index_name)) {
      toast.error(t("maintenance.errors.reindexScope"));
      return;
    }
    void runDryRun("reindex", body, setReindexPreview);
  };

  const handleVacuumApply = async () => {
    if (!vacuumPreview) return;
    const ok = await confirm({
      title: t("maintenance.confirm.title", { command: "VACUUM" }),
      description: t(
        vacuumPreview.risk === "DANGEROUS"
          ? "maintenance.confirm.vacuumFull"
          : "maintenance.confirm.vacuum"
      ),
      risk_level: vacuumPreview.risk,
      sql_preview: vacuumPreview.sql,
      confirm_label: t("maintenance.confirm.run", { command: "VACUUM" }),
      cancel_label: t("common.cancel"),
    });
    if (ok) vacuumMutation.mutate({ ...vacuumPayload(), confirm: true });
  };

  const handleAnalyzeApply = async () => {
    if (!analyzePreview) return;
    const ok = await confirm({
      title: t("maintenance.confirm.title", { command: "ANALYZE" }),
      description: t("maintenance.confirm.analyze"),
      risk_level: analyzePreview.risk,
      sql_preview: analyzePreview.sql,
      confirm_label: t("maintenance.confirm.run", { command: "ANALYZE" }),
      cancel_label: t("common.cancel"),
    });
    if (ok) analyzeMutation.mutate({ ...analyzePayload(), confirm: true });
  };

  const handleReindexApply = async () => {
    if (!reindexPreview) return;
    const body = reindexPayload();
    const ok = await confirm({
      title: t("maintenance.confirm.title", { command: "REINDEX" }),
      description: t(
        body.concurrently ? "maintenance.confirm.reindexConcurrent" : "maintenance.confirm.reindex"
      ),
      risk_level: reindexPreview.risk,
      sql_preview: reindexPreview.sql,
      confirm_label: t("maintenance.confirm.run", { command: "REINDEX" }),
      cancel_label: t("common.cancel"),
    });
    if (ok) reindexMutation.mutate({ ...body, confirm: true });
  };

  const handleRefresh = async () => {
    const result = await report.refetch();
    if (!result.isError) toast.success(t("maintenance.toast.refreshed"));
  };

  const summary = report.data?.summary;
  const tables = report.data?.tables ?? [];
  const neverVacuumed = summary?.tables_never_vacuumed ?? 0;
  const neverAnalyzed = summary?.tables_never_analyzed ?? 0;
  const deadPercent = summary?.dead_tuple_percent ?? 0;

  const formatPercent = (value: number) =>
    formatNumber(value / 100, { style: "percent", maximumFractionDigits: 1 });
  const formatWhen = (value: string | null) => (value ? formatDate(value) : t("maintenance.never"));

  const tablesByStatus = {
    ok: tables.filter((row) => row.status === "OK").length,
    warning: tables.filter((row) => row.status === "WARNING").length,
    critical: tables.filter((row) => row.status === "CRITICAL").length,
  };

  const visibleTables = useMemo(
    () =>
      statusFilter === "ALL"
        ? tables
        : tables.filter((row) => row.status === statusFilter),
    [tables, statusFilter]
  );

  const pageCount = Math.max(1, Math.ceil(visibleTables.length / TABLE_PAGE_SIZE));
  const pagedTables = useMemo(
    () => visibleTables.slice(pageIndex * TABLE_PAGE_SIZE, (pageIndex + 1) * TABLE_PAGE_SIZE),
    [visibleTables, pageIndex]
  );
  // Keep the page index valid when the filter shrinks the list.
  useEffect(() => {
    setPageIndex((current) => (current > pageCount - 1 ? pageCount - 1 : current));
  }, [pageCount]);

  const runningLabel = (
    <>
      <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      {t("maintenance.running")}
    </>
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRows, setBatchRows] = useState<BatchRow[] | null>(null);

  const selectedTables = useMemo(
    () => tables.filter((row) => selected.has(tableKey(row))),
    [tables, selected]
  );
  const allSelected =
    visibleTables.length > 0 && visibleTables.every((row) => selected.has(tableKey(row)));
  const okCount = batchRows?.filter((row) => row.status === "ok").length ?? 0;
  const failedCount = batchRows?.filter((row) => row.status === "failed").length ?? 0;
  const stoppedCount = batchRows?.filter((row) => row.status === "stopped").length ?? 0;
  const doneCount = okCount + failedCount + stoppedCount;

  const toggleRow = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectNone = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(visibleTables.map(tableKey)));
  const selectRisky = () =>
    setSelected(
      new Set(tables.filter((row) => RISKY_STATUSES.includes(row.status)).map(tableKey))
    );

  // One request per table (the API takes a single scope); progress is reported
  // per row so a long run over many tables stays observable.
  const batchVacuum = useMutation({
    mutationFn: async (targets: TableMaintenance[]) => {
      const options = vacuumForm.getValues();
      const body = { analyze: options.analyze, full: options.full, freeze: options.freeze };
      const patch = (key: string, update: Partial<BatchRow>) =>
        setBatchRows((prev) =>
          prev ? prev.map((row) => (row.key === key ? { ...row, ...update } : row)) : prev
        );
      const markPendingStopped = () =>
        setBatchRows((prev) =>
          prev
            ? prev.map((row) => (row.status === "pending" ? { ...row, status: "stopped" } : row))
            : prev
        );

      setBatchRows(
        targets.map((row) => ({
          key: tableKey(row),
          label: `${row.schema_name ? `${row.schema_name}.` : ""}${row.table_name}`,
          status: "pending" as BatchStatus,
          detail: "",
        }))
      );

      // A fresh op id tags every request in the run; aborting it (via "Durdur")
      // releases the in-flight request and ends the loop.
      const handle = batchOp.begin("batch");
      let ok = 0;
      let failed = 0;

      for (const row of targets) {
        if (handle.signal.aborted) {
          markPendingStopped();
          break;
        }
        const key = tableKey(row);
        patch(key, { status: "running" });
        try {
          const result = await api.post<MaintenanceActionResult>(
            "/maintenance/vacuum",
            { ...body, schema_name: row.schema_name, table_name: row.table_name, confirm: true },
            {
              timeout: LONG_ACTION_TIMEOUT_MS,
              skipToast: true,
              opId: handle.opId,
              signal: handle.signal,
            }
          );
          ok += 1;
          patch(key, { status: "ok", detail: result?.command_status ?? "" });
        } catch (error) {
          // 499 is our own client abort ("Durdur"), not a failure.
          if (error instanceof ApiError && error.status === 499) {
            patch(key, { status: "stopped" });
            markPendingStopped();
            break;
          }
          failed += 1;
          patch(key, {
            status: "failed",
            detail: error instanceof Error ? error.message : "",
          });
        }
      }
      return { ok, failed, stopped: targets.length - ok - failed };
    },
    onSuccess: ({ ok, failed, stopped }) => {
      if (stopped > 0) {
        toast.info(t("maintenance.batch.stoppedToast", { ok, failed }));
      } else {
        toast.success(t("maintenance.toast.done", { command: "VACUUM" }), {
          description: t("maintenance.batch.summary", { ok, failed }),
        });
      }
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance(REPORT_LIMIT) });
    },
    onSettled: () => batchOp.end(),
  });

  const handleBatchVacuum = async () => {
    const targets = selectedTables;
    if (targets.length === 0) {
      toast.error(t("maintenance.batch.noSelection"));
      return;
    }
    const options = vacuumForm.getValues();
    const scope = {
      analyze: options.analyze,
      full: options.full,
      freeze: options.freeze,
      dry_run: true,
    };

    // Show the SQL the API will actually run, bounded so a big selection stays fast.
    const previews = await Promise.all(
      targets.slice(0, PREVIEW_LIMIT).map(async (row) => {
        try {
          const result = await api.post<DryRunResult>(
            "/maintenance/vacuum",
            { ...scope, schema_name: row.schema_name, table_name: row.table_name },
            { skipToast: true }
          );
          return result?.sql ?? [];
        } catch {
          return [];
        }
      })
    );

    const extra =
      targets.length > PREVIEW_LIMIT
        ? `\n${t("maintenance.batch.andMore", { count: targets.length - PREVIEW_LIMIT })}`
        : "";

    const ok = await confirm({
      title: t("maintenance.batch.confirmTitle", { count: targets.length }),
      description:
        t(
          options.full ? "maintenance.batch.confirmDescFull" : "maintenance.batch.confirmDesc"
        ) + extra,
      risk_level: options.full ? "DANGEROUS" : "MAINTENANCE",
      sql_preview: previews.flat(),
      confirm_label: t("maintenance.batch.apply"),
      cancel_label: t("common.cancel"),
    });
    if (ok) batchVacuum.mutate(targets);
  };

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-5rem)]">
      <ConfirmDialog />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Wrench className="h-4 w-4 text-warning" />
            {t("maintenance.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("maintenance.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleRefresh}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", report.isFetching && "animate-spin")} />
          {t("maintenance.refresh")}
        </Button>
      </div>

      {!report.isError && (
        <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
          {report.isLoading
            ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[54px] w-full rounded-md" />)
            : [
                {
                  label: t("maintenance.stats.tables"),
                  value: formatNumber(summary?.tables_total ?? 0),
                  icon: Database,
                  tone: "text-foreground",
                },
                {
                  label: t("maintenance.stats.deadRatio"),
                  value: formatPercent(deadPercent),
                  icon: Trash2,
                  tone: deadTone(deadPercent),
                },
                {
                  label: t("maintenance.stats.neverVacuumed"),
                  value: formatNumber(neverVacuumed),
                  icon: Wrench,
                  tone:
                    neverVacuumed > 3
                      ? "text-destructive"
                      : neverVacuumed > 0
                        ? "text-warning"
                        : "text-success",
                },
                {
                  label: t("maintenance.stats.neverAnalyzed"),
                  value: formatNumber(neverAnalyzed),
                  icon: Sparkles,
                  tone: neverAnalyzed > 0 ? "text-warning" : "text-success",
                },
                {
                  label: t("maintenance.stats.autovacuumWorkers"),
                  value: formatNumber(summary?.autovacuum_workers ?? 0),
                  icon: PlayCircle,
                  tone: "text-foreground",
                },
              ].map((stat) => <StatTile key={stat.label} {...stat} />)}
        </div>
      )}

      <div className={cn(PANEL, "shrink-0 p-3")}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="vacuum">VACUUM</TabsTrigger>
            <TabsTrigger value="analyze">ANALYZE</TabsTrigger>
            <TabsTrigger value="reindex">REINDEX</TabsTrigger>
            <TabsTrigger value="health">{t("maintenance.health.tab")}</TabsTrigger>
          </TabsList>

          <OpBlockedHint control={op} className="mt-3" />

          <TabsContent value="vacuum" className="mt-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-3">
                <SectionTitle
                  icon={<Trash2 className="h-3.5 w-3.5 text-warning" />}
                  text={t("maintenance.options", { command: "VACUUM" })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("maintenance.fields.schemaOptional")}>
                    <Input
                      {...vacuumForm.register("schema_name")}
                      placeholder="public"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label={t("maintenance.fields.tableOptional")}>
                    <Input
                      {...vacuumForm.register("table_name")}
                      placeholder="orders"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("maintenance.scopeHint", { command: "VACUUM" })}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <OptionCheck
                    id="vac-full"
                    label="FULL"
                    hint={t("maintenance.hints.full")}
                    tone="danger"
                    checked={vacuumForm.watch("full")}
                    onChange={(v) => vacuumForm.setValue("full", v)}
                  />
                  <OptionCheck
                    id="vac-analyze"
                    label="ANALYZE"
                    hint={t("maintenance.hints.analyze")}
                    checked={vacuumForm.watch("analyze")}
                    onChange={(v) => vacuumForm.setValue("analyze", v)}
                  />
                  <OptionCheck
                    id="vac-freeze"
                    label="FREEZE"
                    hint={t("maintenance.hints.freeze")}
                    checked={vacuumForm.watch("freeze")}
                    onChange={(v) => vacuumForm.setValue("freeze", v)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON}
                    onClick={handleVacuumDryRun}
                  >
                    <TerminalSquare className="mr-1.5 h-3.5 w-3.5" />
                    {t("maintenance.dryRun")}
                  </Button>
                  <IfWriter>
                    <Button
                      type="button"
                      size="sm"
                      variant={vacuumForm.watch("full") ? "destructive" : "default"}
                      className={ACTION_BUTTON}
                      onClick={handleVacuumApply}
                      disabled={!vacuumPreview || vacuumMutation.isPending}
                    >
                      {vacuumMutation.isPending ? (
                        runningLabel
                      ) : (
                        <>
                          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                          {t("maintenance.apply", { command: "VACUUM" })}
                        </>
                      )}
                    </Button>
                  </IfWriter>
                  <OpStopButton control={op} className="h-8 text-xs" />
                </div>
              </div>
              <SqlPreview
                preview={vacuumPreview}
                note={t(
                  vacuumPreview?.risk === "DANGEROUS"
                    ? "maintenance.notes.vacuumFull"
                    : "maintenance.notes.vacuum"
                )}
              />
            </div>
          </TabsContent>

          <TabsContent value="analyze" className="mt-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-3">
                <SectionTitle
                  icon={<Sparkles className="h-3.5 w-3.5 text-info" />}
                  text={t("maintenance.options", { command: "ANALYZE" })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("maintenance.fields.schemaOptional")}>
                    <Input
                      {...analyzeForm.register("schema_name")}
                      placeholder="public"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label={t("maintenance.fields.tableOptional")}>
                    <Input
                      {...analyzeForm.register("table_name")}
                      placeholder="orders"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("maintenance.scopeHint", { command: "ANALYZE" })}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON}
                    onClick={handleAnalyzeDryRun}
                  >
                    <TerminalSquare className="mr-1.5 h-3.5 w-3.5" />
                    {t("maintenance.dryRun")}
                  </Button>
                  <IfWriter>
                    <Button
                      type="button"
                      size="sm"
                      className={ACTION_BUTTON}
                      onClick={handleAnalyzeApply}
                      disabled={!analyzePreview || analyzeMutation.isPending}
                    >
                      {analyzeMutation.isPending ? (
                        runningLabel
                      ) : (
                        <>
                          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                          {t("maintenance.apply", { command: "ANALYZE" })}
                        </>
                      )}
                    </Button>
                  </IfWriter>
                  <OpStopButton control={op} className="h-8 text-xs" />
                </div>
              </div>
              <SqlPreview preview={analyzePreview} note={t("maintenance.notes.analyze")} />
            </div>
          </TabsContent>

          <TabsContent value="reindex" className="mt-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-3">
                <SectionTitle
                  icon={<Database className="h-3.5 w-3.5 text-success" />}
                  text={t("maintenance.options", { command: "REINDEX" })}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Field label={t("maintenance.fields.schema")}>
                    <Input
                      {...reindexForm.register("schema_name")}
                      placeholder="public"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label={t("maintenance.fields.table")}>
                    <Input
                      {...reindexForm.register("table_name")}
                      placeholder="orders"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label={t("maintenance.fields.index")}>
                    <Input
                      {...reindexForm.register("index_name")}
                      placeholder="idx_orders_date"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">{t("maintenance.reindexHint")}</p>
                <OptionCheck
                  id="rei-concurrent"
                  label="CONCURRENTLY"
                  hint={t("maintenance.hints.concurrently")}
                  tone="success"
                  checked={reindexForm.watch("concurrently")}
                  onChange={(v) => reindexForm.setValue("concurrently", v)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON}
                    onClick={handleReindexDryRun}
                  >
                    <TerminalSquare className="mr-1.5 h-3.5 w-3.5" />
                    {t("maintenance.dryRun")}
                  </Button>
                  <IfWriter>
                    <Button
                      type="button"
                      size="sm"
                      className={ACTION_BUTTON}
                      onClick={handleReindexApply}
                      disabled={!reindexPreview || reindexMutation.isPending}
                    >
                      {reindexMutation.isPending ? (
                        runningLabel
                      ) : (
                        <>
                          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                          {t("maintenance.apply", { command: "REINDEX" })}
                        </>
                      )}
                    </Button>
                  </IfWriter>
                  <OpStopButton control={op} className="h-8 text-xs" />
                </div>
              </div>
              <SqlPreview
                preview={reindexPreview}
                note={t(
                  reindexForm.watch("concurrently")
                    ? "maintenance.notes.reindexConcurrent"
                    : "maintenance.notes.reindex"
                )}
              />
            </div>
          </TabsContent>

          <TabsContent value="health" className="mt-3">
            <TableHealthTab op={op} />
          </TabsContent>
        </Tabs>
      </div>

      {/* The health tab carries its own bulk actions, so the legacy
          "Tablo bakım durumu" panel is hidden while it is open. */}
      {tab !== "health" && (
        <>
      {batchRows && batchRows.length > 0 && (
        <div className={cn(PANEL, "shrink-0 overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <ListChecks className="h-3.5 w-3.5 text-success" />
                {t("maintenance.batch.resultsTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("maintenance.batch.resultsHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" size="sm" className="font-mono">
                {t("maintenance.batch.summary", { ok: okCount, failed: failedCount })}
              </Badge>
              {stoppedCount > 0 && (
                <Badge variant="outline" size="sm" className="font-mono text-muted-foreground">
                  {t("maintenance.batch.statusStopped")}: {formatNumber(stoppedCount)}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setBatchRows(null)}
              >
                <X className="mr-1 h-3 w-3" />
                {t("maintenance.batch.clearResults")}
              </Button>
            </div>
          </div>
          <OpBlockedHint control={batchOp} />
          <div className="max-h-40 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className={HEAD}>{t("maintenance.table.status")}</TableHead>
                  <TableHead className={HEAD}>{t("maintenance.table.table")}</TableHead>
                  <TableHead className={HEAD}>{t("maintenance.result")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className={CELL}>
                      <BatchStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className={cn(CELL, "font-mono")}>{row.label}</TableCell>
                    <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                      {row.detail || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className={cn(PANEL, "flex min-h-[360px] flex-1 flex-col overflow-hidden")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Search className="h-3.5 w-3.5 text-info" />
              {t("maintenance.table.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("maintenance.table.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tables.length > 0 && (
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as StatusFilter);
                  setPageIndex(0);
                }}
              >
                <SelectTrigger
                  className="h-7 w-[150px] text-xs"
                  aria-label={t("maintenance.filter.label")}
                >
                  <span className="flex items-center gap-1.5">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="py-1.5 text-xs">
                    {t("maintenance.filter.all")}
                  </SelectItem>
                  <SelectItem value="OK" className="py-1.5 text-xs">
                    OK ({formatNumber(tablesByStatus.ok)})
                  </SelectItem>
                  <SelectItem value="WARNING" className="py-1.5 text-xs">
                    WARNING ({formatNumber(tablesByStatus.warning)})
                  </SelectItem>
                  <SelectItem value="CRITICAL" className="py-1.5 text-xs">
                    CRITICAL ({formatNumber(tablesByStatus.critical)})
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <RiskBadge riskLevel="OK" size="sm">
              <span className="font-mono">OK: {formatNumber(tablesByStatus.ok)}</span>
            </RiskBadge>
            <RiskBadge riskLevel="WARNING" size="sm">
              <span className="font-mono">WARNING: {formatNumber(tablesByStatus.warning)}</span>
            </RiskBadge>
            <RiskBadge riskLevel="DANGEROUS" size="sm">
              <span className="font-mono">CRITICAL: {formatNumber(tablesByStatus.critical)}</span>
            </RiskBadge>
          </div>
        </div>
        {tables.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-muted-foreground">
                {t("maintenance.batch.selected", { count: selected.size })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={selectRisky}
              >
                <Target className="mr-1 h-3 w-3" />
                {t("maintenance.batch.selectRisky")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={allSelected ? selectNone : selectAll}
              >
                {allSelected ? t("maintenance.batch.selectNone") : t("maintenance.batch.selectAll")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <IfWriter>
                <Button
                  type="button"
                  size="sm"
                  variant={vacuumForm.watch("full") ? "destructive" : "default"}
                  className="h-7 text-xs"
                  onClick={handleBatchVacuum}
                  disabled={selected.size === 0 || batchVacuum.isPending}
                >
                  {batchVacuum.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      {t("maintenance.batch.running", {
                        done: doneCount,
                        total: batchRows?.length ?? 0,
                      })}
                    </>
                  ) : (
                    <>
                      <PlayCircle className="mr-1.5 h-3 w-3" />
                      {t("maintenance.batch.apply")}
                    </>
                  )}
                </Button>
              </IfWriter>
              {batchVacuum.isPending && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void batchOp.stop()}
                  disabled={batchOp.stopping}
                >
                  {batchOp.stopping ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <span className="mr-1.5 inline-block h-3 w-3 rounded-[2px] bg-current" />
                  )}
                  {t("maintenance.batch.stop")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleRefresh}
                disabled={report.isFetching}
              >
                <RefreshCw className={cn("mr-1.5 h-3 w-3", report.isFetching && "animate-spin")} />
                {t("maintenance.refresh")}
              </Button>
            </div>
          </div>
        )}
        {report.isError ? (
          <QueryError onRetry={() => report.refetch()} />
        ) : report.isLoading ? (
          <div className="space-y-1.5 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">{t("maintenance.table.emptyTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("maintenance.table.emptyHint")}</p>
          </div>
        ) : visibleTables.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">{t("maintenance.table.noMatchTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("maintenance.table.noMatchHint")}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(HEAD, "w-8")}>
                    <Checkbox
                      aria-label={t("maintenance.batch.selectAll")}
                      checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                      onCheckedChange={(value) => (value ? selectAll() : selectNone())}
                    />
                  </TableHead>
                  <TableHead className={HEAD}>{t("maintenance.table.status")}</TableHead>
                  <TableHead className={HEAD}>{t("maintenance.table.table")}</TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("maintenance.table.live")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("maintenance.table.dead")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("maintenance.table.deadPercent")}
                  </TableHead>
                  <TableHead className={HEAD}>{t("maintenance.table.lastVacuum")}</TableHead>
                  <TableHead className={HEAD}>{t("maintenance.table.lastAnalyze")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedTables.map((row) => (
                  <TableRow
                    key={tableKey(row)}
                    data-state={selected.has(tableKey(row)) ? "selected" : undefined}
                  >
                    <TableCell className={CELL}>
                      <Checkbox
                        aria-label={tableKey(row)}
                        checked={selected.has(tableKey(row))}
                        onCheckedChange={() => toggleRow(tableKey(row))}
                      />
                    </TableCell>
                    <TableCell className={CELL}>
                      <RiskBadge riskLevel={severityToRisk(row.status)} size="sm" />
                    </TableCell>
                    <TableCell className={cn(CELL, "font-mono")}>
                      {row.schema_name && (
                        <span className="text-muted-foreground">{row.schema_name}.</span>
                      )}
                      {row.table_name}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono")}>
                      {formatNumber(row.live_tuples)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono")}>
                      {formatNumber(row.dead_tuples)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        CELL,
                        "text-right font-mono font-semibold",
                        deadTone(row.dead_tuple_percent)
                      )}
                    >
                      {formatPercent(row.dead_tuple_percent)}
                    </TableCell>
                    <TableCell className={cn(CELL, "whitespace-nowrap font-mono")}>
                      {formatWhen(latestTimestamp(row.last_vacuum, row.last_autovacuum))}
                    </TableCell>
                    <TableCell className={cn(CELL, "whitespace-nowrap font-mono")}>
                      {formatWhen(latestTimestamp(row.last_analyze, row.last_autoanalyze))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {visibleTables.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5">
            <span className="font-mono text-xs text-muted-foreground">
              {t("maintenance.pagination.summary", {
                page: formatNumber(pageIndex + 1),
                pages: formatNumber(pageCount),
                total: formatNumber(visibleTables.length),
              })}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                {t("maintenance.pagination.pageSize", { size: formatNumber(TABLE_PAGE_SIZE) })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                disabled={pageIndex === 0}
              >
                <ChevronLeft className="mr-1 h-3 w-3" />
                {t("maintenance.pagination.previous")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                disabled={pageIndex >= pageCount - 1}
              >
                {t("maintenance.pagination.next")}
                <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

type HealthBatchAction = "vacuumFull" | "analyze" | "reindex";

/** Backend maintenance endpoint for a bulk action. */
const HEALTH_ENDPOINT: Record<HealthBatchAction, "vacuum" | "analyze" | "reindex"> = {
  vacuumFull: "vacuum",
  analyze: "analyze",
  reindex: "reindex",
};

const HEALTH_COMMAND: Record<HealthBatchAction, string> = {
  vacuumFull: "VACUUM FULL",
  analyze: "ANALYZE",
  reindex: "REINDEX",
};

/** Body scope for one bulk target (schema + table) by action. */
function healthScopeBody(action: HealthBatchAction, schemaName: string, tableName: string) {
  if (action === "analyze") return { schema_name: schemaName, table_name: tableName };
  if (action === "reindex")
    return { schema_name: schemaName, table_name: tableName, concurrently: true };
  return { schema_name: schemaName, table_name: tableName, full: true, analyze: true, freeze: false };
}

/**
 * Schema-scoped table overview: sizes, tuple/write counters and never-used
 * indexes. Tables can be multi-selected for bulk VACUUM FULL / ANALYZE /
 * REINDEX, and a single focused table keeps its own action panel. Every write
 * runs a dry run first; the confirmation shows the SQL, and single-table runs
 * keep that SQL editable (an edited statement goes through the SQL endpoint,
 * otherwise the structured maintenance endpoint is used).
 */
function TableHealthTab({ op }: { op: OpControl }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { formatNumber } = useI18n();
  const { confirmSql, Component: ConfirmDialog } = useConfirm();
  // The bulk run loops over many tables, so it tracks its own operation.
  const bulkOp = useOpControl();

  const [schema, setSchema] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState("10");
  const [batchRows, setBatchRows] = useState<BatchRow[] | null>(null);

  const formatPercent = (value: number) =>
    formatNumber(value / 100, { style: "percent", maximumFractionDigits: 1 });

  const schemasQuery = useQuery({
    queryKey: qk.schemas.all(),
    queryFn: () => endpoints.listSchemas(),
  });

  const tablesQuery = useQuery({
    queryKey: qk.schemas.tables(schema, REPORT_LIMIT),
    queryFn: () => endpoints.listTables(schema, REPORT_LIMIT),
    enabled: Boolean(schema),
  });

  const tables: TableSummary[] = tablesQuery.data ?? [];
  const selected = tables.find((row) => summaryKey(row) === selectedKey) ?? null;
  const selectedTable = selected?.table_name ?? "";

  const indexesQuery = useQuery({
    queryKey: qk.schemas.tableIndexes(schema, selectedTable),
    queryFn: () => endpoints.listTableIndexes(schema, selectedTable),
    enabled: Boolean(schema && selectedTable),
  });
  const unusedIndexes: IndexUsageInfo[] = (indexesQuery.data ?? []).filter(
    (row) => row.potentially_unused
  );

  const invalidateTables = () => {
    queryClient.invalidateQueries({ queryKey: qk.schemas.all() });
  };

  const vacuumMutation = useMaintenanceAction<VacuumRequest>(op, "vacuum", "VACUUM", invalidateTables);
  const analyzeMutation = useMaintenanceAction<AnalyzeRequest>(op, "analyze", "ANALYZE", invalidateTables);
  const reindexMutation = useMaintenanceAction<ReindexRequest>(op, "reindex", "REINDEX", invalidateTables);

  // --- single-table actions (dry run → editable SQL → confirm) ---

  const runStructured = (path: "vacuum" | "analyze" | "reindex", body: MutationRequest) => {
    if (path === "vacuum") vacuumMutation.mutate({ ...(body as VacuumRequest), confirm: true });
    else if (path === "analyze") analyzeMutation.mutate({ ...(body as AnalyzeRequest), confirm: true });
    else reindexMutation.mutate({ ...(body as ReindexRequest), confirm: true });
  };

  /** Run an edited statement as-is; the SQL endpoint accepts one statement. */
  const executeEditedSql = async (sql: string, command: string) => {
    const handle = op.begin("sql");
    try {
      await api.post<SqlResult | DryRunResult>(
        "/sql",
        { sql, readonly: false, confirm: true },
        { timeout: LONG_ACTION_TIMEOUT_MS, opId: handle.opId, signal: handle.signal }
      );
      toast.success(t("maintenance.toast.done", { command }));
      invalidateTables();
    } catch (error) {
      // 499 is our own client abort ("Durdur"); the API client stays quiet too.
      if (error instanceof ApiError && error.status === 499) return;
      // The API client has already surfaced the error.
    } finally {
      op.end();
    }
  };

  const executeSingle = async (
    path: "vacuum" | "analyze" | "reindex",
    body: VacuumRequest | AnalyzeRequest | ReindexRequest,
    command: string,
    descriptionKey: string
  ) => {
    try {
      const dry = await api.post<DryRunResult>(
        `/maintenance/${path}`,
        { ...body, dry_run: true },
        { skipToast: true }
      );
      const preview = toPreview(dry);
      if (!preview) return;
      const generated = preview.sql.join("\n\n").trim();
      const result = await confirmSql({
        title: t("maintenance.confirm.title", { command }),
        description: t(descriptionKey),
        risk_level: preview.risk,
        sql_preview: preview.sql,
        sql_editable: true,
        confirm_label: t("maintenance.confirm.run", { command }),
        cancel_label: t("common.cancel"),
      });
      if (!result.confirmed) return;
      const edited = (result.sql ?? "").trim();
      if (edited && edited !== generated) {
        await executeEditedSql(edited, command);
        return;
      }
      runStructured(path, body);
    } catch {
      // The API client has already surfaced the error.
    }
  };

  const runVacuum = (full: boolean) => {
    if (!selected) return;
    void executeSingle(
      "vacuum",
      {
        schema_name: selected.schema_name,
        table_name: selected.table_name,
        full,
        analyze: true,
        freeze: false,
      },
      "VACUUM",
      full ? "maintenance.confirm.vacuumFull" : "maintenance.confirm.vacuum"
    );
  };

  const runAnalyze = () => {
    if (!selected) return;
    void executeSingle(
      "analyze",
      { schema_name: selected.schema_name, table_name: selected.table_name },
      "ANALYZE",
      "maintenance.confirm.analyze"
    );
  };

  const runReindexTable = () => {
    if (!selected) return;
    void executeSingle(
      "reindex",
      { schema_name: selected.schema_name, table_name: selected.table_name, concurrently: true },
      "REINDEX",
      "maintenance.confirm.reindexConcurrent"
    );
  };

  const runReindexIndex = (indexName: string) => {
    void executeSingle(
      "reindex",
      { schema_name: schema, index_name: indexName, concurrently: true },
      "REINDEX",
      "maintenance.confirm.reindexConcurrent"
    );
  };

  // --- multi-select + bulk actions ---

  const selectedRows = tables.filter((row) => selectedKeys.has(summaryKey(row)));
  const allSelected = tables.length > 0 && tables.every((row) => selectedKeys.has(summaryKey(row)));

  const toggleSelect = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectAll = () => setSelectedKeys(new Set(tables.map(summaryKey)));
  const selectNone = () => setSelectedKeys(new Set());
  /** Select tables whose dead-tuple ratio meets the user's threshold (%). */
  const selectCritical = () => {
    const limit = Number(threshold.replace(",", "."));
    if (!Number.isFinite(limit)) {
      toast.error(t("maintenance.health.batch.thresholdInvalid"));
      return;
    }
    const picks = tables.filter((row) => row.dead_tuple_percent >= limit);
    if (picks.length === 0) {
      toast.info(t("maintenance.health.batch.noCritical", { threshold }));
      return;
    }
    setSelectedKeys(new Set(picks.map(summaryKey)));
  };

  // One request per table (the API takes a single scope); progress is reported
  // per row so a long run over many tables stays observable.
  const bulkMutation = useMutation({
    mutationFn: async ({
      action,
      command,
      targets,
    }: {
      action: HealthBatchAction;
      command: string;
      targets: TableSummary[];
    }) => {
      const patch = (key: string, update: Partial<BatchRow>) =>
        setBatchRows((prev) =>
          prev ? prev.map((row) => (row.key === key ? { ...row, ...update } : row)) : prev
        );
      const markPendingStopped = () =>
        setBatchRows((prev) =>
          prev
            ? prev.map((row) =>
                row.status === "pending" ? { ...row, status: "stopped" as BatchStatus } : row
              )
            : prev
        );

      setBatchRows(
        targets.map((row) => ({
          key: summaryKey(row),
          label: summaryKey(row),
          status: "pending" as BatchStatus,
          detail: "",
        }))
      );

      // A fresh op id tags every request in the run; aborting it (via "Durdur")
      // releases the in-flight request and ends the loop.
      const endpoint = HEALTH_ENDPOINT[action];
      const handle = bulkOp.begin("health-batch");
      let ok = 0;
      let failed = 0;

      for (const row of targets) {
        if (handle.signal.aborted) {
          markPendingStopped();
          break;
        }
        const key = summaryKey(row);
        patch(key, { status: "running" });
        try {
          const result = await api.post<MaintenanceActionResult>(
            `/maintenance/${endpoint}`,
            { ...healthScopeBody(action, row.schema_name, row.table_name), confirm: true },
            {
              timeout: LONG_ACTION_TIMEOUT_MS,
              skipToast: true,
              opId: handle.opId,
              signal: handle.signal,
            }
          );
          ok += 1;
          patch(key, { status: "ok", detail: result?.command_status ?? "" });
        } catch (error) {
          // 499 is our own client abort ("Durdur"), not a failure.
          if (error instanceof ApiError && error.status === 499) {
            patch(key, { status: "stopped" });
            markPendingStopped();
            break;
          }
          failed += 1;
          patch(key, {
            status: "failed",
            detail: error instanceof Error ? error.message : "",
          });
        }
      }
      return { ok, failed, stopped: targets.length - ok - failed, command };
    },
    onSuccess: ({ ok, failed, stopped, command }) => {
      if (stopped > 0) {
        toast.info(t("maintenance.batch.stoppedToast", { ok, failed }));
      } else {
        toast.success(t("maintenance.toast.done", { command }), {
          description: t("maintenance.batch.summary", { ok, failed }),
        });
      }
      setSelectedKeys(new Set());
      invalidateTables();
    },
    onSettled: () => bulkOp.end(),
  });

  const runBulk = async (action: HealthBatchAction) => {
    const targets = selectedRows;
    if (targets.length === 0) {
      toast.error(t("maintenance.health.batch.noSelection"));
      return;
    }
    const endpoint = HEALTH_ENDPOINT[action];
    // Show the SQL the API will actually run, bounded so a big selection stays fast.
    const previews = await Promise.all(
      targets.slice(0, PREVIEW_LIMIT).map(async (row) => {
        try {
          const result = await api.post<DryRunResult>(
            `/maintenance/${endpoint}`,
            { ...healthScopeBody(action, row.schema_name, row.table_name), dry_run: true },
            { skipToast: true }
          );
          return result?.sql ?? [];
        } catch {
          return [];
        }
      })
    );
    const extra =
      targets.length > PREVIEW_LIMIT
        ? `\n${t("maintenance.health.batch.andMore", { count: targets.length - PREVIEW_LIMIT })}`
        : "";
    const command = HEALTH_COMMAND[action];

    const result = await confirmSql({
      title: t("maintenance.health.batch.confirmTitle", { command, count: targets.length }),
      description:
        t(
          action === "vacuumFull"
            ? "maintenance.health.batch.confirmDescFull"
            : "maintenance.health.batch.confirmDesc",
          { command }
        ) + extra,
      risk_level: action === "vacuumFull" ? "DANGEROUS" : "MAINTENANCE",
      sql_preview: previews.flat(),
      confirm_label: t("maintenance.health.batch.apply", { command }),
      cancel_label: t("common.cancel"),
    });
    if (result.confirmed) bulkMutation.mutate({ action, command, targets });
  };

  const busy = vacuumMutation.isPending || analyzeMutation.isPending || reindexMutation.isPending;
  const bulkBusy = bulkMutation.isPending;
  const schemaOptions = (schemasQuery.data ?? []).filter((row) => !row.is_system);
  const totalSize = tables.reduce((sum, row) => sum + row.total_size_bytes, 0);
  const totalIndexSize = tables.reduce((sum, row) => sum + row.indexes_size_bytes, 0);
  const totalUnusedIndexSize = tables.reduce((sum, row) => sum + row.unused_index_size_bytes, 0);
  const okCount = batchRows?.filter((row) => row.status === "ok").length ?? 0;
  const failedCount = batchRows?.filter((row) => row.status === "failed").length ?? 0;
  const stoppedCount = batchRows?.filter((row) => row.status === "stopped").length ?? 0;
  const doneCount = okCount + failedCount + stoppedCount;

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={schema}
            onValueChange={(value) => {
              setSchema(value);
              setSelectedKey("");
              setSelectedKeys(new Set());
              setBatchRows(null);
            }}
          >
            <SelectTrigger
              className="h-8 w-[220px] text-xs"
              aria-label={t("maintenance.health.schema")}
            >
              <SelectValue placeholder={t("maintenance.health.schemaPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {schemaOptions.map((row) => (
                <SelectItem key={row.name} value={row.name} className="py-1.5 font-mono text-xs">
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {schema && (
            <>
              <span className="font-mono text-xs text-muted-foreground">
                {t("maintenance.health.summary", {
                  tables: formatNumber(tables.length),
                  size: formatBytes(totalSize, 1),
                })}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {t("maintenance.health.indexSizeTotal")}: {formatBytes(totalIndexSize, 1)}
              </span>
              <span className="font-mono text-xs text-warning">
                {t("maintenance.health.unusedSizeTotal")}: {formatBytes(totalUnusedIndexSize, 1)}
              </span>
            </>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => void tablesQuery.refetch()}
          disabled={!schema || tablesQuery.isFetching}
        >
          <RefreshCw
            className={cn("mr-1.5 h-3.5 w-3.5", tablesQuery.isFetching && "animate-spin")}
          />
          {t("maintenance.refresh")}
        </Button>
      </div>

      {!schema ? (
        <HintBox icon={<Table2 className="h-4 w-4" />} text={t("maintenance.health.noSchema")} />
      ) : tablesQuery.isError ? (
        <QueryError onRetry={() => tablesQuery.refetch()} />
      ) : tablesQuery.isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <HintBox icon={<Table2 className="h-4 w-4" />} text={t("maintenance.health.empty")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {t("maintenance.health.batch.selected", { count: selectedKeys.size })}
              </span>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="health-threshold" className="text-xs text-muted-foreground">
                  {t("maintenance.health.batch.thresholdLabel")}
                </Label>
                <Input
                  id="health-threshold"
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  inputMode="decimal"
                  className="h-7 w-16 text-center font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={selectCritical}
                >
                  <Target className="mr-1 h-3 w-3" />
                  {t("maintenance.health.batch.selectCritical")}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={allSelected ? selectNone : selectAll}
              >
                {allSelected ? t("maintenance.batch.selectNone") : t("maintenance.batch.selectAll")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <IfWriter>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => void runBulk("vacuumFull")}
                  disabled={selectedKeys.size === 0 || busy || bulkBusy}
                >
                  <Trash2 className="mr-1.5 h-3 w-3" />
                  {t("maintenance.health.actions.vacuumFull")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => void runBulk("analyze")}
                  disabled={selectedKeys.size === 0 || busy || bulkBusy}
                >
                  <Sparkles className="mr-1.5 h-3 w-3" />
                  {t("maintenance.health.actions.analyze")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => void runBulk("reindex")}
                  disabled={selectedKeys.size === 0 || busy || bulkBusy}
                >
                  <Database className="mr-1.5 h-3 w-3" />
                  {t("maintenance.health.actions.reindex")}
                </Button>
              </IfWriter>
              {bulkBusy && (
                <>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t("maintenance.health.batch.running", {
                      done: doneCount,
                      total: batchRows?.length ?? 0,
                    })}
                  </span>
                  <OpStopButton control={bulkOp} className="h-7 text-xs" />
                </>
              )}
            </div>
          </div>

          <div className="max-h-[320px] overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className={cn(HEAD, "w-8")}>
                  <Checkbox
                    aria-label={t("maintenance.batch.selectAll")}
                    checked={allSelected ? true : selectedKeys.size > 0 ? "indeterminate" : false}
                    onCheckedChange={(value) => (value ? selectAll() : selectNone())}
                  />
                </TableHead>
                <TableHead className={HEAD}>{t("maintenance.health.columns.table")}</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.total")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.tableSize")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.indexSize")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.live")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.dead")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.deadPercent")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.inserted")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.updated")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.deleted")}
                </TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  {t("maintenance.health.columns.unused")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((row) => {
                const key = summaryKey(row);
                const isSelected = key === selectedKey;
                return (
                  <TableRow
                    key={key}
                    className="cursor-pointer"
                    data-state={isSelected ? "selected" : undefined}
                    onClick={() => setSelectedKey(isSelected ? "" : key)}
                  >
                    <TableCell className={CELL} onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={key}
                        checked={selectedKeys.has(key)}
                        onCheckedChange={() => toggleSelect(key)}
                      />
                    </TableCell>
                    <TableCell className={cn(CELL, "font-mono")}>
                      <span className="text-muted-foreground">{row.schema_name}.</span>
                      {row.table_name}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono")}>
                      {formatBytes(row.total_size_bytes)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                      {formatBytes(row.table_size_bytes)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                      {formatBytes(row.indexes_size_bytes)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono")}>
                      {formatNumber(row.live_tuples)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono")}>
                      {formatNumber(row.dead_tuples)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        CELL,
                        "text-right font-mono font-semibold",
                        deadTone(row.dead_tuple_percent)
                      )}
                    >
                      {formatPercent(row.dead_tuple_percent)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                      {formatNumber(row.inserted_rows)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                      {formatNumber(row.updated_rows)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                      {formatNumber(row.deleted_rows)}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-right")}>
                      {row.unused_index_count > 0 ? (
                        <span className="font-mono text-warning">
                          {formatNumber(row.unused_index_count)}
                          <span className="ml-1 text-muted-foreground">
                            · {formatBytes(row.unused_index_size_bytes, 1)}
                          </span>
                        </span>
                      ) : (
                        <span className="font-mono text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </>
      )}

      {batchRows && batchRows.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <ListChecks className="h-3.5 w-3.5 text-success" />
                {t("maintenance.health.batch.resultsTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("maintenance.health.batch.resultsHint")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" size="sm" className="font-mono">
                {t("maintenance.batch.summary", { ok: okCount, failed: failedCount })}
              </Badge>
              {stoppedCount > 0 && (
                <Badge variant="outline" size="sm" className="font-mono text-muted-foreground">
                  {t("maintenance.batch.statusStopped")}: {formatNumber(stoppedCount)}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setBatchRows(null)}
              >
                <X className="mr-1 h-3 w-3" />
                {t("maintenance.batch.clearResults")}
              </Button>
            </div>
          </div>
          <OpBlockedHint control={bulkOp} />
          <div className="max-h-40 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className={HEAD}>{t("maintenance.table.status")}</TableHead>
                  <TableHead className={HEAD}>{t("maintenance.table.table")}</TableHead>
                  <TableHead className={HEAD}>{t("maintenance.result")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className={CELL}>
                      <BatchStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className={cn(CELL, "font-mono")}>{row.label}</TableCell>
                    <TableCell className={cn(CELL, "font-mono text-muted-foreground")}>
                      {row.detail || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {selected ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Table2 className="h-3.5 w-3.5 text-info" />
                <span className="font-mono">
                  {selected.schema_name}.{selected.table_name}
                </span>
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelectedKey("")}
              >
                <X className="mr-1 h-3 w-3" />
                {t("maintenance.health.clear")}
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Metric label={t("maintenance.health.columns.inserted")} value={selected.inserted_rows} />
              <Metric label={t("maintenance.health.columns.updated")} value={selected.updated_rows} />
              <Metric label={t("maintenance.health.columns.deleted")} value={selected.deleted_rows} />
              <Metric label={t("maintenance.table.live")} value={selected.live_tuples} />
              <Metric
                label={t("maintenance.table.dead")}
                value={selected.dead_tuples}
                tone={deadTone(selected.dead_tuple_percent)}
              />
              <Metric
                label={t("maintenance.table.deadPercent")}
                value={selected.dead_tuple_percent}
                percent
                tone={deadTone(selected.dead_tuple_percent)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <IfWriter>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void runVacuum(false)}
                  disabled={busy}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("maintenance.health.actions.vacuum")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs"
                  onClick={() => void runVacuum(true)}
                  disabled={busy}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("maintenance.health.actions.vacuumFull")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => void runAnalyze()}
                  disabled={busy}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {t("maintenance.health.actions.analyze")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => void runReindexTable()}
                  disabled={busy}
                >
                  <Database className="mr-1.5 h-3.5 w-3.5" />
                  {t("maintenance.health.actions.reindex")}
                </Button>
              </IfWriter>
              <OpStopButton control={op} className="h-8 text-xs" />
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Target className="h-3.5 w-3.5 text-warning" />
                {t("maintenance.health.unused.title")}
              </h3>
              <Badge variant="outline" size="sm" className="font-mono">
                {t("maintenance.health.unused.subtitle")}
              </Badge>
            </div>
            {indexesQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : unusedIndexes.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                {t("maintenance.health.unused.empty")}
              </p>
            ) : (
              <div className="max-h-[200px] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className={HEAD}>{t("maintenance.fields.index")}</TableHead>
                      <TableHead className={cn(HEAD, "text-right")}>
                        {t("maintenance.health.columns.indexSize")}
                      </TableHead>
                      <TableHead className={cn(HEAD, "text-right")}>
                        {t("maintenance.health.unused.scans")}
                      </TableHead>
                      <TableHead className={HEAD} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unusedIndexes.map((row) => (
                      <TableRow key={row.index_name}>
                        <TableCell className={cn(CELL, "font-mono")}>{row.index_name}</TableCell>
                        <TableCell className={cn(CELL, "text-right font-mono")}>
                          {formatBytes(row.size_bytes)}
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right font-mono text-muted-foreground")}>
                          {formatNumber(row.index_scans)}
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right")}>
                          <IfWriter>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => void runReindexIndex(row.index_name)}
                              disabled={busy}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" />
                              {t("maintenance.health.unused.reindex")}
                            </Button>
                          </IfWriter>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      ) : schema && tables.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t("maintenance.health.pickHint")}</p>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  percent,
}: {
  label: string;
  value: number;
  tone?: string;
  percent?: boolean;
}) {
  const { formatNumber } = useI18n();
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", tone ?? "text-foreground")}>
        {percent
          ? formatNumber(value / 100, { style: "percent", maximumFractionDigits: 1 })
          : formatNumber(value)}
      </div>
    </div>
  );
}

function HintBox({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const t = useT();
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("maintenance.batch.statusOk")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        {t("maintenance.batch.statusFailed")}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("maintenance.batch.statusRunning")}
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span className="inline-block h-3 w-3 rounded-[2px] bg-current" />
        {t("maintenance.batch.statusStopped")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5" />
      {t("maintenance.batch.statusPending")}
    </span>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("font-mono text-base font-semibold", tone)}>{value}</div>
    </div>
  );
}

function SectionTitle({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
      {icon}
      {text}
    </h3>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function OptionCheck({
  id,
  label,
  hint,
  tone,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  tone?: "danger" | "success";
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border px-2.5 py-2",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
        tone === "success" && "border-success/30 bg-success/5"
      )}
    >
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            "cursor-pointer font-mono text-xs font-medium",
            tone === "danger" && "text-destructive",
            tone === "success" && "text-success"
          )}
        >
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function SqlPreview({ preview, note }: { preview: MaintenancePreview; note: string }) {
  const t = useT();
  if (!preview) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4">
        <TerminalSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{t("maintenance.preview.title")}</p>
          <p className="text-xs text-muted-foreground">{t("maintenance.preview.empty")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <TerminalSquare className="h-3.5 w-3.5 text-success" />
          {t("maintenance.preview.title")}
        </h3>
        <RiskBadge riskLevel={preview.risk} size="sm" />
      </div>
      {preview.sql.map((sql, index) => (
        <pre
          key={index}
          className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs text-foreground"
        >
          {sql}
        </pre>
      ))}
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function QueryError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-3" role="alert">
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {t("common.loadFailed")}
      </span>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-3 w-3" />
        {t("common.retry")}
      </Button>
    </div>
  );
}
