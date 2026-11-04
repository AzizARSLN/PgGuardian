"use client";

import { AlertTriangle, ChevronRight, Loader2, Play } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeBlock } from "@/components/statements/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  insightApi,
  type ExplainPlanOptions,
  type QueryInsight,
} from "@/lib/api/insight";
import type {
  PlanEnvelope,
  PlanNodeJson,
  PlanResult,
  Recommendation,
} from "@/lib/api/statements";
import { endpoints, type DryRunResult, type SqlResult } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE: Record<Recommendation["severity"], string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-info/15 text-info",
};

const SAFETY_STYLE: Record<Recommendation["safety"], string> = {
  safe: "bg-success/15 text-success",
  conditional: "bg-warning/15 text-warning",
  advisory: "bg-muted text-muted-foreground",
};

/** Any screen that holds SQL text can open this panel. */
export interface QueryInsightTarget {
  query: string;
  pid?: number | null;
  user?: string | null;
  database?: string | null;
  state?: string | null;
  duration_seconds?: number | null;
  application_name?: string | null;
  client_addr?: string | null;
  client_hostname?: string | null;
  client_port?: number | null;
  backend_type?: string | null;
  state_seconds?: number | null;
  xact_seconds?: number | null;
  backend_seconds?: number | null;
  backend_start?: string | null;
  xact_start?: string | null;
  query_start?: string | null;
  state_change?: string | null;
  blocked_by?: number[];
  wait_event_type?: string | null;
  wait_event?: string | null;
}

const DEFAULT_PLAN_OPTIONS: Required<ExplainPlanOptions> = {
  analyze: false,
  verbose: true,
  costs: true,
  settings: true,
  buffers: false,
  wal: false,
  timing: true,
};

function formatInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function MetaChip({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-xs">{value}</p>
    </div>
  );
}

function Meta({ target }: { target: QueryInsightTarget }) {
  const { t } = useI18n();
  const seconds = target.duration_seconds ?? target.state_seconds;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <MetaChip label="PID" value={target.pid ?? null} />
      <MetaChip label={t("diagnostics.columns.user")} value={target.user} />
      <MetaChip label={t("diagnostics.columns.database")} value={target.database} />
      <MetaChip label={t("diagnostics.columns.state")} value={target.state} />
      <MetaChip label={t("liveQueries.columns.application")} value={target.application_name} />
      <MetaChip
        label={t("queryInsight.wait")}
        value={
          target.wait_event_type
            ? `${target.wait_event_type}${target.wait_event ? `:${target.wait_event}` : ""}`
            : null
        }
      />
      <MetaChip
        label={t("liveQueries.columns.client")}
        value={
          target.client_hostname || target.client_addr
            ? `${target.client_hostname ?? target.client_addr}${target.client_addr && target.client_hostname ? ` · ${target.client_addr}` : ""}${target.client_port ? `:${target.client_port}` : ""}`
            : null
        }
      />
      <MetaChip
        label={t("diagnostics.columns.duration")}
        value={
          typeof seconds === "number" ? t("queryInsight.seconds", { value: seconds.toFixed(1) }) : null
        }
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 break-words font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function CostCard({ insight }: { insight: QueryInsight }) {
  const { t, formatNumber } = useI18n();
  const before = insight.cost?.before ?? insight.plan_cost ?? null;
  const after = insight.cost?.after ?? null;
  const improvement =
    after !== null && before !== null && before > 0 ? (1 - after / before) * 100 : null;

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="mb-2 text-[13px] font-semibold">{t("queryInsight.costTitle")}</p>
      {before === null ? (
        <p className="text-xs text-muted-foreground">{t("queryInsight.noCost")}</p>
      ) : after === null ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-lg font-semibold">
            {formatNumber(before, { maximumFractionDigits: 1 })}
          </span>
          <span className="text-[11px] text-muted-foreground">{t("queryInsight.currentPlanCost")}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-lg font-semibold">
            {formatNumber(before, { maximumFractionDigits: 1 })}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="font-mono text-lg font-semibold text-success">
            {formatNumber(after, { maximumFractionDigits: 1 })}
          </span>
          {improvement !== null && (
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0.5 text-[11px]",
                improvement >= 0
                  ? "border-success/40 text-success"
                  : "border-destructive/40 text-destructive"
              )}
            >
              {t(improvement >= 0 ? "queryInsight.cheaper" : "queryInsight.costlier", {
                percent: Math.abs(improvement).toFixed(1),
              })}
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground">{t("queryInsight.costHint")}</span>
        </div>
      )}
    </div>
  );
}

