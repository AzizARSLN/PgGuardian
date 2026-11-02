"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  AlertCircle,
  Database,
  PlayCircle,
  RefreshCw,
  Search,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api/client";
import {
  endpoints,
  type AnalyzeRequest,
  type DryRunResult,
  type MaintenanceActionResult,
  type MutationRequest,
  type ReindexRequest,
  type TableMaintenance,
  type VacuumRequest,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useI18n, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { IfWriter } from "@/components/role-guard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
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

// VACUUM and REINDEX outlive the default 30s client timeout on large tables.
const LONG_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
const REPORT_LIMIT = 100;

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

function useMaintenanceAction<TBody extends MutationRequest>(
  path: "vacuum" | "analyze" | "reindex",
  command: string,
  onDone: () => void
) {
  const t = useT();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) =>
      api.post<MaintenanceActionResult>(`/maintenance/${path}`, body, {
        timeout: LONG_ACTION_TIMEOUT_MS,
      }),
    onSuccess: (result) => {
      toast.success(t("maintenance.toast.done", { command }), {
        description: result?.command_status,
      });
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance(REPORT_LIMIT) });
      onDone();
    },
    onError: () => {
      toast.error(t("maintenance.toast.failed", { command }));
    },
  });
}

export default function MaintenancePage() {
  const t = useT();
  const { formatNumber, formatDate } = useI18n();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState("vacuum");

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

  const vacuumMutation = useMaintenanceAction<VacuumRequest>("vacuum", "VACUUM", () => {
    setVacuumPreview(null);
    vacuumForm.reset();
  });
  const analyzeMutation = useMaintenanceAction<AnalyzeRequest>("analyze", "ANALYZE", () => {
    setAnalyzePreview(null);
    analyzeForm.reset();
  });
  const reindexMutation = useMaintenanceAction<ReindexRequest>("reindex", "REINDEX", () => {
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

  const runningLabel = (
    <>
      <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      {t("maintenance.running")}
    </>
  );

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
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

      <div className={cn(PANEL, "p-3")}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="vacuum">VACUUM</TabsTrigger>
            <TabsTrigger value="analyze">ANALYZE</TabsTrigger>
            <TabsTrigger value="reindex">REINDEX</TabsTrigger>
          </TabsList>

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
        </Tabs>
      </div>

      <div className={cn(PANEL, "overflow-hidden")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Search className="h-3.5 w-3.5 text-info" />
              {t("maintenance.table.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("maintenance.table.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
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
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
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
                {tables.map((row) => (
                  <TableRow key={`${row.schema_name ?? ""}.${row.table_name}`}>
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
      </div>
    </div>
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
