"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileBarChart2,
  FileCode,
  FileJson,
  Info,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import { Skeleton } from "@/components/ui/skeleton";

import { endpoints, type ReportDict } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useI18n, type TFunction } from "@/lib/i18n";
import { formatBytes } from "@/lib/utils";

const SECTION_IDS = [
  "summary",
  "health",
  "diagnostics",
  "storage",
  "replication",
  "connections",
  "roles",
] as const;
type ReportSectionId = (typeof SECTION_IDS)[number];

type Row = Record<string, unknown>;

function getReportVal<T>(report: ReportDict | undefined, path: string, fallback: T): T {
  if (!report) return fallback;
  let cur: unknown = report;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Row)) {
      cur = (cur as Row)[part];
    } else {
      return fallback;
    }
  }
  return (cur ?? fallback) as T;
}

function getRows(report: ReportDict | undefined, path: string): Row[] {
  const value = getReportVal<unknown>(report, path, []);
  return Array.isArray(value) ? (value as Row[]) : [];
}

function severityToRisk(severity: string): RiskLevel {
  switch (severity) {
    case "OK":
      return "OK";
    case "INFO":
      return "INFO";
    case "WARNING":
      return "WARNING";
    default:
      return "DANGEROUS";
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Standalone export: its own CSS, readable on white paper in any app theme. */
function buildHtmlReport(
  report: ReportDict,
  generatedAt: string,
  lang: string,
  t: TFunction,
  formatNumber: (value: number) => string
): string {
  const db = escapeHtml(getReportVal<string>(report, "health.database", "-"));
  const version = escapeHtml(getReportVal<string>(report, "health.server_version", "-"));
  const when = escapeHtml(generatedAt);
  const score = formatNumber(getReportVal<number>(report, "health.score", 0));
  const current = formatNumber(getReportVal<number>(report, "connections.summary.current_connections", 0));
  const max = formatNumber(getReportVal<number>(report, "connections.summary.max_connections", 0));
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PgGuardian — ${db} — ${when}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#ffffff;color:#412C70;margin:0;padding:24px;line-height:1.5}
  .wrap{max-width:1100px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px;color:#412C70;border-bottom:3px solid #FFB347;padding-bottom:6px}
  h2{font-size:14px;margin:0 0 8px;color:#412C70}
  .meta{font-size:12px;margin-bottom:16px}
  .card{border:1px solid #8B85C1;border-radius:6px;padding:12px;margin-bottom:12px}
  .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
  .kpi{background:#EAE8FF;border-radius:6px;padding:8px 12px}
  .kpi-label{font-size:11px}
  .kpi-val{font-size:20px;font-weight:700;font-family:ui-monospace,Consolas,monospace}
  pre{background:#412C70;color:#B3F968;padding:12px;border-radius:6px;overflow:auto;font-size:11px;white-space:pre-wrap;word-break:break-all}
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(t("report.export.title"))}</h1>
  <div class="meta">
    ${escapeHtml(t("report.export.meta", { database: "\u0000" })).replace("\u0000", `<b>${db}</b>`)} · PostgreSQL ${version} · ${escapeHtml(t("report.export.generated", { when: generatedAt }))}
  </div>
  <div class="card">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${escapeHtml(t("report.kpi.score"))}</div><div class="kpi-val">${score}</div></div>
      <div class="kpi"><div class="kpi-label">${escapeHtml(t("report.kpi.connections"))}</div><div class="kpi-val">${current} / ${max}</div></div>
    </div>
  </div>
  <div class="card">
    <h2>${escapeHtml(t("report.export.fullJson"))}</h2>
    <pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
  </div>
</div>
</body>
</html>`;
}

function downloadFile(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function InlineError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-3 rounded-md border border-destructive/30 bg-card px-3 py-3 text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {t("common.loadFailed")}
      <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        {t("common.retry")}
      </Button>
    </div>
  );
}

function RowsSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5" aria-label={t("common.loading")}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  badge,
  valueClass,
}: {
  label: string;
  value?: string;
  sub?: string;
  badge?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {badge}
      </div>
      {value === undefined ? (
        <Skeleton className="mt-1 h-5 w-16" />
      ) : (
        <div className={`truncate font-mono text-base font-semibold ${valueClass ?? ""}`} title={value}>
          {value}
        </div>
      )}
      {sub !== undefined && (
        <div className="truncate font-mono text-xs text-muted-foreground" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function ReportPage() {
  const { t, locale, formatDate, formatNumber } = useI18n();
  const [open, setOpen] = useState<Record<ReportSectionId, boolean>>({
    summary: true,
    health: true,
    diagnostics: true,
    storage: true,
    replication: true,
    connections: true,
    roles: true,
  });

  const {
    data: report,
    isLoading,
    isError,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: qk.diagnostics.report(50),
    queryFn: () => endpoints.getReport(50),
    staleTime: 30000,
  });

  // /report carries neither replication nor roles, so they have their own queries.
  const replication = useQuery({
    queryKey: qk.replication.status(),
    queryFn: () => endpoints.getReplication(),
  });

  const toggle = (id: ReportSectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const generatedAt = useMemo(
    () => (dataUpdatedAt ? formatDate(dataUpdatedAt) : "-"),
    [dataUpdatedAt, formatDate]
  );

  const kpi = useMemo(() => {
    const current = getReportVal<number>(report, "connections.summary.current_connections", 0);
    const max = getReportVal<number>(report, "connections.summary.max_connections", 0);
    return {
      score: getReportVal<number>(report, "health.score", 0),
      db: getReportVal<string>(report, "health.database", "-"),
      version: getReportVal<string>(report, "health.server_version", "-"),
      current,
      max,
      usage: max > 0 ? current / max : 0,
      totalLocks: getReportVal<number>(report, "locks.summary.total_locks", 0),
      blocking: getReportVal<number>(report, "locks.summary.blocking_pairs", 0),
    };
  }, [report]);

  const safeDb = String(kpi.db).replace(/[^\w.-]+/g, "_") || "all";

  const handleDownloadJson = () => {
    if (!report) return;
    try {
      downloadFile(
        JSON.stringify(report, null, 2),
        "application/json",
        `pgguardian-report-${safeDb}-${Date.now()}.json`
      );
      toast.success(t("report.toast.jsonDone"));
    } catch {
      toast.error(t("report.toast.jsonFailed"));
    }
  };

  const handleDownloadHtml = () => {
    if (!report) return;
    try {
      downloadFile(
        buildHtmlReport(report, generatedAt, locale, t, (n) => formatNumber(n)),
        "text/html",
        `pgguardian-report-${safeDb}-${Date.now()}.html`
      );
      toast.success(t("report.toast.htmlDone"));
    } catch {
      toast.error(t("report.toast.htmlFailed"));
    }
  };

  const showValues = !isLoading && !isError;
  const replicaCount = replication.data?.replicas?.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <FileBarChart2 className="h-4 w-4 text-muted-foreground" />
            {t("report.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("report.subtitle", { when: generatedAt })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadJson} disabled={!report}>
            <FileJson className="h-3.5 w-3.5" />
            {t("report.downloadJson")}
          </Button>
          <Button size="sm" onClick={handleDownloadHtml} disabled={!report}>
            <FileCode className="h-3.5 w-3.5" />
            {t("report.downloadHtml")}
          </Button>
        </div>
      </div>

      {isError && !report ? (
        <InlineError onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile
              label={t("report.kpi.score")}
              value={showValues ? `${formatNumber(kpi.score)} / 100` : undefined}
              badge={
                showValues ? (
                  <RiskBadge
                    riskLevel={kpi.score >= 85 ? "OK" : kpi.score >= 60 ? "WARNING" : "DANGEROUS"}
                    size="sm"
                    showIcon={false}
                  >
                    {getReportVal<string>(report, "health.status", "-")}
                  </RiskBadge>
                ) : undefined
              }
            />
            <Tile
              label={t("report.kpi.database")}
              value={showValues ? kpi.db : undefined}
              sub={showValues ? kpi.version : undefined}
            />
            <Tile
              label={t("report.kpi.connections")}
              value={
                showValues
                  ? `${formatNumber(kpi.current)} / ${formatNumber(kpi.max)}`
                  : undefined
              }
              badge={
                showValues ? (
                  <RiskBadge
                    riskLevel={kpi.usage >= 0.85 ? "DANGEROUS" : kpi.usage >= 0.6 ? "WARNING" : "OK"}
                    size="sm"
                    showIcon={false}
                  >
                    {formatNumber(kpi.usage, { style: "percent" })}
                  </RiskBadge>
                ) : undefined
              }
            />
            <Tile
              label={t("report.kpi.locks")}
              value={showValues ? formatNumber(kpi.totalLocks) : undefined}
              sub={
                showValues
                  ? t("report.kpi.locksSub", {
                      blocking: formatNumber(kpi.blocking),
                      replicas: replicaCount === undefined ? "-" : formatNumber(replicaCount),
                    })
                  : undefined
              }
              badge={
                showValues ? (
                  kpi.blocking > 0 ? (
                    <RiskBadge riskLevel="DANGEROUS" size="sm" showIcon={false}>
                      {t("report.kpi.blocked")}
                    </RiskBadge>
                  ) : (
                    <RiskBadge riskLevel="OK" size="sm" showIcon={false}>
                      {t("report.kpi.clear")}
                    </RiskBadge>
                  )
                ) : undefined
              }
            />
          </div>

          <div className="space-y-2">
            {SECTION_IDS.map((id) => (
              <CollapsibleSection
                key={id}
                title={t(`report.sections.${id}.title`)}
                description={t(`report.sections.${id}.description`)}
                open={open[id]}
                onToggle={() => toggle(id)}
              >
                <SectionContent id={id} report={report} isLoading={isLoading} />
              </CollapsibleSection>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
      >
        <span className="min-w-0">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="ml-2 text-xs text-muted-foreground">{description}</span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t border-border px-3 py-2">{children}</div>}
    </section>
  );
}

function SectionContent({
  id,
  report,
  isLoading,
}: {
  id: ReportSectionId;
  report: ReportDict | undefined;
  isLoading: boolean;
}) {
  if (id === "replication") return <ReplicationSection />;
  if (id === "roles") return <RolesSection />;
  if (isLoading && !report) return <RowsSkeleton />;

  switch (id) {
    case "summary":
      return <SummarySection report={report} />;
    case "health":
      return <HealthSection report={report} />;
    case "diagnostics":
      return <DiagnosticsSection report={report} />;
    case "storage":
      return <StorageSection report={report} />;
    case "connections":
      return <ConnectionsSection report={report} />;
  }
}

function SummarySection({ report }: { report: ReportDict | undefined }) {
  const { t, formatDate, formatNumber } = useI18n();
  const generated = getReportVal<string>(report, "health.generated_at", "");
  const overview = Object.fromEntries(
    Object.entries(report ?? {}).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? t("report.summary.items", { count: v.length })
        : typeof v === "object" && v
          ? "{...}"
          : v,
    ])
  );
  const rows = [
    { label: t("report.summary.keys"), val: formatNumber(Object.keys(report ?? {}).length) },
    { label: t("report.kpi.score"), val: formatNumber(getReportVal<number>(report, "health.score", 0)) },
    { label: t("report.summary.status"), val: getReportVal<string>(report, "health.status", "-") },
    { label: t("report.summary.generatedAt"), val: generated ? formatDate(generated) : "-" },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.label} className="rounded-md border border-border px-3 py-1.5">
            <div className="text-xs text-muted-foreground">{r.label}</div>
            <div className="truncate font-mono text-xs font-medium">{r.val}</div>
          </div>
        ))}
      </div>
      <details>
        <summary className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
          {t("report.summary.raw")}
        </summary>
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {JSON.stringify(overview, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function HealthSection({ report }: { report: ReportDict | undefined }) {
  const { t } = useI18n();
  const checks = getRows(report, "health.checks");
  if (checks.length === 0) return <EmptyState text={t("report.health.empty")} />;
  return (
    <div className="divide-y divide-border">
      {checks.slice(0, 100).map((c, i) => {
        const severity = String(c.severity ?? c.status ?? "UNKNOWN").toUpperCase();
        return (
          <div key={i} className="flex flex-wrap items-start gap-2 py-1.5 text-xs">
            <RiskBadge riskLevel={severityToRisk(severity)} size="sm" showIcon={false} className="shrink-0">
              {severity}
            </RiskBadge>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{String(c.name ?? `check-${i}`)}</span>
                {c.value !== undefined && c.value !== null && (
                  <code className="font-mono text-info">{String(c.value)}</code>
                )}
                {c.threshold !== undefined && c.threshold !== null && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    threshold={String(c.threshold)}
                  </Badge>
                )}
              </div>
              {Boolean(c.description) && (
                <p className="mt-0.5 text-muted-foreground">{String(c.description)}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiagnosticsSection({ report }: { report: ReportDict | undefined }) {
  const { t } = useI18n();
  const findings = getRows(report, "findings");
  if (findings.length === 0) return <EmptyState text={t("report.diagnostics.empty")} />;
  return (
    <div className="divide-y divide-border">
      {findings.slice(0, 100).map((f, i) => {
        const severity = String(f.severity ?? "INFO").toUpperCase();
        return (
          <div key={i} className="flex flex-wrap items-start gap-2 py-1.5 text-xs">
            <RiskBadge riskLevel={severityToRisk(severity)} size="sm" showIcon={false} className="shrink-0">
              {severity}
            </RiskBadge>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{String(f.title ?? f.code ?? `finding-${i}`)}</span>
                {Boolean(f.code) && (
                  <code className="font-mono text-muted-foreground">{String(f.code)}</code>
                )}
              </div>
              <p className="mt-0.5 text-muted-foreground">{String(f.description ?? "")}</p>
              {Boolean(f.recommendation) && (
                <p className="mt-0.5 flex items-start gap-1 text-success">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                  {String(f.recommendation)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StorageSection({ report }: { report: ReportDict | undefined }) {
  const { t } = useI18n();
  const top = [
    ...getRows(report, "storage.tables").map((o) => ({
      kind: "TABLE",
      name: [o.schema_name, o.table_name].filter(Boolean).join("."),
      bytes: Number(o.total_size_bytes ?? 0),
    })),
    ...getRows(report, "storage.databases").map((o) => ({
      kind: "DB",
      name: String(o.database ?? ""),
      bytes: Number(o.size_bytes ?? 0),
    })),
    ...getRows(report, "storage.indexes").map((o) => ({
      kind: "IDX",
      name: [o.schema_name, o.index_name].filter(Boolean).join("."),
      bytes: Number(o.size_bytes ?? 0),
    })),
  ]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  if (top.length === 0) return <EmptyState text={t("report.storage.empty")} />;
  const maxBytes = Math.max(1, top[0].bytes);
  return (
    <div className="space-y-1.5">
      {top.map((item, i) => (
        <div key={`${item.kind}-${item.name}`} className="text-xs">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <span className="w-6 font-mono text-muted-foreground">#{i + 1}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {item.kind}
            </Badge>
            <code className="min-w-0 truncate font-mono">{item.name}</code>
            <span className="ml-auto font-mono font-semibold">{formatBytes(item.bytes, 1)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded bg-muted">
            <div className="h-full rounded bg-info" style={{ width: `${(item.bytes / maxBytes) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplicationSection() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.replication.status(),
    queryFn: () => endpoints.getReplication(),
  });
  if (isLoading) return <RowsSkeleton />;
  if (isError) return <InlineError onRetry={() => refetch()} />;
  const replicas = data?.replicas ?? [];
  const slots = data?.slots ?? [];
  if (replicas.length === 0 && slots.length === 0) {
    return <EmptyState text={t("report.replication.empty")} />;
  }
  return (
    <div className="space-y-2 text-xs">
      {replicas.length > 0 && (
        <div>
          <div className="mb-1 font-medium">{t("report.replication.replicas", { count: replicas.length })}</div>
          <div className="divide-y divide-border rounded-md border border-border">
            {replicas.map((r, i) => {
              const state = r.state ?? "-";
              return (
                <div key={i} className="flex flex-wrap items-center gap-3 px-3 py-1.5">
                  <RiskBadge
                    riskLevel={state.toLowerCase() === "streaming" ? "OK" : "WARNING"}
                    size="sm"
                    showIcon={false}
                  >
                    {state}
                  </RiskBadge>
                  <code className="font-mono font-medium">
                    {r.application_name || r.client_address || `replica-${i + 1}`}
                  </code>
                  <span className="font-mono text-muted-foreground">
                    {r.client_address ?? "-"}
                    {r.username ? ` (${r.username})` : ""}
                  </span>
                  <span className="ml-auto font-mono">
                    {t("report.replication.lag", { value: formatBytes(Number(r.replay_lag_bytes ?? 0), 1) })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {slots.length > 0 && (
        <div>
          <div className="mb-1 font-medium">{t("report.replication.slots", { count: slots.length })}</div>
          <div className="divide-y divide-border rounded-md border border-border">
            {slots.map((s) => (
              <div key={s.slot_name} className="flex flex-wrap items-center gap-3 px-3 py-1.5">
                <RiskBadge riskLevel={s.active ? "OK" : "WARNING"} size="sm" showIcon={false}>
                  {s.active ? t("report.replication.active") : t("report.replication.inactive")}
                </RiskBadge>
                <code className="font-mono font-medium">{s.slot_name}</code>
                {s.slot_type && <span className="font-mono text-muted-foreground">{s.slot_type}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionsSection({ report }: { report: ReportDict | undefined }) {
  const { t, formatNumber } = useI18n();
  const summary = getReportVal<Row>(report, "connections.summary", {});
  const connections = getRows(report, "connections.connections").slice(0, 20);
  const current = Number(summary.current_connections ?? 0);
  const max = Number(summary.max_connections ?? 0);
  const usage = max > 0 ? current / max : 0;
  const tiles = [
    { label: t("report.connections.active"), val: Number(summary.active ?? 0), color: "text-success" },
    { label: t("report.connections.idle"), val: Number(summary.idle ?? 0), color: "text-muted-foreground" },
    {
      label: t("report.connections.idleInTransaction"),
      val: Number(summary.idle_in_transaction ?? 0),
      color: "text-warning",
    },
    { label: t("report.connections.waiting"), val: Number(summary.waiting ?? 0), color: "text-destructive" },
  ];
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((k) => (
          <div key={k.label} className="rounded-md border border-border px-3 py-1.5">
            <div className="text-muted-foreground">{k.label}</div>
            <div className={`font-mono text-base font-semibold ${k.color}`}>{formatNumber(k.val)}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted-foreground">{t("report.connections.usage")}</span>
          <span className="font-mono">
            {formatNumber(current)} / {formatNumber(max)} ·{" "}
            {formatNumber(usage, { style: "percent", maximumFractionDigits: 1 })}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded bg-muted">
          <div
            className={`h-full rounded ${usage >= 0.85 ? "bg-destructive" : usage >= 0.6 ? "bg-warning" : "bg-success"}`}
            style={{ width: `${Math.min(100, usage * 100)}%` }}
          />
        </div>
      </div>
      {connections.length > 0 && (
        <div className="divide-y divide-border rounded-md border border-border">
          {connections.map((c, i) => {
            const state = String(c.state ?? "-");
            const lower = state.toLowerCase();
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5 font-mono">
                <RiskBadge
                  riskLevel={lower === "active" ? "OK" : lower.includes("idle") ? "INFO" : "WARNING"}
                  size="sm"
                  showIcon={false}
                >
                  {state}
                </RiskBadge>
                <span>pid={String(c.pid ?? "-")}</span>
                <span className="font-medium">{String(c.user ?? "-")}</span>
                <span className="text-muted-foreground">
                  @{String(c.database ?? "-")} · {String(c.client_address ?? "-")}
                </span>
                {Boolean(c.application_name) && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {String(c.application_name)}
                  </Badge>
                )}
                {c.query_duration_seconds !== undefined && c.query_duration_seconds !== null && (
                  <span className="ml-auto text-muted-foreground">
                    {t("report.connections.queryDuration", {
                      seconds: formatNumber(Number(c.query_duration_seconds), {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RolesSection() {
  const { t, formatNumber } = useI18n();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.roles.all(),
    queryFn: () => endpoints.listRoles(),
  });
  if (isLoading) return <RowsSkeleton />;
  if (isError) return <InlineError onRetry={() => refetch()} />;
  const roles = data ?? [];
  if (roles.length === 0) return <EmptyState text={t("report.roles.empty")} />;
  const tiles = [
    { label: t("report.roles.total"), val: roles.length },
    { label: "SUPERUSER", val: roles.filter((r) => r.superuser).length },
    { label: "LOGIN", val: roles.filter((r) => r.can_login).length },
    { label: "CREATEDB", val: roles.filter((r) => r.createdb).length },
    { label: "CREATEROLE", val: roles.filter((r) => r.createrole).length },
  ];
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {tiles.map((k) => (
          <div key={k.label} className="rounded-md border border-border px-3 py-1.5">
            <div className="text-muted-foreground">{k.label}</div>
            <div className="font-mono text-base font-semibold">{formatNumber(k.val)}</div>
          </div>
        ))}
      </div>
      <div className="divide-y divide-border rounded-md border border-border">
        {roles.slice(0, 50).map((r) => (
          <div key={r.name} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <code className="min-w-[160px] font-mono font-medium">{r.name}</code>
            <RiskBadge riskLevel={r.superuser ? "DANGEROUS" : "INFO"} size="sm" showIcon={false}>
              {r.superuser ? "SUPERUSER" : t("report.roles.standard")}
            </RiskBadge>
            {r.can_login && <Badge variant="outline" className="font-mono text-[10px]">LOGIN</Badge>}
            {r.createdb && <Badge variant="outline" className="font-mono text-[10px]">CREATEDB</Badge>}
            {r.createrole && <Badge variant="outline" className="font-mono text-[10px]">CREATEROLE</Badge>}
            {r.connection_limit >= 0 && (
              <Badge variant="outline" className="font-mono text-[10px]">
                conn_limit={r.connection_limit}
              </Badge>
            )}
            {r.valid_until && (
              <Badge variant="outline" className="font-mono text-[10px]">
                valid_until={r.valid_until.slice(0, 10)}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-2 text-center text-xs text-muted-foreground">{text}</p>;
}
