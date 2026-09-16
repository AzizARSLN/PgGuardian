"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileBarChart2,
  FileJson,
  FileCode,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Skull,
  Info,
  Activity,
  HardDrive,
  Users,
  Database,
  Shield,
  Copy,
  ExternalLink,
  Server,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Skeleton } from "@/components/ui/skeleton";

import { endpoints, ReportDict } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { formatBytes, formatDate, formatNumber } from "@/lib/utils";

type ReportSectionId =
  | "summary"
  | "health"
  | "diagnostics"
  | "storage"
  | "replication"
  | "connections"
  | "roles";

interface SectionDef {
  id: ReportSectionId;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const SECTIONS: SectionDef[] = [
  { id: "summary", title: "Özet", description: "Raporun genel özeti ve ana metrikler", icon: Activity, color: "from-indigo-500 to-emerald-500" },
  { id: "health", title: "Sağlık Kontrolleri", description: "Her bir sağlık kontrolünün detayı ve durumu", icon: Shield, color: "from-emerald-500 to-teal-500" },
  { id: "diagnostics", title: "Tanı Bulguları", description: "CRITICAL / WARNING / INFO seviyesinde bulgular", icon: AlertTriangle, color: "from-amber-500 to-orange-500" },
  { id: "storage", title: "Depolama: Top 10", description: "En büyük 10 tablo, indeks ve veritabanı", icon: HardDrive, color: "from-purple-500 to-pink-500" },
  { id: "replication", title: "Replikasyon", description: "Replica lag, slotlar ve streaming durumu", icon: Copy, color: "from-sky-500 to-blue-500" },
  { id: "connections", title: "Bağlantılar", description: "Aktif / boşta / bekleyen bağlantılar özeti", icon: Users, color: "from-rose-500 to-red-500" },
  { id: "roles", title: "Roller", description: "Süper kullanıcı, login, yetki özeti", icon: Server, color: "from-violet-500 to-indigo-500" },
];

function extractArray(report: ReportDict | undefined, key: string): unknown[] {
  if (!report) return [];
  const v = report[key];
  if (Array.isArray(v)) return v as unknown[];
  if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>)[key])) return (v as Record<string, unknown>)[key] as unknown[];
  if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).items)) return (v as Record<string, unknown>).items as unknown[];
  if (v && typeof v === "object") {
    const arr = Object.values(v as Record<string, unknown>).filter((x) => x && typeof x === "object");
    if (arr.length > 0) return arr;
  }
  return [];
}

function getReportVal<T>(report: ReportDict | undefined, path: string, fallback: T): T {
  if (!report) return fallback;
  const parts = path.split(".");
  let cur: unknown = report;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return fallback;
    }
  }
  return (cur ?? fallback) as T;
}



