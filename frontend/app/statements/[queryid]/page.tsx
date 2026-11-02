"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IfWriter } from "@/components/role-guard";
import { APP_SNIPPETS } from "@/components/statements/app-snippets";
import { CodeBlock } from "@/components/statements/code-block";
import { blocksToBytes, formatBytes, formatDuration } from "@/components/statements/format";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/api/queryKeys";
import {
  statementsApi,
  type Advice,
  type PlanNodeJson,
  type PlanResult,
  type Recommendation,
  type StatementDetail,
} from "@/lib/api/statements";
import { cn } from "@/lib/utils";
import { useProfileStore } from "@/store/useProfileStore";

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

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-base font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Overview({ statement }: { statement: StatementDetail }) {
  const { t, formatNumber } = useI18n();
  const number = (value: number | null, digits = 0) =>
    value === null ? "–" : formatNumber(value, { maximumFractionDigits: digits });
  const total = statement.total_ms + (statement.plan_ms ?? 0);
  const parts = [
    { key: "execution", value: statement.total_ms - (statement.io_read_ms ?? 0) - (statement.jit_ms ?? 0), color: "bg-primary" },
    { key: "ioRead", value: statement.io_read_ms ?? 0, color: "bg-warning" },
    { key: "jit", value: statement.jit_ms ?? 0, color: "bg-info" },
    { key: "planning", value: statement.plan_ms ?? 0, color: "bg-success" },
  ].filter((part) => part.value > 0);

  return (
    <div className="space-y-3">
      <CodeBlock code={statement.formatted} label="SQL" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label={t("statements.columns.calls")} value={number(statement.calls)} hint={statement.calls_per_min === null ? undefined : t("statements.perMin", { value: number(statement.calls_per_min, 1) })} />
        <Metric label={t("statements.columns.load")} value={`${(statement.load_pct ?? 0).toFixed(1)}%`} />
        <Metric label={t("statements.columns.total")} value={formatDuration(statement.total_ms)} />
        <Metric label={t("statements.columns.mean")} value={formatDuration(statement.mean_ms)} hint={`${formatDuration(statement.min_ms)} – ${formatDuration(statement.max_ms)}`} />
        <Metric label={t("statements.detail.stddev")} value={formatDuration(statement.stddev_ms)} />
        <Metric label={t("statements.columns.rowsPerCall")} value={number(statement.rows_per_call, 1)} />
        <Metric label={t("statements.columns.cache")} value={statement.cache_hit_pct === null ? "–" : `${statement.cache_hit_pct.toFixed(1)}%`} />
        <Metric label={t("statements.detail.blocksRead")} value={formatBytes(blocksToBytes(statement.blks_read))} />
        <Metric label={t("statements.columns.temp")} value={formatBytes(blocksToBytes(statement.temp_written))} />
        <Metric label={t("statements.columns.wal")} value={formatBytes(statement.wal_bytes)} />
      </div>

      {total > 0 && parts.length > 1 && (
        <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium">{t("statements.detail.timeBreakdown")}</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {parts.map((part) => (
              <div key={part.key} className={part.color} style={{ width: `${(part.value / total) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {parts.map((part) => (
              <span key={part.key} className="inline-flex items-center gap-1">
                <span className={cn("h-2 w-2 rounded-full", part.color)} />
                {t(`statements.detail.parts.${part.key}`)} {formatDuration(part.value)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-3 text-xs">
          <p className="mb-1.5 font-medium">{t("statements.detail.runBy")}</p>
          <p className="font-mono text-muted-foreground">{statement.users?.join(", ")}</p>
        </div>
        {statement.variants.length > 0 && (
          <div className="rounded-md border border-border bg-card p-3 text-xs">
            <p className="mb-1.5 font-medium">
              {t("statements.detail.variants", { count: statement.variants.length })}
            </p>
            <ul className="space-y-0.5 font-mono">
              {statement.variants.slice(0, 8).map((variant) => (
                <li key={variant.queryid}>
                  <Link href={`/statements/${variant.queryid}`} className="text-info hover:underline">
                    {variant.queryid}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    {number(variant.calls)} · {formatDuration(variant.total_ms)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTree({ node, depth = 0 }: { node: PlanNodeJson; depth?: number }) {
  const { t, formatNumber } = useI18n();
  const flagged = node["Node Type"] === "Seq Scan" && Boolean(node.Filter);
  return (
    <div className={cn(depth > 0 && "ml-4 border-l border-border pl-3")}>
      <div className={cn("my-1 rounded-md border px-2.5 py-1.5", flagged ? "border-warning/50 bg-warning/5" : "border-border bg-card")}>
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-semibold">{node["Join Type"] ? `${node["Join Type"]} ` : ""}{node["Node Type"]}</span>
          {node["Relation Name"] && <span className="font-mono text-info">{node["Relation Name"]}</span>}
          {node["Index Name"] && <span className="font-mono text-success">{node["Index Name"]}</span>}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {t("statements.plan.nodeStats", {
              cost: formatNumber(node["Total Cost"], { maximumFractionDigits: 1 }),
              rows: formatNumber(node["Plan Rows"]),
            })}
            {node["Actual Total Time"] !== undefined &&
              ` · ${formatDuration(node["Actual Total Time"])} · ${formatNumber(node["Actual Rows"] ?? 0)}`}
          </span>
        </div>
        {[
          ["Filter", node.Filter],
          ["Index Cond", node["Index Cond"]],
          ["Hash Cond", node["Hash Cond"]],
          ["Sort Key", node["Sort Key"]?.join(", ")],
        ].map(
          ([label, value]) =>
            value && (
              <p key={label} className="mt-0.5 break-words font-mono text-[11px] text-muted-foreground">
                {label}: {value}
              </p>
            )
        )}
      </div>
      {node.Plans?.map((child, index) => <PlanTree key={index} node={child} depth={depth + 1} />)}
    </div>
  );
}

function PlanFailure({ plan }: { plan: PlanResult }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[13px]">
      <p className="font-medium">{t(`statements.plan.reasons.${plan.reason ?? "planner_error"}`)}</p>
      {plan.message && (
        <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
          {plan.message}
        </pre>
      )}
    </div>
  );
}

function PlanTab({ queryid }: { queryid: string }) {
  const { t } = useI18n();
  const [searchPath, setSearchPath] = React.useState("");
  const [values, setValues] = React.useState("");
  const [showJson, setShowJson] = React.useState(false);

  const explain = useMutation({
    mutationFn: (options: { analyze?: boolean; custom?: boolean }) =>
      statementsApi.explain(queryid, {
        search_path: searchPath || undefined,
        analyze: options.analyze,
        params: options.custom || options.analyze
          ? values.split("\n").map((v) => v.trim()).filter(Boolean)
          : undefined,
      }),
  });

  const { mutate } = explain;
  React.useEffect(() => {
    mutate({});
  }, [mutate]);

  const plan = explain.data;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-md border border-border bg-card p-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          search_path
          <Input
            value={searchPath}
            onChange={(e) => setSearchPath(e.target.value)}
            placeholder="app, public"
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          {t("statements.plan.paramValues")}
          <textarea
            value={values}
            onChange={(e) => setValues(e.target.value)}
            rows={2}
            placeholder={"42\nopen"}
            className="w-full rounded-md border border-input bg-card px-3 py-1.5 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button size="sm" variant="outline" onClick={() => mutate({})} disabled={explain.isPending}>
            {t("statements.plan.generic")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => mutate({ custom: true })} disabled={explain.isPending || !values.trim()}>
            {t("statements.plan.custom")}
          </Button>
          <IfWriter>
            <Button size="sm" variant="outline" onClick={() => mutate({ analyze: true })} disabled={explain.isPending}>
              EXPLAIN ANALYZE
            </Button>
          </IfWriter>
        </div>
        <p className="text-[11px] text-muted-foreground md:col-span-2">{t("statements.plan.analyzeNote")}</p>
      </div>

      {explain.isPending && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {explain.isError && <PlanFailure plan={{ status: "failed", plan: null, mode: "generic", reason: "planner_error", message: (explain.error as Error).message }} />}
      {plan && plan.status !== "ok" && <PlanFailure plan={plan} />}
      {plan?.status === "ok" && plan.plan && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-2 py-0.5 text-[11px]">
              {t(`statements.plan.mode.${plan.mode}`)}
            </Badge>
            {plan.mode === "generic" && (
              <span className="text-[11px] text-muted-foreground">{t("statements.plan.genericNote")}</span>
            )}
            <button type="button" onClick={() => setShowJson((v) => !v)} className="ml-auto text-[11px] text-info hover:underline">
              {t(showJson ? "statements.plan.showTree" : "statements.plan.showJson")}
            </button>
          </div>
          {showJson ? (
            <CodeBlock code={JSON.stringify(plan.plan, null, 2)} label="JSON" />
          ) : (
            <PlanTree node={plan.plan[0].Plan} />
          )}
        </div>
      )}
    </div>
  );
}

function RecommendationsTab({ advice, query }: { advice: Advice; query: string }) {
  const { t, formatNumber } = useI18n();
  return (
    <div className="space-y-3">
      {advice.plan_status !== "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          {t("statements.advice.noPlan", {
            reason: t(`statements.plan.reasons.${advice.plan_reason ?? "planner_error"}`),
          })}
        </p>
      )}
      {!advice.parsed && (
        <p className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
          {t("statements.advice.notParsed")}
        </p>
      )}

      {advice.suggested_sql && (
        <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold">{t("statements.advice.suggestedTitle")}</p>
            {advice.cost && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {t("statements.advice.cost", {
                  before: formatNumber(advice.cost.before, { maximumFractionDigits: 1 }),
                  after: formatNumber(advice.cost.after, { maximumFractionDigits: 1 }),
                })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("statements.advice.suggestedDesc", {
              applied: advice.applied.map((code) => t(`statements.rules.${code}.title`)).join(", "),
            })}
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            <CodeBlock code={query} label={t("statements.advice.current")} />
            <CodeBlock code={advice.suggested_sql} label={t("statements.advice.suggested")} />
          </div>
        </div>
      )}

      {advice.recommendations.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-center text-[13px] text-muted-foreground">
          {t("statements.advice.none")}
        </p>
      ) : (
        advice.recommendations.map((item, index) => (
          <article key={`${item.code}-${index}`} className="space-y-2 rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", SEVERITY_STYLE[item.severity])}>
                {t(`statements.severity.${item.severity}`)}
              </span>
              <h3 className="text-[13px] font-semibold">{t(`statements.rules.${item.code}.title`)}</h3>
              <span
                title={t(`statements.safety.${item.safety}.desc`)}
                className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold", SAFETY_STYLE[item.safety])}
              >
                {t(`statements.safety.${item.safety}.label`)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t(`statements.rules.${item.code}.problem`)}</p>
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
        ))
      )}
    </div>
  );
}

function ApplicationTab({ advice }: { advice: Advice }) {
  const { t } = useI18n();
  const { locator } = advice;
  const codes = Array.from(new Set(advice.recommendations.map((r) => r.code)));
  const tags = Object.entries(locator.sqlcommenter);
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-md border border-border bg-card p-3 text-xs">
        <h3 className="text-[13px] font-semibold">{t("statements.app.findTitle")}</h3>
        <p className="text-muted-foreground">{t("statements.app.findDesc")}</p>
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[160px_1fr]">
          {tags.length > 0 && (
            <>
              <dt className="text-muted-foreground">sqlcommenter</dt>
              <dd className="font-mono">{tags.map(([k, v]) => `${k}=${v}`).join(" · ")}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t("statements.app.applications")}</dt>
          <dd className="font-mono">{locator.applications.join(", ") || t("statements.app.notRunning")}</dd>
          {locator.clients.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t("statements.app.clients")}</dt>
              <dd className="font-mono">{locator.clients.join(", ")}</dd>
            </>
          )}
          {locator.orm_hint && (
            <>
              <dt className="text-muted-foreground">{t("statements.app.ormHint")}</dt>
              <dd className="font-mono">{locator.orm_hint}</dd>
            </>
          )}
          {locator.tables.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t("statements.app.tables")}</dt>
              <dd className="font-mono">{locator.tables.join(", ")}</dd>
            </>
          )}
        </dl>
        {locator.search_terms.length > 0 && (
          <CodeBlock
            code={locator.search_terms.map((term) => `git grep -n -i "${term}"`).join("\n")}
            label={t("statements.app.searchCode")}
          />
        )}
        {tags.length === 0 && (
          <p className="text-[11px] text-muted-foreground">{t("statements.app.tagHint")}</p>
        )}
      </section>

      {codes.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-center text-[13px] text-muted-foreground">
          {t("statements.app.nothing")}
        </p>
      ) : (
        codes.map((code) => (
          <section key={code} className="space-y-2 rounded-md border border-border bg-card p-3">
            <h3 className="text-[13px] font-semibold">{t(`statements.rules.${code}.title`)}</h3>
            <p className="text-xs leading-relaxed">{t(`statements.rules.${code}.app`)}</p>
            {APP_SNIPPETS[code]?.map((snippet) => (
              <CodeBlock key={snippet.label} code={snippet.code} label={snippet.label} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

export default function StatementDetailPage() {
  const { t } = useI18n();
  const { queryid } = useParams<{ queryid: string }>();
  const profile = useProfileStore((s) => s.selectedProfileName);

  const detail = useQuery({
    queryKey: qk.statements.detail(profile, queryid),
    queryFn: () => statementsApi.detail(queryid),
  });
  const advice = useQuery({
    queryKey: qk.statements.advice(profile, queryid),
    queryFn: () => statementsApi.recommendations(queryid),
    enabled: detail.isSuccess,
  });

  const findings = advice.data?.recommendations.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link href="/statements" aria-label={t("statements.title")}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">{t("statements.detail.title")}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            queryid {queryid}
            {detail.data && ` · ${detail.data.kind}`}
          </p>
        </div>
      </div>

      {detail.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {detail.isError && (
        <div className="rounded-lg border border-destructive/40 p-4 text-[13px]">
          <p className="mb-2 font-medium">{t("common.loadFailed")}</p>
          <p className="mb-3 text-muted-foreground">{(detail.error as Error).message}</p>
          <Button size="sm" variant="outline" onClick={() => detail.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {detail.data && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t("statements.tabs.overview")}</TabsTrigger>
            <TabsTrigger value="recommendations">
              {t("statements.tabs.recommendations")}
              {findings ? ` (${findings})` : ""}
            </TabsTrigger>
            <TabsTrigger value="plan">{t("statements.tabs.plan")}</TabsTrigger>
            <TabsTrigger value="application">{t("statements.tabs.application")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-3">
            <Overview statement={detail.data} />
          </TabsContent>
          <TabsContent value="plan" className="mt-3">
            <PlanTab queryid={queryid} />
          </TabsContent>
          {(["recommendations", "application"] as const).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-3">
              {advice.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              {advice.isError && (
                <div className="rounded-lg border border-destructive/40 p-4 text-[13px]">
                  <p className="mb-3 text-muted-foreground">{(advice.error as Error).message}</p>
                  <Button size="sm" variant="outline" onClick={() => advice.refetch()}>
                    {t("common.retry")}
                  </Button>
                </div>
              )}
              {advice.data &&
                (tab === "recommendations" ? (
                  <RecommendationsTab advice={advice.data} query={detail.data.query} />
                ) : (
                  <ApplicationTab advice={advice.data} />
                ))}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
