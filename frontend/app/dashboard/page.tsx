"use client";

import { useQuery } from "@tanstack/react-query";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import { endpoints } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Database,
  Lock,
  Copy,
  ArrowUpRight,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  Users,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatBytes, formatInterval, formatPercent } from "@/lib/utils";
import { useMemo } from "react";
import { toast } from "sonner";

const BAR_COLORS = [
  "from-indigo-500 to-purple-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-sky-500 to-blue-500",
  "from-pink-500 to-rose-500",
];

const BAR_FILLS = ["#6366f1", "#10b981", "#f59e0b", "#0ea5e9", "#ec4899"];

function HealthGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 85 ? "#10b981" : clamped >= 60 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke="url(#gaugeGradient)"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br"
          style={{
            backgroundImage: `linear-gradient(135deg, ${color}, ${color}88)`,
          }}
        >
          {Math.round(clamped)}
        </span>
        <span className="text-xs text-muted-foreground mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <Skeleton className="h-4 w-24 mb-4" />
        <Skeleton className="h-10 w-32 mb-2" />
        <Skeleton className="h-3 w-40" />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const refMs = autoRefresh ? pollInterval : false;

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: qk.health(),
    queryFn: () => endpoints.getHealth(),
    refetchInterval: refMs,
  });

  const { data: diagnostics, isLoading: diagLoading, refetch: refetchDiag } = useQuery({
    queryKey: qk.diagnostics.diagnose(),
    queryFn: () => endpoints.getDiagnose(),
    refetchInterval: refMs,
  });

  const { data: connections, isLoading: connLoading, refetch: refetchConn } = useQuery({
    queryKey: qk.diagnostics.connections(50),
    queryFn: () => endpoints.getConnections(50),
    refetchInterval: refMs,
  });

  const { data: locks, isLoading: locksLoading, refetch: refetchLocks } = useQuery({
    queryKey: qk.diagnostics.locks(50),
    queryFn: () => endpoints.getLocks(50),
    refetchInterval: refMs,
  });

  const { data: replication, isLoading: replLoading, refetch: refetchRepl } = useQuery({
    queryKey: qk.replication.status(),
    queryFn: () => endpoints.getReplication(),
    refetchInterval: refMs,
  });

  const { data: storage, isLoading: storageLoading, refetch: refetchStorage } = useQuery({
    queryKey: qk.diagnostics.storage("tables", 10),
    queryFn: () => endpoints.getStorage("tables", 10),
    refetchInterval: refMs,
  });

  const top5Tables = useMemo(() => {
    return (storage?.tables ?? [])
      .sort((a, b) => b.total_size_bytes - a.total_size_bytes)
      .slice(0, 5)
      .map((t) => ({
        name: `${t.schema_name ?? "public"}.${t.table_name}`,
        size: t.total_size_bytes,
        sizeLabel: formatBytes(t.total_size_bytes),
      }));
  }, [storage]);

  const totalLag = useMemo(() => {
    return (replication?.replicas ?? []).reduce(
      (acc, r) => acc + (r.replay_lag_bytes ?? 0),
      0
    );
  }, [replication]);

  const hasBlocking = (locks?.summary.blocking_pairs ?? 0) > 0;
  const hasLocks = (locks?.summary.total_locks ?? 0) > 0;

  const handleRefetchAll = () => {
    try {
      refetchHealth();
      refetchDiag();
      refetchConn();
      refetchLocks();
      refetchRepl();
      refetchStorage();
      toast.success("Veriler yenilendi");
    } catch (e) {
      toast.error("Yenileme başarısız");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="h-8 w-8 text-emerald-400" />
            Kontrol Paneli
          </h1>
          <p className="text-muted-foreground mt-1">
            Sunucu sağlığı, bağlantılar, tanı bulguları ve depolama özeti
          </p>
        </div>
        <Button variant="outline" onClick={handleRefetchAll} className="h-12 px-6 rounded-full">
          <RefreshCw className="h-4 w-4 mr-2" />
          Tümünü Yenile
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        {healthLoading ? (
          <MetricCardSkeleton />
        ) : (
          <Card className="relative overflow-hidden border-emerald-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
            <CardContent className="p-6 relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  Sağlık Skoru
                </span>
              </div>
              <HealthGauge score={health?.score ?? 0} />
              <div className="mt-4 text-center">
                <p className="text-xs text-muted-foreground">
                  {health?.status ?? "-"} · {health?.server_version ?? "-"}
                </p>
                {health?.uptime_seconds !== undefined && health.uptime_seconds !== null && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
                    <Clock className="h-3 w-3" />
                    Çalışma: {formatInterval(health.uptime_seconds)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {connLoading ? (
          <MetricCardSkeleton />
        ) : (
          <Card className="relative overflow-hidden border-sky-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
            <CardContent className="p-6 relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-sky-400" />
                  Bağlantı Kullanımı
                </span>
              </div>
              <div className="flex items-end gap-3 mt-2">
                <div>
                  <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-sky-400 to-indigo-400">
                    {connections?.summary.current_connections ?? 0}
                  </div>
                  <div className="text-xs text-muted-foreground -mt-1">
                    / {connections?.summary.max_connections ?? 0} max
                  </div>
                </div>
                <div className="ml-auto">
                  <RiskBadge
                    riskLevel={
                      (connections?.summary.usage_percent ?? 0) >= 85
                        ? "DANGEROUS"
                        : (connections?.summary.usage_percent ?? 0) >= 60
                        ? "WARNING"
                        : "OK"
                    }
                    size="md"
                  >
                    {formatPercent(
                      connections?.summary.current_connections ?? 0,
                      connections?.summary.max_connections ?? 0
                    )}
                  </RiskBadge>
                </div>
              </div>
              <div className="mt-5 h-2.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-700"
                  style={{
                    width: `${Math.min(100, connections?.summary.usage_percent ?? 0)}%`,
                  }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-semibold text-emerald-400">
                    {connections?.summary.active ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Aktif</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-muted-foreground">
                    {connections?.summary.idle ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Boşta</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-amber-400">
                    {connections?.summary.waiting ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Bekleyen</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {locksLoading ? (
          <MetricCardSkeleton />
        ) : (
          <Card className="relative overflow-hidden border-red-500/20">
            <div className={`absolute inset-0 pointer-events-none bg-gradient-to-br ${hasBlocking ? "from-red-500/15 to-amber-500/10" : "from-emerald-500/10 to-transparent"}`} />
            <CardContent className="p-6 relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5" />
                  Kilitler / Deadlock
                </span>
              </div>
              <div className="flex items-end gap-3 mt-2">
                <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-red-400 to-amber-400">
                  {locks?.summary.blocking_pairs ?? 0}
                </div>
                <div className="ml-auto">
                  <RiskBadge
                    riskLevel={hasBlocking ? "DANGEROUS" : hasLocks ? "WARNING" : "OK"}
                    size="md"
                  >
                    {hasBlocking ? "BLOKE VAR" : hasLocks ? "BEKLEYEN" : "Temiz"}
                  </RiskBadge>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-white/5 p-3">
                  <div className="text-lg font-bold">
                    {locks?.summary.total_locks ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Toplam</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-3">
                  <div className="text-lg font-bold text-amber-400">
                    {locks?.summary.waiting_locks ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Bekleyen</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-3">
                  <div className="text-lg font-bold text-red-400">
                    {locks?.summary.blocking_pairs ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Bloke</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {replLoading ? (
          <MetricCardSkeleton />
        ) : (
          <Card className="relative overflow-hidden border-purple-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
            <CardContent className="p-6 relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Copy className="h-3.5 w-3.5 text-purple-400" />
                  Replikasyon Lag
                </span>
              </div>
              <div className="flex items-end gap-3 mt-2">
                <div>
                  <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-purple-400 to-indigo-400">
                    {formatBytes(totalLag)}
                  </div>
                  <div className="text-xs text-muted-foreground -mt-1">Toplam replay lag</div>
                </div>
                <div className="ml-auto">
                  <RiskBadge
                    riskLevel={
                      totalLag > 100 * 1024 * 1024
                        ? "DANGEROUS"
                        : totalLag > 10 * 1024 * 1024
                        ? "WARNING"
                        : "OK"
                    }
                    size="md"
                  >
                    {(replication?.replicas ?? []).length} Replica
                  </RiskBadge>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                {(replication?.replicas ?? []).slice(0, 2).map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${r.state === "streaming" ? "bg-emerald-400" : "bg-amber-400"}`} />
                      <span className="text-xs font-medium">
                        {r.application_name ?? r.client_address ?? `replica-${idx + 1}`}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatBytes(r.replay_lag_bytes ?? 0)}
                    </span>
                  </div>
                ))}
                {(replication?.slots ?? []).length > 0 && (
                  <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-2.5">
                    <span className="text-xs font-medium">Slotlar</span>
                    <span className="text-xs font-semibold text-emerald-400">
                      {(replication?.slots ?? []).filter((s) => s.active).length} /{" "}
                      {(replication?.slots ?? []).length} aktif
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Tanı Bulguları
            </CardTitle>
            <CardDescription>
              {diagnostics?.length ?? 0} adet bulgu
            </CardDescription>
          </CardHeader>
          <CardContent className="!p-0">
            {diagLoading ? (
              <div className="space-y-3 p-6 pt-0">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (diagnostics?.length ?? 0) === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-400 mb-3" />
                <p className="font-semibold">Her şey yolunda</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Tanı bulgusu bulunamadı.
                </p>
              </div>
            ) : (
              <div className="max-h-[520px] overflow-y-auto divide-y divide-white/5">
                {(diagnostics ?? []).map((f, idx) => (
                  <div key={`${f.code}-${idx}`} className="p-5 hover:bg-white/5 transition-colors">
                    <div className="flex items-start gap-3">
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
                        className="shrink-0 mt-0.5"
                      >
                        {f.severity}
                      </RiskBadge>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{f.title}</p>
                          <code className="text-[10px] font-mono text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">
                            {f.code}
                          </code>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {f.description}
                        </p>
                        {f.recommendation && (
                          <p className="text-xs text-emerald-400/90 mt-2 flex items-start gap-1.5">
                            <ArrowUpRight className="h-3 w-3 shrink-0 mt-0.5" />
                            {f.recommendation}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-indigo-400" />
              En Büyük 5 Tablo
            </CardTitle>
            <CardDescription>
              Toplam boyut (tablo + indeks)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {storageLoading ? (
              <div className="h-72">
                <Skeleton className="h-full w-full" />
              </div>
            ) : top5Tables.length === 0 ? (
              <div className="h-72 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Veri yok</p>
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top5Tables}
                    layout="vertical"
                    margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={true} vertical={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => formatBytes(v, 0)} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "#cbd5e1" }}
                      width={140}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "16px",
                        color: "#f8fafc",
                        fontSize: "12px",
                      }}
                      formatter={(value: unknown) => {
                        const n = typeof value === "number" ? value : 0;
                        return formatBytes(n, 2);
                      }}
                      labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
                    />
                    <Bar dataKey="size" radius={[0, 10, 10, 0]} barSize={22}>
                      {top5Tables.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_FILLS[index % BAR_FILLS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {top5Tables.length > 0 && (
              <div className="mt-4 space-y-2">
                {top5Tables.map((t, i) => (
                  <div key={t.name} className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-2.5">
                    <div
                      className={`h-3 w-3 rounded-full bg-gradient-to-br ${BAR_COLORS[i % BAR_COLORS.length]}`}
                    />
                    <span className="text-xs font-mono flex-1 truncate">{t.name}</span>
                    <span className="text-xs font-semibold">{t.sizeLabel}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <Copy className="h-5 w-5 text-purple-400" />
              Replikasyon Slotları
            </CardTitle>
            <CardDescription>
              {(replication?.slots ?? []).length} slot · {(replication?.replicas ?? []).length} replica
            </CardDescription>
          </CardHeader>
          <CardContent className="!p-0">
            {replLoading ? (
              <div className="space-y-3 p-6 pt-0">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (replication?.slots ?? []).length === 0 && (replication?.replicas ?? []).length === 0 ? (
              <div className="p-12 text-center">
                <Database className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="font-semibold">Replikasyon yok</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Bu sunucuda replica veya slot yapılandırılmamış.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {(replication?.slots ?? []).map((slot, idx) => (
                  <div key={`slot-${slot.slot_name}-${idx}`} className="p-5 hover:bg-white/5 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            slot.active ? "bg-emerald-400 shadow-lg shadow-emerald-400/30" : "bg-amber-400"
                          }`}
                        />
                        <div>
                          <p className="font-semibold text-sm flex items-center gap-2">
                            {slot.slot_name}
                            {slot.slot_type && (
                              <code className="text-[10px] font-mono text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">
                                {slot.slot_type}
                              </code>
                            )}
                          </p>
                        </div>
                      </div>
                      <RiskBadge
                        riskLevel={slot.active ? "OK" : "WARNING"}
                        size="sm"
                      >
                        {slot.active ? "Aktif" : "Pasif"}
                      </RiskBadge>
                    </div>
                  </div>
                ))}
                {(replication?.replicas ?? []).map((repl, idx) => (
                  <div key={`repl-${idx}`} className="p-5 hover:bg-white/5 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={`h-2.5 w-2.5 rounded-full mt-1.5 ${
                            repl.state === "streaming"
                              ? "bg-emerald-400 shadow-lg shadow-emerald-400/30"
                              : "bg-amber-400"
                          }`}
                        />
                        <div>
                          <p className="font-semibold text-sm">
                            {repl.application_name ?? `Replica ${idx + 1}`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {repl.client_address ?? "-"} ·{" "}
                            <span className="font-mono">{repl.username ?? "-"}</span>
                          </p>
                          {repl.state && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              State: <span className="text-emerald-400">{repl.state}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">Lag</p>
                        <p className="text-sm font-semibold font-mono text-purple-400">
                          {formatBytes(repl.replay_lag_bytes ?? 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
