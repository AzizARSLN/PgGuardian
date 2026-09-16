"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Camera,
  Play,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Users,
  HardDrive,
  Activity,
  Lock,
  AlertTriangle,
  TrendingUp,
  Skull,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Input } from "@/components/ui/input";

import { endpoints, Snapshot } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import useConfirm from "@/lib/hooks/useConfirm";
import { formatBytes, formatDate, formatDateAgo, formatNumber, formatPercent } from "@/lib/utils";

function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 85 ? "#10b981" : clamped >= 60 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 26;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 100 100">
        <defs>
          <linearGradient id={`snap-gauge-${score}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="26" stroke="rgba(255,255,255,0.08)" strokeWidth="6" fill="none" />
        <circle
          cx="50"
          cy="50"
          r="26"
          stroke={`url(#snap-gauge-${score})`}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-sm font-bold bg-clip-text text-transparent bg-gradient-to-br"
          style={{ backgroundImage: `linear-gradient(135deg, ${color}, ${color}88)` }}
        >
          {Math.round(clamped)}
        </span>
      </div>
    </div>
  );
}

export default function SnapshotsPage() {
  const qc = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const refMs = autoRefresh ? pollInterval : false;

  const [notesFilter, setNotesFilter] = useState("");

  const { data: snapshots, isLoading, refetch } = useQuery({
    queryKey: qk.snapshots.all(),
    queryFn: () => endpoints.listSnapshots(undefined, undefined, undefined, 100),
    refetchInterval: refMs,
  });

  const captureMutation = useMutation({
    mutationFn: () => endpoints.captureSnapshot(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.snapshots.all() });
      toast.success("Snapshot başarıyla alındı");
    },
    onError: () => toast.error("Snapshot alınamadı"),
  });

  const pruneMutation = useMutation({
    mutationFn: () => endpoints.pruneSnapshots(90),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.snapshots.all() });
      toast.success(`Prune tamamlandı: ${r.removed} adet silindi, ${r.keep_days} gün saklandı`);
    },
    onError: () => toast.error("Prune işlemi başarısız"),
  });

  const sortedSnapshots = useMemo(() => {
    return [...(snapshots ?? [])].sort((a, b) => {
      const ta = a.taken_at ? new Date(a.taken_at).getTime() : 0;
      const tb = b.taken_at ? new Date(b.taken_at).getTime() : 0;
      return tb - ta;
    });
  }, [snapshots]);

  const filteredSnapshots = useMemo(() => {
    if (!notesFilter.trim()) return sortedSnapshots;
    const f = notesFilter.toLowerCase();
    return sortedSnapshots.filter((s) => {
      const hay = [
        s.database,
        s.host,
        s.profile,
        s.server,
        s.status,
        s.server_version,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(f);
    });
  }, [sortedSnapshots, notesFilter]);

  const stats = useMemo(() => {
    const list = sortedSnapshots;
    const now = Date.now();
    const old90 = list.filter((s) => {
      if (!s.taken_at) return false;
      const diff = now - new Date(s.taken_at).getTime();
      return diff > 90 * 24 * 3600 * 1000;
    });
    const avgScore =
      list.length > 0
        ? Math.round(list.reduce((acc, s) => acc + (s.score ?? 0), 0) / list.length)
        : 0;
    return {
      total: list.length,
      latest: list[0] ?? null,
      pruneCount: old90.length,
      avgScore,
    };
  }, [sortedSnapshots]);

  const handleCapture = async () => {
    const ok = await confirm({
      title: "Snapshot Al",
      description: "Tüm pg_stat_* tabloları, sağlık kontrolleri ve bağlantı anlık görüntüsü alınacak. İşlem MAINTENANCE seviyesindedir ve kısa bir okuma I/O'su oluşturur.",
      risk_level: "MAINTENANCE",
      confirm_label: "Snapshot Al",
    });
    if (!ok) return;
    captureMutation.mutate();
  };

  const handlePrune = async () => {
    if (stats.pruneCount === 0) {
      toast.info("90 günden eski snapshot bulunmuyor");
      return;
    }
    const ok = await confirm({
      title: "Snapshot Prune — DANGEROUS",
      description: `90 günden eski ${stats.pruneCount} adet snapshot kalıcı olarak SİLİNECEK. Bu işlem geri alınamaz ve DANGEROUS onayı gerektirir.`,
      risk_level: "DANGEROUS",
      confirm_name_required: true,
      confirm_name_value: "prune",
      confirm_name_placeholder: "Onaylamak için prune yazın",
      confirm_label: "SİL",
    });
    if (!ok) return;
    pruneMutation.mutate();
  };

  return (
    <div className="space-y-8">
      <ConfirmDialog />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Camera className="h-8 w-8 text-purple-400" />
            Snapshots
          </h1>
          <p className="text-muted-foreground mt-1">
            Sağlık · bağlantı · kilit · sorgu · disk anlık görüntüleri, 10sn poll
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="h-12" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> Yenile
          </Button>
          <Button
            variant="destructive"
            className="h-12 px-6 bg-red-500 hover:bg-red-600 text-white"
            onClick={handlePrune}
            disabled={pruneMutation.isPending}
          >
            {pruneMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Prune (90g+) {stats.pruneCount > 0 && <span className="bg-black/20 px-2 py-0.5 rounded-full text-xs">{stats.pruneCount}</span>}
          </Button>
          <Button
            className="h-12 px-6 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600"
            onClick={handleCapture}
            disabled={captureMutation.isPending}
          >
            {captureMutation.isPending ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <Play className="h-5 w-5 mr-2" />
            )}
            Snapshot Al
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="relative overflow-hidden border-purple-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Camera className="h-3.5 w-3.5 text-purple-400" />
                Toplam Snapshot
              </span>
            </div>
            <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-purple-400 to-indigo-400">
              {stats.total}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.pruneCount > 0 ? (
                <>
                  <span className="text-red-400 font-semibold">{stats.pruneCount}</span> adet 90g+ eski
                </>
              ) : (
                "90g+ eski snapshot yok"
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-emerald-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                Ortalama Skor
              </span>
            </div>
            <div className="flex items-end gap-3">
              <ScoreGauge score={stats.avgScore} />
              <div>
                <div className="text-xs text-muted-foreground mt-3">
                  {stats.latest ? (
                    <>Son snapshot: {formatDateAgo(stats.latest.taken_at)}</>
                  ) : (
                    "Henüz snapshot yok"
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-sky-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-blue-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-sky-400" />
                Son — Bağlantı
              </span>
            </div>
            <div className="flex items-end gap-3">
              <div>
                <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-sky-400 to-blue-400">
                  {stats.latest?.connections ?? 0}
                </div>
                <div className="text-xs text-muted-foreground -mt-1">
                  / {stats.latest?.max_connections ?? 0} max
                </div>
              </div>
              <div className="ml-auto">
                <RiskBadge
                  riskLevel={
                    stats.latest &&
                    formatPercent(stats.latest.connections, stats.latest.max_connections) !== "0%"
                      ? Number(((stats.latest.connections / Math.max(1, stats.latest.max_connections)) * 100).toFixed(0)) >= 85
                        ? "DANGEROUS"
                        : Number(((stats.latest.connections / Math.max(1, stats.latest.max_connections)) * 100).toFixed(0)) >= 60
                        ? "WARNING"
                        : "OK"
                      : "OK"
                  }
                  size="sm"
                >
                  {stats.latest
                    ? formatPercent(stats.latest.connections, stats.latest.max_connections, 0)
                    : "0%"}
                </RiskBadge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-amber-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5 text-amber-400" />
                Son — DB Boyutu
              </span>
            </div>
            <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-amber-400 to-orange-400">
              {formatBytes(stats.latest?.db_size_bytes ?? 0, 1)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.latest ? `${stats.latest.host}:${stats.latest.port}/${stats.latest.database}` : "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <Camera className="h-5 w-5 text-purple-400" />
                Snapshot Listesi
              </CardTitle>
              <CardDescription>
                Poll: {refMs ? `${refMs / 1000} sn` : "manuel"} · {filteredSnapshots.length} / {sortedSnapshots.length} gösteriliyor
              </CardDescription>
            </div>
            <div className="w-full sm:max-w-sm">
              <Input
                value={notesFilter}
                onChange={(e) => setNotesFilter(e.target.value)}
                placeholder="Ara: host, db, status, server version..."
                className="pl-5"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="!p-0">
          {isLoading && !snapshots ? (
            <div className="p-12 text-center text-muted-foreground">Yükleniyor...</div>
          ) : filteredSnapshots.length === 0 ? (
            <div className="p-16 text-center">
              <Camera className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
              <p className="font-semibold">
                {sortedSnapshots.length === 0 ? "Henüz snapshot yok" : "Eşleşen snapshot bulunamadı"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {sortedSnapshots.length === 0
                  ? '"Snapshot Al" butonuyla ilk kaydı oluşturun.'
                  : "Filtreyi temizlemeyi deneyin."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredSnapshots.map((s, idx) => (
                <SnapshotRow key={`${s.id}-${idx}`} snap={s} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SnapshotRow({ snap }: { snap: Snapshot }) {
  const blocking = snap.blocking_pairs ?? 0;
  const deadlocks = snap.deadlocks ?? 0;
  const longQ = snap.long_queries ?? 0;
  const deadTupleRatio =
    snap.live_tuples && snap.live_tuples > 0
      ? (snap.dead_tuples ?? 0) / (snap.live_tuples + (snap.dead_tuples ?? 0))
      : 0;

  return (
    <div className="p-6 hover:bg-white/5 transition-colors">
      <div className="flex items-start gap-5 flex-wrap">
        <div className="flex items-center gap-4">
          <ScoreGauge score={snap.score ?? 0} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-sm font-mono font-semibold text-white">#{snap.id}</code>
              <Badge variant="outline" className="text-[10px] font-mono">
                {snap.status || "-"}
              </Badge>
              {snap.profile && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  profile={snap.profile}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              <span className="font-mono">
                {snap.host}:{snap.port}/{snap.database}
              </span>{" "}
              · {snap.server_version}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" /> {formatDate(snap.taken_at)}
              </span>
              <span className="opacity-60">·</span>
              <span>{formatDateAgo(snap.taken_at)}</span>
            </div>
          </div>
        </div>

        <div className="ml-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 flex-1 max-w-4xl">
          <MiniStat
            icon={<Users className="h-3.5 w-3.5 text-sky-400" />}
            label="Conn"
            value={`${snap.connections ?? 0}/${snap.max_connections ?? 0}`}
          />
          <MiniStat
            icon={<HardDrive className="h-3.5 w-3.5 text-amber-400" />}
            label="Boyut"
            value={formatBytes(snap.db_size_bytes ?? 0, 0)}
          />
          <MiniStat
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
            label="Dead"
            value={formatNumber(snap.dead_tuples ?? 0)}
            risk={deadTupleRatio > 0.2 ? "WARNING" : deadTupleRatio > 0.4 ? "DANGEROUS" : "OK"}
          />
          <MiniStat
            icon={<Lock className="h-3.5 w-3.5 text-red-400" />}
            label="Bloke"
            value={String(blocking)}
            risk={blocking > 0 ? "DANGEROUS" : blocking > 0 ? "WARNING" : "OK"}
          />
          <MiniStat
            icon={<Skull className="h-3.5 w-3.5 text-red-400" />}
            label="Deadlock"
            value={String(deadlocks)}
            risk={deadlocks > 0 ? "DANGEROUS" : "OK"}
          />
          <MiniStat
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-indigo-400" />}
            label="Uzun Sorgu"
            value={String(longQ)}
            risk={longQ > 5 ? "WARNING" : longQ > 20 ? "DANGEROUS" : "OK"}
          />
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  risk = "INFO",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  risk?: "OK" | "INFO" | "WARNING" | "MAINTENANCE" | "DANGEROUS";
}) {
  return (
    <div className="rounded-2xl bg-white/5 px-3 py-2.5 min-w-[90px]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="text-sm font-bold">{value}</div>
        {risk !== "INFO" && risk !== "OK" && <RiskBadge riskLevel={risk} size="sm" showIcon={false} />}
      </div>
    </div>
  );
}
