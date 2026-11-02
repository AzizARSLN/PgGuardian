"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  HardDrive,
  Lock,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import { endpoints } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { useI18n, useT, type TFunction } from "@/lib/i18n";

const BAR_FILLS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const LAG_WARNING_BYTES = 10 * 1024 * 1024;
const LAG_DANGEROUS_BYTES = 100 * 1024 * 1024;
const METRIC = "font-mono tabular-nums";

function formatSeconds(seconds: number, t: TFunction): string {
  if (!Number.isFinite(seconds) || seconds < 1) {
    return t("dashboard.units.second", { n: "<1" });
  }
  const s = Math.floor(seconds);
  const parts = [
    t("dashboard.units.day", { n: Math.floor(s / 86400) }),
    t("dashboard.units.hour", { n: Math.floor((s % 86400) / 3600) }),
    t("dashboard.units.minute", { n: Math.floor((s % 3600) / 60) }),
    t("dashboard.units.second", { n: s % 60 }),
  ];
  const values = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
  const first = values.findIndex((v) => v > 0);
  return parts.slice(first, first + 2).join(" ");
}

function HealthGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 85 ? "var(--chart-2)" : clamped >= 60 ? "var(--chart-3)" : "var(--chart-4)";
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg className="h-14 w-14 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="45" stroke="var(--color-border)" strokeWidth="9" fill="none" />
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke={color}
          strokeWidth="9"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-sm font-semibold ${METRIC}`}
        style={{ color }}
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const message = error instanceof Error ? error.message : "";
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <span className="font-medium text-foreground">{t("common.loadFailed")}</span>
      {message && <span className="min-w-0 truncate text-muted-foreground">{message}</span>}
      <Button variant="outline" size="sm" onClick={onRetry} className="h-6 px-2 text-xs">
        {t("common.retry")}
      </Button>
    </div>
  );
}

function Tile({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      {children}
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

function MiniStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1 text-[11px]">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className={`${METRIC} font-semibold ${className ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

function Panel({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {icon}
        <h2 className="text-xs font-semibold text-foreground">{title}</h2>
        {subtitle && <span className="ml-auto text-[11px] text-muted-foreground">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const refMs = autoRefresh ? pollInterval : false;

  const healthQ = useQuery({
    queryKey: qk.health(),
    queryFn: () => endpoints.getHealth(),
    refetchInterval: refMs,
  });
  const diagQ = useQuery({
    queryKey: qk.diagnostics.diagnose(),
    queryFn: () => endpoints.getDiagnose(),
    refetchInterval: refMs,
  });
  const connQ = useQuery({
    queryKey: qk.diagnostics.connections(50),
    queryFn: () => endpoints.getConnections(50),
    refetchInterval: refMs,
  });
  const locksQ = useQuery({
    queryKey: qk.diagnostics.locks(50),
    queryFn: () => endpoints.getLocks(50),
    refetchInterval: refMs,
  });
  const replQ = useQuery({
    queryKey: qk.replication.status(),
    queryFn: () => endpoints.getReplication(),
    refetchInterval: refMs,
  });
  const storageQ = useQuery({
    queryKey: qk.diagnostics.storage("tables", 10),
    queryFn: () => endpoints.getStorage("tables", 10),
    refetchInterval: refMs,
  });

  const health = healthQ.data;
  const findings = diagQ.data ?? [];
  const conn = connQ.data?.summary;
  const lockSummary = locksQ.data?.summary;
  const replicas = replQ.data?.replicas ?? [];
  const slots = replQ.data?.slots ?? [];

  const top5Tables = useMemo(
    () =>
      [...(storageQ.data?.tables ?? [])]
        .sort((a, b) => b.total_size_bytes - a.total_size_bytes)
        .slice(0, 5)
        .map((table) => ({
          name: `${table.schema_name ?? "public"}.${table.table_name}`,
          size: table.total_size_bytes,
          sizeLabel: formatBytes(table.total_size_bytes),
        })),
    [storageQ.data]
  );

  const totalLag = useMemo(
    () => (replQ.data?.replicas ?? []).reduce((acc, r) => acc + (r.replay_lag_bytes ?? 0), 0),
    [replQ.data]
  );

  const usage = conn?.usage_percent ?? 0;
  const hasBlocking = (lockSummary?.blocking_pairs ?? 0) > 0;
  const hasWaiting = (lockSummary?.waiting_locks ?? 0) > 0;
  const activeSlots = slots.filter((s) => s.active).length;

  const handleRefetchAll = async () => {
    const results = await Promise.all([
      healthQ.refetch(),
      diagQ.refetch(),
      connQ.refetch(),
      locksQ.refetch(),
      replQ.refetch(),
      storageQ.refetch(),
    ]);
    // Failures already surface inline and through the API client's toast.
    if (results.every((r) => !r.isError)) toast.success(t("dashboard.refreshed"));
  };

  const anyFetching =
    healthQ.isFetching ||
    diagQ.isFetching ||
    connQ.isFetching ||
    locksQ.isFetching ||
    replQ.isFetching ||
    storageQ.isFetching;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Activity className="h-4 w-4 text-success" />
            {t("dashboard.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefetchAll}
          disabled={anyFetching}
          className="h-7 px-2 text-xs"
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${anyFetching ? "animate-spin" : ""}`} />
          {t("dashboard.refreshAll")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<CheckCircle2 className="h-3 w-3 text-success" />}
          label={t("dashboard.health.title")}
        >
          {healthQ.isLoading ? (
            <TileSkeleton />
          ) : healthQ.isError ? (
            <ErrorState error={healthQ.error} onRetry={() => healthQ.refetch()} />
          ) : (
            <div className="flex items-center gap-3">
              <HealthGauge score={health?.score ?? 0} />
              <div className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground">
                <p className="font-semibold text-foreground">{health?.status ?? "-"}</p>
                <p className="truncate font-mono">{health?.server_version ?? "-"}</p>
                {health?.uptime_seconds != null && (
                  <p className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {t("dashboard.health.uptime", {
                      value: formatSeconds(health.uptime_seconds, t),
                    })}
                  </p>
                )}
              </div>
            </div>
          )}
        </Tile>

        <Tile icon={<Users className="h-3 w-3 text-info" />} label={t("dashboard.connections.title")}>
          {connQ.isLoading ? (
            <TileSkeleton />
          ) : connQ.isError ? (
            <ErrorState error={connQ.error} onRetry={() => connQ.refetch()} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className={`${METRIC} text-lg font-semibold leading-6 text-foreground`}>
                  {conn?.current_connections ?? 0}
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}
                    / {conn?.max_connections ?? 0}
                  </span>
                </p>
                <RiskBadge
                  riskLevel={usage >= 85 ? "DANGEROUS" : usage >= 60 ? "WARNING" : "OK"}
                  size="sm"
                >
                  <span className={METRIC}>
                    {t("dashboard.percent", {
                      value: formatNumber(usage, { maximumFractionDigits: 1 }),
                    })}
                  </span>
                </RiskBadge>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-muted">
                <div className="h-full bg-info" style={{ width: `${Math.min(100, usage)}%` }} />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                <MiniStat
                  label={t("dashboard.connections.active")}
                  value={conn?.active ?? 0}
                  className="text-success"
                />
                <MiniStat label={t("dashboard.connections.idle")} value={conn?.idle ?? 0} />
                <MiniStat
                  label={t("dashboard.connections.waiting")}
                  value={conn?.waiting ?? 0}
                  className="text-warning"
                />
              </div>
            </>
          )}
        </Tile>

        <Tile icon={<Lock className="h-3 w-3 text-warning" />} label={t("dashboard.locks.title")}>
          {locksQ.isLoading ? (
            <TileSkeleton />
          ) : locksQ.isError ? (
            <ErrorState error={locksQ.error} onRetry={() => locksQ.refetch()} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className={`${METRIC} text-lg font-semibold leading-6 text-foreground`}>
                  {lockSummary?.blocking_pairs ?? 0}
                  <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
                    {t("dashboard.locks.blockingPairs")}
                  </span>
                </p>
                <RiskBadge
                  riskLevel={hasBlocking ? "DANGEROUS" : hasWaiting ? "WARNING" : "OK"}
                  size="sm"
                >
                  {hasBlocking
                    ? t("dashboard.locks.blocked")
                    : hasWaiting
                      ? t("dashboard.locks.waitingBadge")
                      : t("dashboard.locks.clear")}
                </RiskBadge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MiniStat label={t("dashboard.locks.total")} value={lockSummary?.total_locks ?? 0} />
                <MiniStat
                  label={t("dashboard.locks.waiting")}
                  value={lockSummary?.waiting_locks ?? 0}
                  className="text-warning"
                />
              </div>
            </>
          )}
        </Tile>

        <Tile icon={<Copy className="h-3 w-3 text-info" />} label={t("dashboard.replication.title")}>
          {replQ.isLoading ? (
            <TileSkeleton />
          ) : replQ.isError ? (
            <ErrorState error={replQ.error} onRetry={() => replQ.refetch()} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className={`${METRIC} text-lg font-semibold leading-6 text-foreground`}>
                  {formatBytes(totalLag)}
                </p>
                <RiskBadge
                  riskLevel={
                    totalLag > LAG_DANGEROUS_BYTES
                      ? "DANGEROUS"
                      : totalLag > LAG_WARNING_BYTES
                        ? "WARNING"
                        : "OK"
                  }
                  size="sm"
                >
                  {t("dashboard.replication.replicaCount", { count: replicas.length })}
                </RiskBadge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("dashboard.replication.totalLag")}
              </p>
              {slots.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("dashboard.replication.slotsActive", {
                    active: activeSlots,
                    total: slots.length,
                  })}
                </p>
              )}
            </>
          )}
        </Tile>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <Panel
          icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />}
          title={t("dashboard.findings.title")}
          subtitle={diagQ.data ? t("dashboard.findings.count", { count: findings.length }) : undefined}
        >
          {diagQ.isLoading ? (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : diagQ.isError ? (
            <div className="p-3">
              <ErrorState error={diagQ.error} onRetry={() => diagQ.refetch()} />
            </div>
          ) : findings.length === 0 ? (
            <div className="flex items-center gap-2 p-3 text-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <span className="font-medium text-foreground">{t("dashboard.findings.emptyTitle")}</span>
              <span className="text-muted-foreground">{t("dashboard.findings.emptyDesc")}</span>
            </div>
          ) : (
            <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
              {findings.map((f, idx) => (
                <div key={`${f.code}-${idx}`} className="px-3 py-1.5 hover:bg-muted/50">
                  <div className="flex items-start gap-2">
                    <RiskBadge
                      riskLevel={
                        f.severity === "CRITICAL"
                          ? "DANGEROUS"
                          : f.severity === "WARNING"
                            ? "WARNING"
                            : f.severity === "OK"
                              ? "OK"
                              : "INFO"
                      }
                      size="sm"
                      showIcon={false}
                      className="mt-0.5 shrink-0"
                    >
                      {f.severity}
                    </RiskBadge>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-xs font-medium text-foreground">{f.title}</p>
                        <code className="font-mono text-[10px] text-muted-foreground">{f.code}</code>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {f.description}
                      </p>
                      {f.recommendation && (
                        <p className="mt-0.5 flex items-start gap-1 text-[11px] leading-snug text-success">
                          <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" />
                          {f.recommendation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          icon={<HardDrive className="h-3.5 w-3.5 text-info" />}
          title={t("dashboard.tables.title")}
          subtitle={t("dashboard.tables.subtitle")}
        >
          {storageQ.isLoading ? (
            <div className="p-3">
              <Skeleton className="h-36 w-full" />
            </div>
          ) : storageQ.isError ? (
            <div className="p-3">
              <ErrorState error={storageQ.error} onRetry={() => storageQ.refetch()} />
            </div>
          ) : top5Tables.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t("common.noData")}</p>
          ) : (
            <>
              <div className="h-36 px-2 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top5Tables}
                    layout="vertical"
                    margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      tickFormatter={(v) => formatBytes(v, 0)}
                    />
                    <YAxis type="category" dataKey="name" hide />
                    <Tooltip
                      cursor={{ fill: "var(--color-muted)" }}
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        color: "var(--color-foreground)",
                        fontSize: 12,
                      }}
                      itemStyle={{ color: "var(--color-foreground)" }}
                      labelStyle={{ color: "var(--color-muted-foreground)" }}
                      formatter={(value: unknown) =>
                        formatBytes(typeof value === "number" ? value : 0, 2)
                      }
                    />
                    <Bar dataKey="size" name={t("dashboard.tables.size")} radius={[0, 3, 3, 0]} barSize={14}>
                      {top5Tables.map((_, index) => (
                        <Cell key={index} fill={BAR_FILLS[index % BAR_FILLS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="divide-y divide-border border-t border-border">
                {top5Tables.map((table, i) => (
                  <div key={table.name} className="flex items-center gap-2 px-3 py-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: BAR_FILLS[i % BAR_FILLS.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {table.name}
                    </span>
                    <span className={`${METRIC} text-xs font-semibold text-foreground`}>
                      {table.sizeLabel}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel
          icon={<Copy className="h-3.5 w-3.5 text-info" />}
          title={t("dashboard.slots.title")}
          subtitle={
            replQ.data
              ? t("dashboard.slots.summary", { slots: slots.length, replicas: replicas.length })
              : undefined
          }
        >
          {replQ.isLoading ? (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : replQ.isError ? (
            <div className="p-3">
              <ErrorState error={replQ.error} onRetry={() => replQ.refetch()} />
            </div>
          ) : slots.length === 0 && replicas.length === 0 ? (
            <div className="flex items-start gap-2 p-3 text-xs">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">{t("dashboard.slots.emptyTitle")}</p>
                <p className="text-muted-foreground">{t("dashboard.slots.emptyDesc")}</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {slots.map((slot) => (
                <div key={`slot-${slot.slot_name}`} className="flex items-center gap-2 px-3 py-1.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${slot.active ? "bg-success" : "bg-warning"}`}
                  />
                  <span className="min-w-0 truncate font-mono text-xs text-foreground">
                    {slot.slot_name}
                  </span>
                  {slot.slot_type && (
                    <code className="font-mono text-[10px] text-muted-foreground">{slot.slot_type}</code>
                  )}
                  <RiskBadge
                    riskLevel={slot.active ? "OK" : "WARNING"}
                    size="sm"
                    showIcon={false}
                    className="ml-auto"
                  >
                    {slot.active ? t("dashboard.slots.active") : t("dashboard.slots.inactive")}
                  </RiskBadge>
                </div>
              ))}
              {replicas.map((repl, idx) => (
                <div key={`repl-${idx}`} className="flex items-center gap-2 px-3 py-1.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      repl.state === "streaming" ? "bg-success" : "bg-warning"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {repl.application_name ??
                        t("dashboard.slots.replicaFallback", { n: idx + 1 })}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {repl.client_address ?? "-"} · {repl.username ?? "-"} · {repl.state ?? "-"}
                    </p>
                  </div>
                  <span className={`${METRIC} text-xs font-semibold text-info`}>
                    {formatBytes(repl.replay_lag_bytes ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