const NODE_TONE: Record<string, string> = {
  "Seq Scan": "border-warning/50 bg-warning/5",
  "Index Scan": "border-success/40 bg-success/5",
  "Index Only Scan": "border-success/40 bg-success/5",
  "Bitmap Index Scan": "border-success/40 bg-success/5",
  "Bitmap Heap Scan": "border-success/40 bg-success/5",
  Sort: "border-info/40 bg-info/5",
  Hash: "border-info/40 bg-info/5",
  "Hash Join": "border-info/40 bg-info/5",
  "Merge Join": "border-info/40 bg-info/5",
  "Nested Loop": "border-warning/40 bg-warning/5",
};

function nodeTone(node: PlanNodeJson): string {
  const type = node["Node Type"];
  if (NODE_TONE[type]) return NODE_TONE[type];
  if (type.includes("Join")) return "border-info/40 bg-info/5";
  return "border-border bg-card";
}

function walkPlan(node: PlanNodeJson, visit: (n: PlanNodeJson) => void) {
  visit(node);
  for (const child of node.Plans ?? []) walkPlan(child, visit);
}

interface PlanAnalysis {
  hotspot: PlanNodeJson;
  hotspotByTime: boolean;
  seqScans: string[];
  sorts: number;
  nestedLoops: number;
  rowMismatch: { node: PlanNodeJson; ratio: number } | null;
}

/** Purely derived facts the UI turns into a plain-language summary. */
function analysePlan(tree: PlanNodeJson): PlanAnalysis {
  const nodes: PlanNodeJson[] = [];
  walkPlan(tree, (node) => nodes.push(node));
  const hasTime = nodes.some((node) => node["Actual Total Time"] !== undefined);
  const metric = (node: PlanNodeJson) =>
    hasTime ? (node["Actual Total Time"] ?? 0) : node["Total Cost"];
  const hotspot = nodes.reduce((best, node) => (metric(node) > metric(best) ? node : best), tree);
  let rowMismatch: PlanAnalysis["rowMismatch"] = null;
  for (const node of nodes) {
    const actual = node["Actual Rows"];
    const estimate = node["Plan Rows"];
    if (actual === undefined || !estimate || actual === 0) continue;
    const ratio = Math.max(actual, estimate) / Math.max(Math.min(actual, estimate), 1);
    if (ratio >= 10 && (!rowMismatch || ratio > rowMismatch.ratio)) {
      rowMismatch = { node, ratio };
    }
  }
  return {
    hotspot,
    hotspotByTime: hasTime,
    seqScans: nodes
      .filter((node) => node["Node Type"] === "Seq Scan" && node["Relation Name"])
      .map((node) => node["Relation Name"] as string),
    sorts: nodes.filter((node) => node["Node Type"] === "Sort").length,
    nestedLoops: nodes.filter((node) => node["Node Type"] === "Nested Loop").length,
    rowMismatch,
  };
}

