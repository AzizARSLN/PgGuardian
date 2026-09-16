"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import {
  DatabaseBackup,
  Download,
  Play,
  RefreshCw,
  HardDriveUpload,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/components/ui/risk-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { endpoints, BackupJob, BackupRequest, RestoreRequest } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import useConfirm from "@/lib/hooks/useConfirm";
import { formatBytes, formatDate } from "@/lib/utils";

type BackupStatus = "queued" | "running" | "done" | "failed";

function getStatusMeta(status: string): { level: BackupStatus; label: string; icon: React.ComponentType<{ className?: string }> } {
  const s = (status || "").toLowerCase();
  if (s.includes("queue")) return { level: "queued", label: "Kuyrukta", icon: Clock };
  if (s.includes("run") || s.includes("progress")) return { level: "running", label: "Çalışıyor", icon: Loader2 };
  if (s.includes("done") || s.includes("success") || s.includes("complete")) return { level: "done", label: "Tamamlandı", icon: CheckCircle2 };
  if (s.includes("fail") || s.includes("error")) return { level: "failed", label: "Hatalı", icon: XCircle };
  return { level: "queued", label: status || "-", icon: AlertCircle };
}

function StatusProgressBar({ status }: { status: string }) {
  const { level, label, icon: Icon } = getStatusMeta(status);
  const progressMap: Record<BackupStatus, number> = {
    queued: 10,
    running: 55,
    done: 100,
    failed: 100,
  };
  const colorMap: Record<BackupStatus, string> = {
    queued: "from-slate-400 to-slate-500",
    running: "from-amber-400 to-orange-500",
    done: "from-emerald-400 to-teal-500",
    failed: "from-red-400 to-rose-500",
  };
  const pct = progressMap[level];
  return (
    <div className="space-y-1.5 min-w-[180px]">
      <div className="flex items-center gap-2">
        <RiskBadge
          riskLevel={
            level === "done"
              ? "OK"
              : level === "failed"
              ? "DANGEROUS"
              : level === "running"
              ? "WARNING"
              : "INFO"
          }
          size="sm"
        >
          <span className="flex items-center gap-1.5">
            {level === "running" ? <Icon className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
            {label}
          </span>
        </RiskBadge>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${colorMap[level]} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BackupsPage() {
  const qc = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const refMs = autoRefresh ? pollInterval : false;

  const [createOpen, setCreateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState<BackupJob | null>(null);

  const [form, setForm] = useState({
    format: "custom",
    compression: "6",
    schema: "",
    table: "",
    filename: "",
    database: "",
  });

  const [restoreDb, setRestoreDb] = useState("");
  const [restoreClean, setRestoreClean] = useState(false);

  const { data: backups, isLoading, refetch } = useQuery({
    queryKey: qk.backups.all(),
    queryFn: () => endpoints.listBackups(),
    refetchInterval: refMs,
  });

  const sortedBackups = useMemo(() => {
    return [...(backups ?? [])].sort((a, b) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
      return tb - ta;
    });
  }, [backups]);

  const stats = useMemo(() => {
    const list = backups ?? [];
    const done = list.filter((b) => getStatusMeta(b.status).level === "done");
    const totalBytes = done.reduce((acc, b) => acc + (b.size_bytes ?? 0), 0);
    const last = list[0];
    return {
      total: list.length,
      size: totalBytes,
      lastAt: last?.started_at ?? null,
      success: done.length,
      failed: list.filter((b) => getStatusMeta(b.status).level === "failed").length,
    };
  }, [backups]);

  const createBackupMutation = useMutation({
    mutationFn: (body: BackupRequest) => endpoints.startBackup(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.backups.all() });
      toast.success("Yedekleme görevi kuyruğa alındı");
      setCreateOpen(false);
      setForm({ format: "custom", compression: "6", schema: "", table: "", filename: "", database: "" });
    },
    onError: () => toast.error("Yedekleme başlatılamadı"),
  });

  const restoreMutation = useMutation({
    mutationFn: (body: RestoreRequest) => endpoints.startRestore(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.backups.all() });
      toast.success("Geri yükleme görevi kuyruğa alındı");
      setRestoreOpen(null);
      setRestoreDb("");
      setRestoreClean(false);
    },
    onError: () => toast.error("Geri yükleme başlatılamadı"),
  });

  const handleCreate = async () => {
    const ok = await confirm({
      title: "Yedek Oluştur",
      description: `Format: ${form.format.toUpperCase()}, sıkıştırma: ${form.compression}. Bu işlem MAINTENANCE risk seviyesinde ve sunucu I/O kullanımını artırabilir.`,
      risk_level: "MAINTENANCE",
      confirm_label: "Yedeği Başlat",
    });
    if (!ok) return;

    const body: BackupRequest = {
      confirm: true,
      format: form.format,
      database: form.database || undefined,
    };
    createBackupMutation.mutate(body);
  };

  const handleRestore = async (job: BackupJob) => {
    if (!restoreDb.trim()) {
      toast.error("Hedef veritabanı adı zorunlu");
      return;
    }
    const dbName = restoreDb.trim();
    const ok = await confirm({
      title: "Geri Yükle — DANGEROUS",
      description: `Backup #${job.id} dosyası "${dbName}" veritabanına geri yüklenecek. ${restoreClean ? "Önce mevcut objeler temizlenecek (CLEAN)." : "Mevcut objelerin üzerine yazılabilir."} Bu işlem DANGEROUS seviyesinde!`,
      risk_level: "DANGEROUS",
      confirm_name_required: true,
      confirm_name_value: dbName,
      confirm_label: "Geri Yükle",
    });
    if (!ok) return;

    restoreMutation.mutate({
      confirm: true,
      confirm_name: dbName,
      backup_id: job.id,
      database: dbName,
      clean: restoreClean,
    });
  };

  const handleDownload = async (job: BackupJob) => {
    try {
      toast.loading("Dosya hazırlanıyor...", { id: "dl" });
      const blob = await endpoints.downloadBackup(job.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.file || `backup-${job.id}.dump`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("İndirme başarıyla başladı", { id: "dl" });
    } catch {
      toast.error("İndirme başarısız", { id: "dl" });
    }
  };

  const columns: ColumnDef<BackupJob>[] = [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => (
        <div className="font-mono text-xs">{row.original.id}</div>
      ),
    },
    {
      accessorKey: "kind",
      header: "Format",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono">
          {row.original.kind?.toUpperCase() || row.original.database || "pg_dump"}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Durum",
      cell: ({ row }) => <StatusProgressBar status={row.original.status} />,
    },
    {
      accessorKey: "size_bytes",
      header: "Boyut",
      cell: ({ row }) => (
        <span className="font-mono text-sm">{formatBytes(row.original.size_bytes ?? 0)}</span>
      ),
    },
    {
      accessorKey: "started_at",
      header: "Başlama",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.original.started_at)}</span>
      ),
    },
    {
      accessorKey: "finished_at",
      header: "Bitiş",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.finished_at ? formatDate(row.original.finished_at) : "-"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Aksiyonlar",
      cell: ({ row }) => {
        const job = row.original;
        const meta = getStatusMeta(job.status);
        const isDone = meta.level === "done";
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              disabled={!isDone}
              onClick={() => handleDownload(job)}
            >
              <Download className="h-4 w-4 mr-1.5" /> İndir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRestoreOpen(job);
                setRestoreDb(job.database || "");
              }}
            >
              <HardDriveUpload className="h-4 w-4 mr-1.5" /> Geri Yükle
            </Button>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: sortedBackups,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-8">
      <ConfirmDialog />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <DatabaseBackup className="h-8 w-8 text-indigo-400" />
            Backup / Restore
          </h1>
          <p className="text-muted-foreground mt-1">
            pg_dump · yedekleme listesi · blob indirme · geri yükleme
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="h-12" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> Yenile
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="h-12 px-6 bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600">
                <Play className="h-5 w-5 mr-2" />
                Yedek Oluştur
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <DatabaseBackup className="h-6 w-6 text-indigo-400" />
                  Yeni Yedek Oluştur
                </DialogTitle>
                <DialogDescription>
                  Format, sıkıştırma ve isteğe bağlı şema/tablo seçin.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Format</Label>
                    <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pgdump">pg_dump (varsayılan)</SelectItem>
                        <SelectItem value="custom">Custom (sıkıştırılmış .dump)</SelectItem>
                        <SelectItem value="plain">Plain SQL (.sql)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Sıkıştırma Seviyesi (0-9)</Label>
                    <Select value={form.compression} onValueChange={(v) => setForm({ ...form, compression: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["0", "1", "3", "6", "9"].map((v) => (
                          <SelectItem key={v} value={v}>
                            Seviye {v} {v === "0" ? "(hızlı)" : v === "9" ? "(en sıkışık)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Hedef Veritabanı (opsiyonel)</Label>
                    <Input
                      value={form.database}
                      onChange={(e) => setForm({ ...form, database: e.target.value })}
                      placeholder="mevcut aktif DB"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Dosya Adı (opsiyonel)</Label>
                    <Input
                      value={form.filename}
                      onChange={(e) => setForm({ ...form, filename: e.target.value })}
                      placeholder="backup-2026-09-15.dump"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Şema (opsiyonel)</Label>
                    <Input
                      value={form.schema}
                      onChange={(e) => setForm({ ...form, schema: e.target.value })}
                      placeholder="public"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tablo (opsiyonel)</Label>
                    <Input
                      value={form.table}
                      onChange={(e) => setForm({ ...form, table: e.target.value })}
                      placeholder="orders"
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs text-amber-400 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    Bu işlem MAINTENANCE onayı gerektirir ve sunucu I/O&apos;sunu artırabilir.
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  İptal
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createBackupMutation.isPending}
                  className="bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600"
                >
                  {createBackupMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Play className="h-4 w-4 mr-2" />
                  Yedeği Başlat
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="relative overflow-hidden border-indigo-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-emerald-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Toplam İş</span>
            </div>
            <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-indigo-400 to-emerald-400">
              {stats.total}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Başarılı: <span className="text-emerald-400 font-semibold">{stats.success}</span> · Hata:{" "}
              <span className="text-red-400 font-semibold">{stats.failed}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-emerald-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Başarılı Yedek</span>
            </div>
            <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-emerald-400 to-teal-400">
              {stats.success}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.lastAt ? `Son: ${formatDate(stats.lastAt)}` : "Henüz yedek yok"}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-amber-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Toplam Boyut</span>
            </div>
            <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-amber-400 to-orange-400">
              {formatBytes(stats.size, 1)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Sadece başarılı yedekler</div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-red-500/20">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-transparent to-rose-500/10 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hatalı İş</span>
            </div>
            <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-red-400 to-rose-400">
              {stats.failed}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Retry veya log kontrolü gerekli</div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5 text-indigo-400" />
            Yedek İşleri Listesi
          </CardTitle>
          <CardDescription>Poll: {refMs ? `${refMs / 1000} sn` : "manuel"} · {sortedBackups.length} iş kaydı</CardDescription>
        </CardHeader>
        <CardContent className="!p-0">
          {isLoading && !backups ? (
            <div className="p-12 text-center text-muted-foreground">Yükleniyor...</div>
          ) : sortedBackups.length === 0 ? (
            <div className="p-16 text-center">
              <DatabaseBackup className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
              <p className="font-semibold">Henüz yedek işi yok</p>
              <p className="text-sm text-muted-foreground mt-1">
                Sağ üstteki &quot;Yedek Oluştur&quot; butonuyla ilk yedeği alın.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id}>
                      {hg.headers.map((h) => (
                        <TableHead key={h.id}>
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((c) => (
                        <TableCell key={c.id}>
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!restoreOpen} onOpenChange={(o) => !o && setRestoreOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDriveUpload className="h-6 w-6 text-red-400" />
              Geri Yükle — DANGEROUS
            </DialogTitle>
            <DialogDescription>
              {restoreOpen ? `Backup #${restoreOpen.id} · ${formatBytes(restoreOpen.size_bytes ?? 0)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="restore-db">
                Hedef Veritabanı Adı <span className="text-red-400">*</span>
              </Label>
              <Input
                id="restore-db"
                value={restoreDb}
                onChange={(e) => setRestoreDb(e.target.value)}
                placeholder="onayda aynı adı yazmanız gerekecek"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Bu adı onay ekranında aynen tekrar yazmanız istenecektir.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-5">
              <div>
                <Label className="cursor-pointer">CLEAN (mevcut objeleri temizle)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Önce DROP/CASCADE benzeri temizlik yapar. Daha da riskli.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-6 w-6 rounded border-white/20 bg-white/10 accent-red-500"
                checked={restoreClean}
                onChange={(e) => setRestoreClean(e.target.checked)}
              />
            </div>
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-xs text-red-400 flex items-start gap-2 leading-relaxed">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                Geri yükleme, veritabanı objelerinin üzerine yazabilir ve veri kaybına neden olabilir.
                İşlem DANGEROUS onayı gerektirir.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestoreOpen(null)}>
              İptal
            </Button>
            <Button
              variant="destructive"
              disabled={!restoreDb.trim() || restoreMutation.isPending}
              onClick={() => restoreOpen && handleRestore(restoreOpen)}
            >
              {restoreMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Onay Ekranına Geç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
