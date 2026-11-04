"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

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
import { insightApi, type QueryInsight } from "@/lib/api/insight";
import type { Recommendation } from "@/lib/api/statements";
import { qk } from "@/lib/api/queryKeys";
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
  wait_event_type?: string | null;
  wait_event?: string | null;
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
  const seconds = target.duration_seconds;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <MetaChip label="PID" value={target.pid ?? null} />
      <MetaChip label={t("diagnostics.columns.user")} value={target.user} />
      <MetaChip label={t("diagnostics.columns.database")} value={target.database} />
      <MetaChip label={t("diagnostics.columns.state")} value={target.state} />
      <MetaChip
        label={t("queryInsight.wait")}
        value={
          target.wait_event_type
            ? `${target.wait_event_type}${target.wait_event ? `:${target.wait_event}` : ""}`
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

function Body({ target }: { target: QueryInsightTarget }) {
  const { t } = useI18n();
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
    <div className="space-y-3">
      <Meta target={target} />
      <CodeBlock code={data.formatted} label="SQL" />
      <CostCard insight={data} />
      {data.plan_status !== "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          {t("statements.advice.noPlan", {
            reason: t(`statements.plan.reasons.${data.plan_reason ?? "planner_error"}`),
          })}
        </p>
      )}
      <Suggestions insight={data} query={target.query} />
      <Findings insight={data} />
    </div>
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