function PlanNodeCard({
  node,
  rootCost,
  hotspot,
  depth = 0,
}: {
  node: PlanNodeJson;
  rootCost: number;
  hotspot: PlanNodeJson | null;
  depth?: number;
}) {
  const { t, formatNumber } = useI18n();
  const [open, setOpen] = React.useState(true);
  const children = node.Plans ?? [];
  const cost = node["Total Cost"] ?? 0;
  const costPct = rootCost > 0 ? Math.min(100, (cost / rootCost) * 100) : 0;
  const isHot = hotspot === node;
  const details: Array<[string, string | undefined]> = [
    ["Filter", node.Filter],
    ["Index Cond", node["Index Cond"]],
    ["Hash Cond", node["Hash Cond"]],
    ["Sort Key", node["Sort Key"]?.join(", ")],
  ];
  return (
    <div className={cn(depth > 0 && "ml-3 border-l border-border pl-3")}>
      <div
        className={cn(
          "my-1 rounded-md border px-2.5 py-2",
          nodeTone(node),
          isHot && "ring-1 ring-warning/60"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {children.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-label={t("statements.plan.showTree")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
          <span className="font-semibold">
            {node["Join Type"] ? `${node["Join Type"]} ` : ""}
            {node["Node Type"]}
          </span>
          {node["Relation Name"] && (
            <span className="font-mono text-[11px] text-info">{node["Relation Name"]}</span>
          )}
          {node["Index Name"] && (
            <span className="font-mono text-[11px] text-success">{node["Index Name"]}</span>
          )}
          {isHot && (
            <Badge
              variant="outline"
              className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] text-warning"
            >
              {t("queryInsight.plan.hotspotBadge")}
            </Badge>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
            <span>
              {t("queryInsight.plan.costLabel")} {formatNumber(cost, { maximumFractionDigits: 1 })}
            </span>
            <span>
              {t("queryInsight.plan.rowsLabel")} {formatNumber(node["Plan Rows"])}
            </span>
            {node["Actual Rows"] !== undefined && (
              <span className="text-foreground">
                → {formatNumber(node["Actual Rows"])}
              </span>
            )}
            {node["Actual Total Time"] !== undefined && (
              <span>{formatNumber(node["Actual Total Time"], { maximumFractionDigits: 3 })} ms</span>
            )}
          </span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-muted">
          <div
            className={cn("h-full rounded", isHot ? "bg-warning" : "bg-info/60")}
            style={{ width: `${costPct}%` }}
          />
        </div>
        {details.map(
          ([label, value]) =>
            value && (
              <p
                key={label}
                className="mt-1 break-words font-mono text-[11px] text-muted-foreground"
              >
                {label}: {value}
              </p>
            )
        )}
      </div>
      {open &&
        children.map((child, index) => (
          <PlanNodeCard
            key={index}
            node={child}
            rootCost={rootCost}
            hotspot={hotspot}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function PlanStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm font-semibold", tone)}>{value}</p>
    </div>
  );
}

function PlanFailure({ plan }: { plan: PlanResult }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[13px]">
      <p className="font-medium">
        {t(`statements.plan.reasons.${plan.reason ?? "planner_error"}`)}
      </p>
      {plan.message && (
        <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
          {plan.message}
        </pre>
      )}
    </div>
  );
}

function PlanAnalysisCard({ analysis }: { analysis: PlanAnalysis }) {
  const { t, formatNumber } = useI18n();
  const hot = analysis.hotspot;
  const hotName = `${hot["Join Type"] ? `${hot["Join Type"]} ` : ""}${hot["Node Type"]}${
    hot["Relation Name"] ? ` · ${hot["Relation Name"]}` : ""
  }`;
  const hotValue = analysis.hotspotByTime
    ? `${formatNumber(hot["Actual Total Time"] ?? 0, { maximumFractionDigits: 3 })} ms`
    : formatNumber(hot["Total Cost"], { maximumFractionDigits: 1 });
  const findings: string[] = [];
  if (analysis.seqScans.length > 0) {
    findings.push(
      t("queryInsight.plan.findingSeqScan", {
        relations: [...new Set(analysis.seqScans)].join(", "),
      })
    );
  }
  if (analysis.sorts > 0) findings.push(t("queryInsight.plan.findingSort", { count: analysis.sorts }));
  if (analysis.nestedLoops > 0) {
    findings.push(t("queryInsight.plan.findingNestedLoop", { count: analysis.nestedLoops }));
  }
  if (analysis.rowMismatch) {
    findings.push(
      t("queryInsight.plan.findingRowMismatch", {
        node: analysis.rowMismatch.node["Node Type"],
        ratio: formatNumber(analysis.rowMismatch.ratio, { maximumFractionDigits: 0 }),
      })
    );
  }
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[13px] font-semibold">{t("queryInsight.plan.analysisTitle")}</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(analysis.hotspotByTime ? "queryInsight.plan.hotspotTime" : "queryInsight.plan.hotspotCost")}
          </p>
          <p className="font-mono text-xs text-foreground">{hotName}</p>
          <p className="font-mono text-[11px] text-warning">{hotValue}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("queryInsight.plan.findingsLabel")}
          </p>
          {findings.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("queryInsight.plan.noFindings")}</p>
          ) : (
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] text-foreground">
              {findings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanActions({ insight }: { insight: QueryInsight }) {
  const { t, formatNumber } = useI18n();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const items = insight.recommendations.filter((item) => item.ddl || item.sql_rewrite);
  const run = useMutation({
    mutationFn: async ({ sql }: { sql: string }) => {
      const plan = await endpoints.executeSql({ sql, dry_run: true, readonly: false });
      if (!("risk" in plan)) return null;
      let result: SqlResult | DryRunResult;
      if (plan.risk === "READ") {
        result = await endpoints.executeSql({ sql, readonly: true });
      } else {
        const ok = await confirm({
          title: t("queryInsight.plan.confirmTitle"),
          description: t("queryInsight.plan.confirmDesc", { risk: plan.risk }),
          risk_level: plan.risk,
          sql_preview: plan.sql,
          confirm_label: t("queryInsight.plan.runSuggestion"),
          cancel_label: t("common.cancel"),
        });
        if (!ok) return null;
        result = await endpoints.executeSql({ sql, confirm: true, readonly: false });
      }
      return result;
    },
    onSuccess: (result) => {
      if (!result || !("row_count" in result)) return;
      toast.success(t("queryInsight.plan.executed"), {
        description: t("queryInsight.plan.executedDesc", {
          rows: formatNumber(result.row_count),
          ms: formatNumber(result.duration_ms, { maximumFractionDigits: 1 }),
        }),
      });
    },
  });

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <ConfirmDialog />
      <div>
        <p className="text-[13px] font-semibold">{t("queryInsight.plan.actionsTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("queryInsight.plan.actionsHint")}</p>
      </div>
      {items.map((item, index) => {
        const sql = item.ddl ?? item.sql_rewrite ?? "";
        const running = run.isPending && run.variables?.sql === sql;
        return (
          <article
            key={`${item.code}-${index}`}
            className="space-y-1.5 rounded-md border border-border bg-card p-3"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  SEVERITY_STYLE[item.severity]
                )}
              >
                {t(`statements.severity.${item.severity}`)}
              </span>
              <h3 className="text-[13px] font-semibold">{t(`statements.rules.${item.code}.title`)}</h3>
              <span
                className={cn(
                  "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  SAFETY_STYLE[item.safety]
                )}
              >
                {t(`statements.safety.${item.safety}.label`)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(`statements.rules.${item.code}.fix`)}
            </p>
            <CodeBlock
              code={sql}
              label={t(item.ddl ? "queryInsight.plan.ddlLabel" : "queryInsight.plan.rewriteLabel")}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={run.isPending}
                onClick={() => run.mutate({ sql })}
              >
                {running ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    {t("queryInsight.plan.runningSuggestion")}
                  </>
                ) : (
                  <>
                    <Play className="mr-1 h-3 w-3" />
                    {t("queryInsight.plan.runSuggestion")}
                  </>
                )}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {t("queryInsight.plan.runHint")}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ExecutionPlanPanel({
  target,
  insight,
}: {
  target: QueryInsightTarget;
  insight: QueryInsight;
}) {
  const { t, formatNumber } = useI18n();
  const [options, setOptions] =
    React.useState<Required<ExplainPlanOptions>>(DEFAULT_PLAN_OPTIONS);
  const [showJson, setShowJson] = React.useState(false);
  const [didAutoRun, setDidAutoRun] = React.useState(false);
  const explain = useMutation({
    mutationFn: (current: ExplainPlanOptions) => insightApi.explain(target.query, current),
  });

  React.useEffect(() => {
    if (didAutoRun) return;
    explain.mutate(DEFAULT_PLAN_OPTIONS);
    setDidAutoRun(true);
  }, [didAutoRun, explain]);

  const toggle =
    (key: keyof typeof DEFAULT_PLAN_OPTIONS) => (checked: boolean | "indeterminate") => {
      const enabled = checked === true;
      setOptions((current) => {
        const next = { ...current, [key]: enabled };
        if (key === "analyze" && !enabled) {
          next.buffers = false;
          next.wal = false;
        }
        next.timing = true;
        return next;
      });
    };

  const plan = explain.data;
  const envelope = Array.isArray(plan?.plan) ? (plan.plan[0] as PlanEnvelope | undefined) : undefined;
  const tree = envelope?.Plan;
  const analysis = tree ? analysePlan(tree) : null;
  const optionDefs: Array<{
    key: keyof typeof DEFAULT_PLAN_OPTIONS;
    title: string;
    description: string;
    disabled?: boolean;
  }> = [
    {
      key: "analyze",
      title: "ANALYZE",
      description: t("queryInsight.plan.optionAnalyze"),
    },
    {
      key: "verbose",
      title: "VERBOSE",
      description: t("queryInsight.plan.optionVerbose"),
    },
    {
      key: "costs",
      title: "COSTS",
      description: t("queryInsight.plan.optionCosts"),
    },
    {
      key: "settings",
      title: "SETTINGS",
      description: t("queryInsight.plan.optionSettings"),
    },
    {
      key: "buffers",
      title: "BUFFERS",
      description: t("queryInsight.plan.optionBuffers"),
      disabled: !options.analyze,
    },
    {
      key: "wal",
      title: "WAL",
      description: t("queryInsight.plan.optionWal"),
      disabled: !options.analyze,
    },
    {
      key: "timing",
      title: "TIMING",
      description: t("queryInsight.plan.optionTiming"),
      disabled: true,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold">{t("queryInsight.plan.title")}</p>
            <p className="text-xs text-muted-foreground">{t("queryInsight.plan.subtitle")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={explain.isPending}
            onClick={() => explain.mutate(options)}
          >
            {explain.isPending ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                {t("queryInsight.plan.running")}
              </>
            ) : (
              <>
                <Play className="mr-1 h-3.5 w-3.5" />
                {t("queryInsight.plan.run")}
              </>
            )}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {optionDefs.map((option) => (
            <label
              key={option.key}
              title={option.description}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                option.disabled
                  ? "cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground"
                  : options[option.key]
                    ? "cursor-pointer border-primary bg-accent text-foreground"
                    : "cursor-pointer border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              <Checkbox
                checked={options[option.key]}
                disabled={option.disabled}
                onCheckedChange={toggle(option.key)}
                className="h-3.5 w-3.5"
              />
              <span className="font-mono font-semibold">{option.title}</span>
            </label>
          ))}
        </div>
      </div>

      {explain.isError && (
        <PlanFailure
          plan={{
            status: "failed",
            plan: null,
            mode: "generic",
            reason: "planner_error",
            message: (explain.error as Error).message,
          }}
        />
      )}
      {plan && plan.status !== "ok" && <PlanFailure plan={plan} />}
      {plan?.status === "ok" && tree && analysis && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <PlanStat label={t("queryInsight.plan.mode")} value={t(`statements.plan.mode.${plan.mode}`)} />
            <PlanStat
              label={t("queryInsight.plan.planningTime")}
              value={
                envelope?.["Planning Time"] !== undefined
                  ? `${formatNumber(envelope["Planning Time"], { maximumFractionDigits: 3 })} ms`
                  : "-"
              }
            />
            <PlanStat
              label={t("queryInsight.plan.executionTime")}
              value={
                envelope?.["Execution Time"] !== undefined
                  ? `${formatNumber(envelope["Execution Time"], { maximumFractionDigits: 3 })} ms`
                  : "-"
              }
            />
            <PlanStat
              label={t("queryInsight.plan.totalCost")}
              value={formatNumber(tree["Total Cost"], { maximumFractionDigits: 1 })}
            />
            <PlanStat
              label={t("queryInsight.plan.rowsLabel")}
              value={formatNumber(tree["Actual Rows"] ?? tree["Plan Rows"])}
            />
          </div>
          <PlanAnalysisCard analysis={analysis} />
          <div className="flex flex-wrap items-center gap-2">
            {optionDefs
              .filter((option) => options[option.key])
              .map((option) => (
                <Badge key={option.key} variant="outline" className="font-mono text-[10px]">
                  {option.title}
                </Badge>
              ))}
            <button
              type="button"
              onClick={() => setShowJson((value) => !value)}
              className="ml-auto text-[11px] text-info hover:underline"
            >
              {t(showJson ? "statements.plan.showTree" : "statements.plan.showJson")}
            </button>
          </div>
          {showJson ? (
            <CodeBlock code={JSON.stringify(plan.plan, null, 2)} label="JSON" />
          ) : (
            <div className="rounded-md border border-border bg-muted/20 p-2">
              <PlanNodeCard node={tree} rootCost={tree["Total Cost"]} hotspot={analysis.hotspot} />
            </div>
          )}
        </div>
      )}

      <PlanActions insight={insight} />
    </div>
  );
}

function Suggestions({ insight, query }: { insight: QueryInsight; query: string }) {
  const { t } = useI18n();
  if (!insight.suggested_sql) {
    return (
      <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
        {t("queryInsight.noSuggestion")}
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3">
      <p className="text-[13px] font-semibold">{t("queryInsight.suggestionTitle")}</p>
      <p className="text-xs text-muted-foreground">
        {t("statements.advice.suggestedDesc", {
          applied: insight.applied.map((code) => t(`statements.rules.${code}.title`)).join(", "),
        })}
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        <CodeBlock code={query} label={t("statements.advice.current")} />
        <CodeBlock code={insight.suggested_sql} label={t("statements.advice.suggested")} />
      </div>
    </div>
  );
}

function Findings({ insight }: { insight: QueryInsight }) {
  const { t, formatNumber } = useI18n();
  if (insight.recommendations.length === 0) {
    return (
      <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
        {t("statements.advice.none")}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold">{t("queryInsight.findingsTitle")}</p>
      {insight.recommendations.map((item, index) => (
        <article key={`${item.code}-${index}`} className="space-y-1.5 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                SEVERITY_STYLE[item.severity]
              )}
            >
              {t(`statements.severity.${item.severity}`)}
            </span>
            <h3 className="text-[13px] font-semibold">{t(`statements.rules.${item.code}.title`)}</h3>
            <span
              title={t(`statements.safety.${item.safety}.desc`)}
              className={cn(
                "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold",
                SAFETY_STYLE[item.safety]
              )}
            >
              {t(`statements.safety.${item.safety}.label`)}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(`statements.rules.${item.code}.problem`)}
          </p>
          <p className="text-xs leading-relaxed">{t(`statements.rules.${item.code}.fix`)}</p>
          {Object.keys(item.evidence).length > 0 && (
            <dl className="grid gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground sm:grid-cols-[auto_1fr]">
              {Object.entries(item.evidence)
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt>{key}</dt>
                    <dd className="break-words text-foreground">
                      {typeof value === "number"
                        ? formatNumber(value, { maximumFractionDigits: 4 })
                        : Array.isArray(value)
                          ? value.join(", ")
                          : String(value)}
                    </dd>
                  </React.Fragment>
                ))}
            </dl>
          )}
          {item.ddl && <CodeBlock code={item.ddl} label="DDL" />}
          {item.sql_rewrite && item.code !== "SELECT_STAR" && item.code !== "LARGE_IN" && (
            <CodeBlock code={item.sql_rewrite} label={t("statements.advice.template")} />
          )}
        </article>
      ))}
    </div>
  );
}

function SessionDetail({ target }: { target: QueryInsightTarget }) {
  const { t } = useI18n();
  const runtimeSeconds = target.duration_seconds ?? target.state_seconds;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-3">
          <p className="mb-1 text-[13px] font-semibold">
            {t("queryInsight.session.general")}
          </p>
          <dl>
            <DetailRow label="PID" value={target.pid ?? null} />
            <DetailRow
              label={t("diagnostics.columns.database")}
              value={target.database}
            />
            <DetailRow label={t("diagnostics.columns.state")} value={target.state} />
            <DetailRow
              label={t("liveQueries.columns.query")}
              value={target.query}
            />
            <DetailRow
              label={t("queryInsight.session.backendType")}
              value={target.backend_type}
            />
          </dl>
        </section>

        <section className="rounded-md border border-border bg-card p-3">
          <p className="mb-1 text-[13px] font-semibold">
            {t("queryInsight.session.client")}
          </p>
          <dl>
            <DetailRow label={t("diagnostics.columns.user")} value={target.user} />
            <DetailRow
              label={t("queryInsight.session.clientHost")}
              value={target.client_hostname}
            />
            <DetailRow
              label={t("queryInsight.session.clientIp")}
              value={target.client_addr}
            />
            <DetailRow
              label={t("queryInsight.session.clientPort")}
              value={target.client_port}
            />
            <DetailRow
              label={t("liveQueries.columns.application")}
              value={target.application_name}
            />
          </dl>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-3">
          <p className="mb-1 text-[13px] font-semibold">
            {t("queryInsight.session.timings")}
          </p>
          <dl>
            <DetailRow
              label={t("queryInsight.session.backendStart")}
              value={formatInstant(target.backend_start)}
            />
            <DetailRow
              label={t("queryInsight.session.xactStart")}
              value={formatInstant(target.xact_start)}
            />
            <DetailRow
              label={t("queryInsight.session.queryStart")}
              value={formatInstant(target.query_start)}
            />
            <DetailRow
              label={t("queryInsight.session.stateChange")}
              value={formatInstant(target.state_change)}
            />
          </dl>
        </section>

        <section className="rounded-md border border-border bg-card p-3">
          <p className="mb-1 text-[13px] font-semibold">
            {t("queryInsight.session.runtime")}
          </p>
          <dl>
            <DetailRow
              label={t("diagnostics.columns.duration")}
              value={
                typeof runtimeSeconds === "number"
                  ? t("queryInsight.seconds", {
                      value: runtimeSeconds.toFixed(1),
                    })
                  : null
              }
            />
            <DetailRow
              label={t("liveQueries.columns.transaction")}
              value={
                typeof target.xact_seconds === "number"
                  ? t("queryInsight.seconds", { value: target.xact_seconds.toFixed(1) })
                  : null
              }
            />
            <DetailRow
              label={t("queryInsight.session.backendAge")}
              value={
                typeof target.backend_seconds === "number"
                  ? t("queryInsight.seconds", { value: target.backend_seconds.toFixed(1) })
                  : null
              }
            />
            <DetailRow
              label={t("queryInsight.wait")}
              value={
                target.wait_event_type
                  ? `${target.wait_event_type}${target.wait_event ? `:${target.wait_event}` : ""}`
                  : null
              }
            />
            <DetailRow
              label={t("queryInsight.session.blockedBy")}
              value={
                target.blocked_by && target.blocked_by.length > 0
                  ? target.blocked_by.join(", ")
                  : t("queryInsight.session.none")
              }
            />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Overview({ insight, target }: { insight: QueryInsight; target: QueryInsightTarget }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <Meta target={target} />
      <CodeBlock code={insight.formatted} label="SQL" />
      <CostCard insight={insight} />
      {insight.plan_status !== "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          {t("statements.advice.noPlan", {
            reason: t(`statements.plan.reasons.${insight.plan_reason ?? "planner_error"}`),
          })}
        </p>
      )}
      <Suggestions insight={insight} query={target.query} />
      <Findings insight={insight} />
    </div>
  );
}

function Body({ target }: { target: QueryInsightTarget }) {
  const { t } = useI18n();
  const [tab, setTab] = React.useState("overview");
  const insight = useQuery({
    queryKey: qk.sql.advise(target.query),
    queryFn: () => insightApi.advise(target.query),
  });

  if (insight.isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("queryInsight.analyzing")}
      </div>
    );
  }

  if (insight.isError || !insight.data) {
    return (
      <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-[13px]">
        <p className="font-medium">{t("common.loadFailed")}</p>
        <p className="text-muted-foreground">{(insight.error as Error | null)?.message}</p>
        <Button size="sm" variant="outline" onClick={() => insight.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const data = insight.data;
  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-3">
      <TabsList className="grid h-auto w-full grid-cols-3">
        <TabsTrigger value="overview">{t("queryInsight.tabs.overview")}</TabsTrigger>
        <TabsTrigger value="plan">{t("queryInsight.tabs.plan")}</TabsTrigger>
        <TabsTrigger value="session">{t("queryInsight.tabs.session")}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-3">
        <Overview insight={data} target={target} />
      </TabsContent>
      <TabsContent value="plan" className="space-y-3">
        <ExecutionPlanPanel target={target} insight={data} />
      </TabsContent>
      <TabsContent value="session" className="space-y-3">
        <SessionDetail target={target} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Reusable "click a query, see its cost and the cheaper rewrite" panel.
 * Pass `target=null` to close it.
 */
export function QueryInsightDialog({
  target,
  onClose,
}: {
  target: QueryInsightTarget | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-[90vw] overflow-y-auto md:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("queryInsight.title")}</DialogTitle>
          <DialogDescription>{t("queryInsight.subtitle")}</DialogDescription>
        </DialogHeader>
        {target && <Body target={target} />}
      </DialogContent>
    </Dialog>
  );
}