function buildHtmlReport(report: ReportDict, generatedAt: string): string {
  const json = JSON.stringify(report, null, 2);
  const score = getReportVal<number>(report, "health.score", 0) || getReportVal<number>(report, "summary.score", 0) || 0;
  const db = getReportVal<string>(report, "health.database", "") || getReportVal<string>(report, "summary.database", "-") || "-";
  const version = getReportVal<string>(report, "health.server_version", "") || getReportVal<string>(report, "summary.server_version", "-") || "-";
  const connections = getReportVal<number>(report, "connections.summary.current_connections", 0);
  const maxConn = getReportVal<number>(report, "connections.summary.max_connections", 0);
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>PgGuardian Report — ${db} — ${generatedAt}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:32px;line-height:1.6}
  .wrap{max-width:1100px;margin:0 auto}
  h1{font-size:28px;margin:0 0 8px;background:linear-gradient(135deg,#6366f1,#10b981);-webkit-background-clip:text;background-clip:text;color:transparent}
  .meta{color:#94a3b8;font-size:13px;margin-bottom:28px}
  .card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:24px;margin-bottom:20px}
  .score{font-size:56px;font-weight:900;background:linear-gradient(135deg,#6366f1,#10b981);-webkit-background-clip:text;background-clip:text;color:transparent}
  .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .kpi{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px}
  .kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;font-weight:600}
  .kpi-val{font-size:22px;font-weight:800;margin-top:4px;color:#f1f5f9}
  h2{font-size:18px;margin:0 0 12px;color:#f1f5f9}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06)}
  th{color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
  .pill-ok{background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3)}
  .pill-warn{background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.3)}
  .pill-crit{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)}
  pre{background:#020617;border:1px solid rgba(255,255,255,0.08);padding:16px;border-radius:14px;overflow:auto;max-height:400px;font-size:12px;color:#86efac}
</style>
</head>
<body>
<div class="wrap">
  <h1>PgGuardian — Tam Rapor</h1>
  <div class="meta">
    Veritabanı: <b>${db}</b> · PostgreSQL ${version} · Üretilme: ${generatedAt}
  </div>
  <div class="card">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Sağlık Skoru</div><div class="score" style="font-size:40px">${score}</div></div>
      <div class="kpi"><div class="kpi-label">Bağlantı</div><div class="kpi-val">${connections} / ${maxConn}</div></div>
    </div>
  </div>
  <div class="card">
    <h2>Tam JSON</h2>
    <pre>${json.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  </div>
</div>
</body>
</html>`;
}

export default function ReportPage() {
  const [open, setOpen] = useState<Record<ReportSectionId, boolean>>({
    summary: true,
    health: true,
    diagnostics: true,
    storage: true,
    replication: true,
    connections: true,
    roles: true,
  });

  const { data: report, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: qk.diagnostics.report(50),
    queryFn: () => endpoints.getReport(50),
    staleTime: 30000,
  });

  const toggle = (id: ReportSectionId) =>
    setOpen((o) => ({ ...o, [id]: !o[id] }));

  const generatedAt = useMemo(
    () => (dataUpdatedAt ? formatDate(new Date(dataUpdatedAt)) : formatDate(new Date())),
    [dataUpdatedAt]
  );

  const summaryKPIs = useMemo(() => {
    const score = getReportVal<number>(report, "health.score", 0) || getReportVal<number>(report, "summary.score", 0) || 0;
    const db = getReportVal<string>(report, "health.database", "") || getReportVal<string>(report, "summary.database", "-") || "-";
    const version = getReportVal<string>(report, "health.server_version", "") || getReportVal<string>(report, "summary.server_version", "-") || "-";
    const current = getReportVal<number>(report, "connections.summary.current_connections", 0);
    const max = getReportVal<number>(report, "connections.summary.max_connections", 0);
    const totalLocks = getReportVal<number>(report, "locks.summary.total_locks", 0);
    const blocking = getReportVal<number>(report, "locks.summary.blocking_pairs", 0);
    const replicasArr = extractArray(report, "replicas");
    const repCount = replicasArr.length > 0 ? replicasArr.length : Number(getReportVal<unknown>(report, "replication.replicas", 0) ?? 0) || 0;
    const replicas = repCount;
    const storageArr = extractArray(report, "tables");
    const topSize = storageArr.length > 0 ? (storageArr[0] as Record<string, unknown>).total_size_bytes ?? 0 : 0;
    return { score, db, version, current, max, totalLocks, blocking, replicas, topSize: Number(topSize) };
  }, [report]);

  const handleDownloadJson = () => {
    try {
      const blob = new Blob([JSON.stringify(report ?? {}, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pgguardian-report-${summaryKPIs.db || "all"}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("JSON indirildi");
    } catch {
      toast.error("JSON indirilemedi");
    }
  };

  const handleDownloadHtml = () => {
    try {
      const html = buildHtmlReport(report ?? {}, generatedAt);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pgguardian-report-${summaryKPIs.db || "all"}-${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("HTML indirildi");
    } catch {
      toast.error("HTML indirilemedi");
    }
  };

  const handleOpenScalar = () => {
    try {
      window.open("/api/v1/reference", "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Scalar UI açılamadı");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <FileBarChart2 className="h-8 w-8 text-emerald-400" />
            Report
          </h1>
          <p className="text-muted-foreground mt-1">
            Tam sağlık · tanı · depolama · replikasyon · bağlantı · roller özeti · Üretilme: {generatedAt}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="h-12" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> Yenile
          </Button>
          <Button variant="outline" className="h-12" onClick={handleOpenScalar}>
            <ExternalLink className="h-4 w-4 mr-2" /> Scalar UI
          </Button>
          <Button variant="outline" className="h-12" onClick={handleDownloadJson}>
            <FileJson className="h-4 w-4 mr-2" /> JSON İndir
          </Button>
          <Button
            className="h-12 px-6 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
            onClick={handleDownloadHtml}
          >
            <FileCode className="h-5 w-5 mr-2" /> HTML İndir
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <SummaryCard
          label="Sağlık Skoru"
          value={isLoading ? undefined : String(summaryKPIs.score)}
          icon={<Shield className="h-4 w-4" />}
          badge={
            <RiskBadge
              riskLevel={summaryKPIs.score >= 85 ? "OK" : summaryKPIs.score >= 60 ? "WARNING" : "DANGEROUS"}
              size="sm"
            >
              / 100
            </RiskBadge>
          }
          gradient="from-emerald-500/10 to-teal-500/10"
        />
        <SummaryCard
          label="Veritabanı"
          value={isLoading ? undefined : summaryKPIs.db}
          sub={isLoading ? undefined : summaryKPIs.version}
          icon={<Database className="h-4 w-4" />}
          gradient="from-indigo-500/10 to-violet-500/10"
        />
        <SummaryCard
          label="Bağlantılar"
          value={isLoading ? undefined : `${summaryKPIs.current} / ${summaryKPIs.max}`}
          icon={<Users className="h-4 w-4" />}
          badge={
            <RiskBadge
              riskLevel={
                summaryKPIs.max > 0 && summaryKPIs.current / summaryKPIs.max >= 0.85
                  ? "DANGEROUS"
                  : summaryKPIs.max > 0 && summaryKPIs.current / summaryKPIs.max >= 0.6
                  ? "WARNING"
                  : "OK"
              }
              size="sm"
            >
              {summaryKPIs.max > 0 ? `${Math.round((summaryKPIs.current / summaryKPIs.max) * 100)}%` : "0%"}
            </RiskBadge>
          }
          gradient="from-sky-500/10 to-blue-500/10"
        />
        <SummaryCard
          label="Kilitler"
          value={isLoading ? undefined : `${summaryKPIs.totalLocks} toplam`}
          sub={isLoading ? undefined : `${summaryKPIs.blocking} bloke · ${summaryKPIs.replicas} replica`}
          icon={<Copy className="h-4 w-4" />}
          badge={
            summaryKPIs.blocking > 0 ? (
              <RiskBadge riskLevel="DANGEROUS" size="sm">BLOKE</RiskBadge>
            ) : summaryKPIs.totalLocks > 0 ? (
              <RiskBadge riskLevel="WARNING" size="sm">BEKLEYEN</RiskBadge>
            ) : (
              <RiskBadge riskLevel="OK" size="sm">Temiz</RiskBadge>
            )
          }
          gradient="from-amber-500/10 to-orange-500/10"
        />
      </div>

      <div className="space-y-5">
        {SECTIONS.map((sec) => (
          <CollapsibleSection
            key={sec.id}
            sec={sec}
            open={open[sec.id]}
            onToggle={() => toggle(sec.id)}
          >
            <SectionContent id={sec.id} report={report} isLoading={isLoading} />
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  badge,
  gradient,
}: {
  label: string;
  value?: string;
  sub?: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  gradient: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} pointer-events-none`} />
      <CardContent className="p-6 relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            {icon} {label}
          </span>
          {badge}
        </div>
        {value === undefined ? (
          <Skeleton className="h-10 w-32 mb-1.5" />
        ) : (
          <div className="text-3xl font-bold text-white break-words">{value}</div>
        )}
        {sub !== undefined && <div className="text-xs text-muted-foreground mt-1.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function CollapsibleSection({
  sec,
  open,
  onToggle,
  children,
}: {
  sec: SectionDef;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-white/10">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left"
      >
        <CardHeader className="pb-5 cursor-pointer hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-3">
            <div
              className={`h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br ${sec.color} flex items-center justify-center shadow-lg`}
            >
              <sec.icon className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-xl flex items-center gap-2">
                {sec.title}
                <Badge variant="outline" className="text-[10px] font-mono opacity-70">
                  SECTION · {sec.id.toUpperCase()}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">{sec.description}</CardDescription>
            </div>
            <div className="shrink-0 opacity-70">
              {open ? (
                <ChevronUp className="h-6 w-6" />
              ) : (
                <ChevronDown className="h-6 w-6" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
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
  if (isLoading && !report) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  switch (id) {
    case "summary":
      return <SummarySection report={report} />;
    case "health":
      return <HealthSection report={report} />;
    case "diagnostics":
      return <DiagnosticsSection report={report} />;
    case "storage":
      return <StorageSection report={report} />;
    case "replication":
      return <ReplicationSection report={report} />;
    case "connections":
      return <ConnectionsSection report={report} />;
    case "roles":
      return <RolesSection report={report} />;
  }
}

function ObjectJsonView({ data, maxLen = 20 }: { data: unknown; maxLen?: number }) {
  const text = JSON.stringify(data, null, 2);
  if (text.length <= maxLen) return <code className="text-xs font-mono text-muted-foreground break-words">{text}</code>;
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-mono text-muted-foreground hover:text-white">
        {text.slice(0, maxLen)}... (genişlet)
      </summary>
      <pre className="mt-2 p-4 rounded-2xl bg-black/30 text-xs text-emerald-300 overflow-auto max-h-96 font-mono whitespace-pre-wrap break-all">
        {text}
      </pre>
    </details>
  );
}

function SummarySection({ report }: { report: ReportDict | undefined }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "Tam Rapor Anahtarları", val: Object.keys(report ?? {}).length + " adet" },
          { label: "Sağlık Skoru", val: String(getReportVal<number>(report, "health.score", 0) || getReportVal<number>(report, "summary.score", 0) || 0) },
          { label: "Durum", val: getReportVal<string>(report, "health.status", "-") || getReportVal<string>(report, "summary.status", "-") },
          { label: "Üretim Zamanı", val: getReportVal<string>(report, "health.generated_at", "-") || getReportVal<string>(report, "summary.generated_at", formatDate(new Date())) },
        ].map((r) => (
          <div key={r.label} className="rounded-2xl bg-white/5 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{r.label}</div>
            <div className="text-sm font-semibold mt-1">{r.val}</div>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
          <Info className="h-3.5 w-3.5" /> ReportDict Raw (üst seviye)
        </p>
        <ObjectJsonView data={Object.fromEntries(Object.entries(report ?? {}).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} items` : typeof v === "object" && v ? "{...}" : v]))} maxLen={200} />
      </div>
    </div>
  );
}

function HealthSection({ report }: { report: ReportDict | undefined }) {
  const checks = extractArray(report, "checks") as unknown as Record<string, unknown>[];
  if (checks.length === 0) {
    return <EmptyState text="Sağlık kontrolü verisi bulunamadı" />;
  }
  return (
    <div className="divide-y divide-white/5 rounded-3xl border border-white/10 overflow-hidden">
      {checks.slice(0, 100).map((c, i) => {
        const sev = String(c.severity ?? c.status ?? "UNKNOWN").toUpperCase();
        const risk = sev === "OK" ? "OK" : sev === "WARNING" || sev === "INFO" ? "WARNING" : "DANGEROUS";
        return (
          <div key={i} className="p-5 hover:bg-white/5 transition-colors flex items-start gap-4 flex-wrap">
            <RiskBadge riskLevel={risk as "OK" | "WARNING" | "INFO" | "DANGEROUS"} size="md" className="shrink-0 mt-0.5">
              {sev}
            </RiskBadge>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold">{String(c.name ?? c.title ?? c.description ?? `check-${i}`)}</div>
                {c.value !== undefined && c.value !== null && (
                  <code className="text-[10px] font-mono bg-white/5 px-2 py-0.5 rounded-full text-emerald-300">{String(c.value)}</code>
                )}
                {c.threshold !== undefined && c.threshold !== null && (
                  <Badge variant="outline" className="text-[10px] font-mono">threshold={String(c.threshold)}</Badge>
                )}
              </div>
              {Boolean(c.description) && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{String(c.description)}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiagnosticsSection({ report }: { report: ReportDict | undefined }) {
  const findings = extractArray(report, "findings") as unknown as Record<string, unknown>[];
  const diags = findings.length > 0 ? findings : (extractArray(report, "diagnostics") as unknown as Record<string, unknown>[]);
  if (diags.length === 0) return <EmptyState text="Tanı bulgusu bulunamadı" />;
  return (
    <div className="divide-y divide-white/5 rounded-3xl border border-white/10 overflow-hidden">
      {diags.slice(0, 100).map((f, i) => {
        const sev = String(f.severity ?? "INFO").toUpperCase();
        const risk = sev === "CRITICAL" ? "DANGEROUS" : sev === "WARNING" ? "WARNING" : sev === "OK" ? "OK" : "INFO";
        return (
          <div key={i} className="p-5 hover:bg-white/5 transition-colors flex items-start gap-4 flex-wrap">
            <RiskBadge riskLevel={risk as "OK" | "WARNING" | "INFO" | "DANGEROUS"} size="md" className="shrink-0 mt-0.5">
              {sev}
            </RiskBadge>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold">{String(f.title ?? f.code ?? `finding-${i}`)}</div>
                {Boolean(f.code) && <code className="text-[10px] font-mono bg-white/5 px-2 py-0.5 rounded-full">{String(f.code)}</code>}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{String(f.description ?? "")}</p>
              {Boolean(f.recommendation) && (
                <p className="text-xs text-emerald-400 mt-2 flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
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
  const tables = extractArray(report, "tables") as unknown as Record<string, unknown>[];
  const dbs = extractArray(report, "databases") as unknown as Record<string, unknown>[];
  const idxs = extractArray(report, "indexes") as unknown as Record<string, unknown>[];
  const top = [...tables, ...dbs, ...idxs]
    .map((o) => ({
      obj: o,
      bytes: Number(
        (o as Record<string, unknown>).total_size_bytes ??
          (o as Record<string, unknown>).size_bytes ??
          (o as Record<string, unknown>).index_size_bytes ??
          0
      ),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  if (top.length === 0) return <EmptyState text="Depolama verisi bulunamadı" />;
  return (
    <div className="space-y-2 rounded-3xl border border-white/10 overflow-hidden">
      {top.map((t, i) => {
        const o = t.obj as Record<string, unknown>;
        const name =
          [o.schema_name, o.table_name, o.index_name, o.database, o.name].filter(Boolean).join(".") ||
          `storage-${i}`;
        const kind =
          o.database && !o.table_name
            ? "DB"
            : o.index_name
            ? "IDX"
            : o.table_name
            ? "TABLE"
            : "OBJ";
        const maxB = Math.max(1, top[0]?.bytes ?? 1);
        const pct = (t.bytes / maxB) * 100;
        return (
          <div key={i} className="p-5 hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="font-mono text-sm font-semibold min-w-[3ch] text-muted-foreground">#{i + 1}</span>
              <Badge variant="outline" className="text-[10px] font-mono">{kind}</Badge>
              <code className="text-sm font-mono">{name}</code>
              <span className="ml-auto font-mono text-sm font-semibold text-amber-300">{formatBytes(t.bytes, 1)}</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReplicationSection({ report }: { report: ReportDict | undefined }) {
  const replicas = extractArray(report, "replicas") as unknown as Record<string, unknown>[];
  const slots = extractArray(report, "slots") as unknown as Record<string, unknown>[];
  if (replicas.length === 0 && slots.length === 0) return <EmptyState text="Replikasyon verisi bulunamadı (replica/slot yok)" />;
  return (
    <div className="space-y-5">
      {replicas.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-2">
            <Copy className="h-3.5 w-3.5" /> Replicalar ({replicas.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {replicas.map((r, i) => {
              const lag = Number(r.replay_lag_bytes ?? r.pending_bytes ?? 0);
              const state = String(r.state ?? "-");
              const active = state.toLowerCase() === "streaming";
              return (
                <div key={i} className="rounded-2xl bg-white/5 p-4 border border-white/10">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "bg-emerald-400 shadow-lg shadow-emerald-400/30" : "bg-amber-400"}`} />
                      <code className="font-mono text-sm font-semibold truncate">
                        {String(r.application_name ?? r.client_address ?? r.username ?? `replica-${i + 1}`)}
                      </code>
                    </div>
                    <RiskBadge riskLevel={active ? "OK" : "WARNING"} size="sm">{state}</RiskBadge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Lag</div>
                      <div className="font-mono font-semibold text-purple-300">{formatBytes(lag, 1)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Adres / Kullanıcı</div>
                      <div className="font-mono truncate">{String(r.client_address ?? "-")} {Boolean(r.username) ? `(${String(r.username)})` : ""}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {slots.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Replikasyon Slotları ({slots.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {slots.map((s, i) => {
              const active = Boolean(s.active);
              return (
                <div key={i} className="rounded-2xl bg-white/5 p-4 border border-white/10 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "bg-emerald-400 shadow-lg shadow-emerald-400/30" : "bg-amber-400"}`} />
                    <div className="min-w-0">
                      <code className="font-mono text-sm font-semibold truncate block">{String(s.slot_name ?? `slot-${i}`)}</code>
                      {Boolean(s.slot_type) && (
                        <div className="text-[10px] text-muted-foreground font-mono">{String(s.slot_type)}</div>
                      )}
                    </div>
                  </div>
                  <RiskBadge riskLevel={active ? "OK" : "WARNING"} size="sm">
                    {active ? "Aktif" : "Pasif"}
                  </RiskBadge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionsSection({ report }: { report: ReportDict | undefined }) {
  const summary =
    (getReportVal<Record<string, unknown> | undefined>(report, "connections.summary", undefined) ||
      getReportVal<Record<string, unknown> | undefined>(report, "connections", undefined) ||
      {}) as Record<string, unknown>;
  const conns = extractArray(report, "connections") as unknown as Record<string, unknown>[];
  const show = conns.slice(0, 20);

  const current = Number(summary.current_connections ?? 0);
  const max = Number(summary.max_connections ?? 0);
  const usage = max > 0 ? (current / max) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Aktif", val: Number(summary.active ?? 0), color: "text-emerald-400" },
          { label: "Boşta", val: Number(summary.idle ?? 0), color: "text-muted-foreground" },
          { label: "İşlemde Bekleyen", val: Number(summary.idle_in_transaction ?? 0), color: "text-amber-400" },
          { label: "Bekleyen", val: Number(summary.waiting ?? 0), color: "text-red-400" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl bg-white/5 p-4 border border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{k.label}</div>
            <div className={`text-2xl font-bold mt-1 ${k.color}`}>{formatNumber(k.val)}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-muted-foreground font-semibold uppercase tracking-wider">Kullanım</span>
          <span className="font-mono font-semibold">
            {formatNumber(current)} / {formatNumber(max)} · %{usage.toFixed(1)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${usage >= 85 ? "from-red-500 to-rose-500" : usage >= 60 ? "from-amber-500 to-orange-500" : "from-emerald-500 to-teal-500"}`}
            style={{ width: `${Math.min(100, usage)}%` }}
          />
        </div>
      </div>
      {show.length > 0 && (
        <div className="rounded-3xl border border-white/10 divide-y divide-white/5 overflow-hidden">
          {show.map((c, i) => (
            <div key={i} className="p-4 hover:bg-white/5 transition-colors flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="font-mono text-[10px] shrink-0">pid={String(c.pid ?? "-")}</Badge>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-semibold">{String(c.user ?? c.username ?? "-")}</span>
                  <span className="text-muted-foreground">@</span>
                  <code className="font-mono text-muted-foreground">{String(c.database ?? c.db ?? "-")}</code>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-muted-foreground">{String(c.client_address ?? c.host ?? "-")}</span>
                  {Boolean(c.application_name) && (
                    <Badge variant="outline" className="text-[10px] font-mono">{String(c.application_name)}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <RiskBadge
                    riskLevel={
                      String(c.state ?? "").toLowerCase().includes("active")
                        ? "OK"
                        : String(c.state ?? "").toLowerCase().includes("idle")
                        ? "INFO"
                        : "WARNING"
                    }
                    size="sm"
                  >
                    {String(c.state ?? "-")}
                  </RiskBadge>
                  {c.query_duration_seconds !== undefined && (
                    <span className="text-muted-foreground font-mono">
                      Sorgu: {formatNumber(Number(c.query_duration_seconds), 1)}sn
                    </span>
                  )}
                  {Boolean(c.backend_type) && (
                    <span className="text-muted-foreground font-mono">· {String(c.backend_type)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RolesSection({ report }: { report: ReportDict | undefined }) {
  const roles = extractArray(report, "roles") as unknown as Record<string, unknown>[];
  if (roles.length === 0) {
    // Summary count approach
    const counts = {
      total: 0,
      superuser: 0,
      login: 0,
      createdb: 0,
      createrole: 0,
    };
    Object.entries(report ?? {}).forEach(([, v]) => {
      if (Array.isArray(v)) {
        v.forEach((r: unknown) => {
          if (r && typeof r === "object") {
            const o = r as Record<string, unknown>;
            if ("name" in o) {
              counts.total++;
              if (o.superuser) counts.superuser++;
              if (o.can_login || o.login) counts.login++;
              if (o.createdb) counts.createdb++;
              if (o.createrole) counts.createrole++;
            }
          }
        });
      }
    });
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Toplam Rol", val: counts.total, icon: <Info className="h-3.5 w-3.5" /> },
          { label: "Süper Kullanıcı", val: counts.superuser, icon: <Skull className="h-3.5 w-3.5" /> },
          { label: "Giriş Yetkisi", val: counts.login, icon: <Users className="h-3.5 w-3.5" /> },
          { label: "DB Oluşturma", val: counts.createdb, icon: <Database className="h-3.5 w-3.5" /> },
          { label: "Rol Oluşturma", val: counts.createrole, icon: <Shield className="h-3.5 w-3.5" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl bg-white/5 p-4 border border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              {k.icon} {k.label}
            </div>
            <div className="text-2xl font-bold mt-1">{formatNumber(k.val)}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-3xl border border-white/10 divide-y divide-white/5 overflow-hidden">
      {roles.slice(0, 50).map((r, i) => {
        const name = String(r.name ?? `role-${i}`);
        const su = Boolean(r.superuser);
        const login = Boolean(r.can_login ?? r.login);
        const cdb = Boolean(r.createdb);
        const crole = Boolean(r.createrole);
        const limit = Number(r.connection_limit ?? -1);
        return (
          <div key={i} className="p-4 hover:bg-white/5 transition-colors flex items-center gap-3 flex-wrap">
            <code className="font-mono text-sm font-semibold min-w-[160px]">{name}</code>
            <div className="flex flex-wrap gap-2">
              <RiskBadge riskLevel={su ? "DANGEROUS" : "INFO"} size="sm">
                {su ? "SUPERUSER" : "Standart"}
              </RiskBadge>
              {login && <Badge variant="outline" className="text-[10px] font-mono">LOGIN</Badge>}
              {cdb && <Badge variant="outline" className="text-[10px] font-mono">CREATEDB</Badge>}
              {crole && <Badge variant="outline" className="text-[10px] font-mono">CREATEROLE</Badge>}
              {limit > 0 && (
                <Badge variant="outline" className="text-[10px] font-mono">conn_limit={limit}</Badge>
              )}
              {Boolean(r.valid_until) && (
                <Badge variant="outline" className="text-[10px] font-mono">valid_until={String(r.valid_until).slice(0, 10)}</Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-12 text-center rounded-3xl border border-dashed border-white/10 bg-white/5">
      <Info className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
      <p className="font-semibold">{text}</p>
      <p className="text-xs text-muted-foreground mt-1">Backend endpointinden bu bölüm için veri dönmedi.</p>
    </div>
  );
}
