"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  endpoints,
  type VacuumRequest,
  type AnalyzeRequest,
  type ReindexRequest,
  type DryRunResult,
  type MaintenanceActionResult,
  type TableMaintenance,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wrench,
  Trash2,
  RefreshCw,
  Database,
  Search,
  Sparkles,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatNumber, formatPercent, formatBytes } from "@/lib/utils";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useForm } from "react-hook-form";

interface VacuumForm {
  schema_name?: string;
  table_name?: string;
  full: boolean;
  analyze: boolean;
  freeze: boolean;
  verbose: boolean;
}

interface AnalyzeForm {
  schema_name?: string;
  table_name?: string;
}

interface ReindexForm {
  schema_name?: string;
  table_name?: string;
  index_name?: string;
  concurrently: boolean;
}

type MaintenancePreview = {
  sql: string[];
  risk: "MAINTENANCE" | "DANGEROUS";
  action: string;
} | null;

export default function MaintenancePage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState("vacuum");

  const [vacuumPreview, setVacuumPreview] = useState<MaintenancePreview>(null);
  const [analyzePreview, setAnalyzePreview] = useState<MaintenancePreview>(null);
  const [reindexPreview, setReindexPreview] = useState<MaintenancePreview>(null);

  const {
    register: vacRegister,
    handleSubmit: vacHandleSubmit,
    watch: vacWatch,
    setValue: vacSetValue,
    reset: vacReset,
    formState: { isSubmitting: vacSubmitting },
  } = useForm<VacuumForm>({
    defaultValues: {
      schema_name: "",
      table_name: "",
      full: false,
      analyze: false,
      freeze: false,
      verbose: false,
    },
  });

  const {
    register: anaRegister,
    handleSubmit: anaHandleSubmit,
    watch: anaWatch,
    reset: anaReset,
    formState: { isSubmitting: anaSubmitting },
  } = useForm<AnalyzeForm>({
    defaultValues: {
      schema_name: "",
      table_name: "",
    },
  });

  const {
    register: reiRegister,
    handleSubmit: reiHandleSubmit,
    watch: reiWatch,
    setValue: reiSetValue,
    reset: reiReset,
    formState: { isSubmitting: reiSubmitting },
  } = useForm<ReindexForm>({
    defaultValues: {
      schema_name: "",
      table_name: "",
      index_name: "",
      concurrently: true,
    },
  });

  const { data: maintenanceReport, isLoading: reportLoading } = useQuery({
    queryKey: qk.diagnostics.maintenance(100),
    queryFn: () => endpoints.getMaintenance(100),
  });

  const vacuumMutation = useMutation({
    mutationFn: (body: VacuumRequest) => endpoints.runVacuum(body),
    onSuccess: (res) => {
      const r = res as MaintenanceActionResult;
      if (r && "command_status" in r) {
        toast.success("VACUUM tamamlandı", {
          description: r.command_status,
        });
      } else {
        toast.success("VACUUM başarıyla çalıştırıldı");
      }
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance() });
      setVacuumPreview(null);
      vacReset();
    },
    onError: () => {
      toast.error("VACUUM başarısız oldu");
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: (body: AnalyzeRequest) => endpoints.runAnalyze(body),
    onSuccess: (res) => {
      const r = res as MaintenanceActionResult;
      if (r && "command_status" in r) {
        toast.success("ANALYZE tamamlandı", {
          description: r.command_status,
        });
      } else {
        toast.success("ANALYZE başarıyla çalıştırıldı");
      }
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance() });
      setAnalyzePreview(null);
      anaReset();
    },
    onError: () => {
      toast.error("ANALYZE başarısız oldu");
    },
  });

  const reindexMutation = useMutation({
    mutationFn: (body: ReindexRequest) => endpoints.runReindex(body),
    onSuccess: (res) => {
      const r = res as MaintenanceActionResult;
      if (r && "command_status" in r) {
        toast.success("REINDEX tamamlandı", {
          description: r.command_status,
        });
      } else {
        toast.success("REINDEX başarıyla çalıştırıldı");
      }
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance() });
      setReindexPreview(null);
      reiReset();
    },
    onError: () => {
      toast.error("REINDEX başarısız oldu");
    },
  });

  const handleVacuumDryRun = vacHandleSubmit(async (data) => {
    try {
      const payload: VacuumRequest = {
        schema_name: data.schema_name?.trim() || null,
        table_name: data.table_name?.trim() || null,
        full: data.full,
        analyze: data.analyze,
        freeze: data.freeze,
        dry_run: true,
      };
      const res = (await endpoints.runVacuum(payload)) as DryRunResult;
      if (res && res.sql) {
        setVacuumPreview({
          sql: res.sql,
          risk: (res.risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS",
          action: res.action,
        });
      } else {
        toast.info("Dry Run sonucu dönmedi");
      }
    } catch (e) {}
  });

  const handleVacuumApply = async () => {
    if (!vacuumPreview) return;
    const data = {
      schema_name: vacWatch("schema_name"),
      table_name: vacWatch("table_name"),
      full: vacWatch("full"),
      analyze: vacWatch("analyze"),
      freeze: vacWatch("freeze"),
    };
    const ok = await confirm({
      title: "VACUUM işlemini çalıştır?",
      description: vacuumPreview.risk === "DANGEROUS"
        ? "VACUUM FULL çalıştırılacak. Bu işlem tabloyu kilitleyebilir (ACCESS EXCLUSIVE LOCK) ve yoğun I/O üretebilir. Düşük trafik saatlerinde çalıştırmanız önerilir."
        : "Standart VACUUM çalıştırılacak. Bu işlem tabloyu kilitlemez ancak I/O yoğunluğu yaratabilir.",
      risk_level: vacuumPreview.risk,
      sql_preview: vacuumPreview.sql,
      confirm_label: "VACUUM Çalıştır",
      cancel_label: "İptal",
    });
    if (!ok) return;

    await vacuumMutation.mutateAsync({
      schema_name: data.schema_name?.trim() || null,
      table_name: data.table_name?.trim() || null,
      full: data.full,
      analyze: data.analyze,
      freeze: data.freeze,
      confirm: true,
    });
  };

  const handleAnalyzeDryRun = anaHandleSubmit(async (data) => {
    try {
      const payload: AnalyzeRequest = {
        schema_name: data.schema_name?.trim() || null,
        table_name: data.table_name?.trim() || null,
        dry_run: true,
      };
      const res = (await endpoints.runAnalyze(payload)) as DryRunResult;
      if (res && res.sql) {
        setAnalyzePreview({
          sql: res.sql,
          risk: (res.risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS",
          action: res.action,
        });
      }
    } catch (e) {}
  });

  const handleAnalyzeApply = async () => {
    if (!analyzePreview) return;
    const data = {
      schema_name: anaWatch("schema_name"),
      table_name: anaWatch("table_name"),
    };
    const ok = await confirm({
      title: "ANALYZE işlemini çalıştır?",
      description:
        "Tablo istatistikleri güncellenecek. Sorgu planlayıcısının daha iyi kararlar almasını sağlar. Okunmuş bir kilitle çalışır.",
      risk_level: analyzePreview.risk,
      sql_preview: analyzePreview.sql,
      confirm_label: "ANALYZE Çalıştır",
      cancel_label: "İptal",
    });
    if (!ok) return;

    await analyzeMutation.mutateAsync({
      schema_name: data.schema_name?.trim() || null,
      table_name: data.table_name?.trim() || null,
      confirm: true,
    });
  };

  const handleReindexDryRun = reiHandleSubmit(async (data) => {
    try {
      const payload: ReindexRequest = {
        schema_name: data.schema_name?.trim() || null,
        table_name: data.table_name?.trim() || null,
        index_name: data.index_name?.trim() || null,
        concurrently: data.concurrently,
        dry_run: true,
      };
      const res = (await endpoints.runReindex(payload)) as DryRunResult;
      if (res && res.sql) {
        setReindexPreview({
          sql: res.sql,
          risk: (res.risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS",
          action: res.action,
        });
      }
    } catch (e) {}
  });

  const handleReindexApply = async () => {
    if (!reindexPreview) return;
    const data = {
      schema_name: reiWatch("schema_name"),
      table_name: reiWatch("table_name"),
      index_name: reiWatch("index_name"),
      concurrently: reiWatch("concurrently"),
    };
    const ok = await confirm({
      title: "REINDEX işlemini çalıştır?",
      description: data.concurrently
        ? "CONCURRENTLY modunda REINDEX çalıştırılacak. Bu işlem tabloyu kilitlemez ancak daha uzun sürebilir ve CPU/I/O yoğunluğu yaratır."
        : "Standart REINDEX çalıştırılacak. Bu işlem ilgili indeks için SHARE LOCK alabilir. INDEX yazımını geçici olarak engelleyebilir.",
      risk_level: reindexPreview.risk,
      sql_preview: reindexPreview.sql,
      confirm_label: "REINDEX Çalıştır",
      cancel_label: "İptal",
    });
    if (!ok) return;

    await reindexMutation.mutateAsync({
      schema_name: data.schema_name?.trim() || null,
      table_name: data.table_name?.trim() || null,
      index_name: data.index_name?.trim() || null,
      concurrently: data.concurrently,
      confirm: true,
    });
  };

  const summary = maintenanceReport?.summary;
  const tables = maintenanceReport?.tables ?? [];
  const totalTables = summary?.tables_total ?? 0;
  const neverVacuumed = summary?.tables_never_vacuumed ?? 0;
  const neverAnalyzed = summary?.tables_never_analyzed ?? 0;
  const deadPercent = summary?.dead_tuple_percent ?? 0;

  const tablesByStatus = {
    ok: tables.filter((t) => t.status === "OK").length,
    warning: tables.filter((t) => t.status === "WARNING").length,
    critical: tables.filter((t) => t.status === "CRITICAL").length,
  };

  return (
    <div className="space-y-8">
      <ConfirmDialog />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Wrench className="h-8 w-8 text-amber-400" />
            Veritabanı Bakımı
          </h1>
          <p className="text-muted-foreground mt-1">
            VACUUM · ANALYZE · REINDEX işlemlerini kurallı ve güvenli bir şekilde çalıştırın
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: qk.diagnostics.maintenance() });
            toast.success("Bakım durumu yenilendi");
          }}
          className="h-12 px-6 rounded-full"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Durumu Yenile
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
        {reportLoading ? (
          [0, 1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-9 w-20" />
              </CardContent>
            </Card>
          ))
        ) : (
          [
            {
              label: "Toplam Tablo",
              val: formatNumber(totalTables),
              icon: Database,
              from: "from-indigo-500",
              to: "to-blue-500",
              risk: null as RiskLevel | null,
            },
            {
              label: "Canlı/Ölü Oranı",
              val: `%${deadPercent.toFixed(1)}`,
              icon: Trash2,
              from:
                deadPercent > 10 ? "from-red-500" : deadPercent > 3 ? "from-amber-500" : "from-emerald-500",
              to: deadPercent > 10 ? "to-orange-500" : deadPercent > 3 ? "to-yellow-500" : "to-teal-500",
              risk:
                deadPercent > 10 ? "DANGEROUS" : deadPercent > 3 ? "WARNING" : "OK",
            },
            {
              label: "Vacuum İhtiyacı",
              val: neverVacuumed,
              icon: Wrench,
              from: neverVacuumed > 0 ? "from-red-500" : "from-emerald-500",
              to: neverVacuumed > 0 ? "to-orange-500" : "to-teal-500",
              risk: neverVacuumed > 3 ? "DANGEROUS" : neverVacuumed > 0 ? "WARNING" : "OK",
            },
            {
              label: "Analyze İhtiyacı",
              val: neverAnalyzed,
              icon: Sparkles,
              from: neverAnalyzed > 0 ? "from-amber-500" : "from-emerald-500",
              to: neverAnalyzed > 0 ? "to-orange-500" : "to-teal-500",
              risk: neverAnalyzed > 3 ? "WARNING" : neverAnalyzed > 0 ? "INFO" : "OK",
            },
            {
              label: "Autovacuum Worker",
              val: summary?.autovacuum_workers ?? 0,
              icon: PlayCircle,
              from: "from-purple-500",
              to: "to-pink-500",
              risk: null as RiskLevel | null,
            },
          ].map((m) => (
            <Card
              key={m.label}
              className={cn(
                "relative overflow-hidden",
                m.risk === "DANGEROUS" && "border-red-500/30",
                m.risk === "WARNING" && "border-amber-500/30"
              )}
            >
              <div
                className={cn(
                  "absolute inset-0 bg-gradient-to-br opacity-10 pointer-events-none",
                  m.from,
                  m.to
                )}
              />
              <CardContent className="p-6 relative">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {m.label}
                    </p>
                    <p
                      className={cn(
                        "text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-br",
                        m.from,
                        m.to
                      )}
                    >
                      {m.val}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-11 w-11 rounded-2xl bg-gradient-to-br flex items-center justify-center",
                      m.from,
                      m.to
                    )}
                    style={{ opacity: 0.85 }}
                  >
                    <m.icon className="h-5 w-5 text-white" />
                  </div>
                </div>
                {m.risk && (
                  <div className="mt-4">
                    <RiskBadge riskLevel={m.risk as "OK" | "INFO" | "WARNING" | "MAINTENANCE" | "DANGEROUS"} size="sm" className="w-full justify-center" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="!p-0">
          <div className="p-6 border-b border-white/5">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="vacuum">VACUUM</TabsTrigger>
                <TabsTrigger value="analyze">ANALYZE</TabsTrigger>
                <TabsTrigger value="reindex">REINDEX</TabsTrigger>
              </TabsList>

              <TabsContent value="vacuum" className="mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Trash2 className="h-5 w-5 text-amber-400" />
                        VACUUM Seçenekleri
                      </h3>
                      <form className="space-y-5">
                        <div className="grid grid-cols-2 gap-5">
                          <div className="space-y-2">
                            <Label>Şema (isteğe bağlı)</Label>
                            <Input
                              {...vacRegister("schema_name")}
                              placeholder="public"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tablo (isteğe bağlı)</Label>
                            <Input
                              {...vacRegister("table_name")}
                              placeholder="orders"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          İkisini de boş bırakırsanız tüm veritabanında VACUUM çalışır
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                            <Checkbox
                              id="vac-full"
                              checked={vacWatch("full")}
                              onCheckedChange={(v) =>
                                vacSetValue("full", typeof v === "boolean" ? v : false)
                              }
                            />
                            <div>
                              <label
                                htmlFor="vac-full"
                                className="text-sm font-medium cursor-pointer text-red-400"
                              >
                                FULL
                              </label>
                              <p className="text-xs text-muted-foreground">
                                ACCESS EXCLUSIVE LOCK · Yer açar ama kilitler
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                            <Checkbox
                              id="vac-analyze"
                              checked={vacWatch("analyze")}
                              onCheckedChange={(v) =>
                                vacSetValue("analyze", typeof v === "boolean" ? v : false)
                              }
                            />
                            <div>
                              <label
                                htmlFor="vac-analyze"
                                className="text-sm font-medium cursor-pointer"
                              >
                                ANALYZE
                              </label>
                              <p className="text-xs text-muted-foreground">
                                Vacuum sonrası istatistikleri güncelle
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                            <Checkbox
                              id="vac-freeze"
                              checked={vacWatch("freeze")}
                              onCheckedChange={(v) =>
                                vacSetValue("freeze", typeof v === "boolean" ? v : false)
                              }
                            />
                            <div>
                              <label
                                htmlFor="vac-freeze"
                                className="text-sm font-medium cursor-pointer"
                              >
                                FREEZE
                              </label>
                              <p className="text-xs text-muted-foreground">
                                Transaction ID wraparound koruması
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                            <Checkbox
                              id="vac-verbose"
                              checked={vacWatch("verbose")}
                              onCheckedChange={(v) =>
                                vacSetValue("verbose", typeof v === "boolean" ? v : false)
                              }
                            />
                            <div>
                              <label
                                htmlFor="vac-verbose"
                                className="text-sm font-medium cursor-pointer"
                              >
                                VERBOSE
                              </label>
                              <p className="text-xs text-muted-foreground">
                                Detaylı çıktı (log) üret
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleVacuumDryRun}
                            disabled={vacSubmitting}
                            className="h-12 flex-1 rounded-full"
                          >
                            <TerminalSquare className="h-4 w-4 mr-2" />
                            Dry Run (SQL Önizleme)
                          </Button>
                          <Button
                            type="button"
                            onClick={handleVacuumApply}
                            disabled={!vacuumPreview || vacuumMutation.isPending}
                            className={cn(
                              "h-12 flex-1 rounded-full font-bold",
                              vacWatch("full")
                                ? "bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600"
                                : "bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600"
                            )}
                          >
                            {vacuumMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Çalışıyor…
                              </>
                            ) : (
                              <>
                                <PlayCircle className="h-4 w-4 mr-2" />
                                VACUUM Uygula
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {vacuumPreview ? (
                      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            <TerminalSquare className="h-5 w-5 text-emerald-400" />
                            SQL Önizlemesi
                          </h3>
                          <RiskBadge riskLevel={vacuumPreview.risk} size="md" />
                        </div>
                        <div className="space-y-2">
                          {vacuumPreview.sql.map((sql, idx) => (
                            <pre
                              key={idx}
                              className="text-sm font-mono text-emerald-300 whitespace-pre-wrap break-all bg-black/40 rounded-2xl p-4 border border-white/5"
                            >
                              {sql}
                            </pre>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground italic border-t border-white/5 pt-4">
                          {vacuumPreview.risk === "DANGEROUS"
                            ? "Bu işlem ACCESS EXCLUSIVE LOCK alabilir. Düşük trafikte çalıştırın."
                            : "Standart VACUUM, tablo kilitlenmeden arka planda çalışır."}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
                        <TerminalSquare className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                        <p className="font-semibold text-lg">SQL Önizlemesi</p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Önce seçenekleri ayarlayıp {"\""}Dry Run{"\""} butonuna tıklayın
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="analyze" className="mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-indigo-400" />
                        ANALYZE Seçenekleri
                      </h3>
                      <form className="space-y-5">
                        <div className="grid grid-cols-2 gap-5">
                          <div className="space-y-2">
                            <Label>Şema (isteğe bağlı)</Label>
                            <Input
                              {...anaRegister("schema_name")}
                              placeholder="public"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tablo (isteğe bağlı)</Label>
                            <Input
                              {...anaRegister("table_name")}
                              placeholder="orders"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          İkisini de boş bırakırsanız tüm veritabanında ANALYZE çalışır
                        </p>

                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleAnalyzeDryRun}
                            disabled={anaSubmitting}
                            className="h-12 flex-1 rounded-full"
                          >
                            <TerminalSquare className="h-4 w-4 mr-2" />
                            Dry Run (SQL Önizleme)
                          </Button>
                          <Button
                            type="button"
                            onClick={handleAnalyzeApply}
                            disabled={!analyzePreview || analyzeMutation.isPending}
                            className="h-12 flex-1 rounded-full font-bold bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600"
                          >
                            {analyzeMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Çalışıyor…
                              </>
                            ) : (
                              <>
                                <PlayCircle className="h-4 w-4 mr-2" />
                                ANALYZE Uygula
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {analyzePreview ? (
                      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            <TerminalSquare className="h-5 w-5 text-emerald-400" />
                            SQL Önizlemesi
                          </h3>
                          <RiskBadge riskLevel={analyzePreview.risk} size="md" />
                        </div>
                        <div className="space-y-2">
                          {analyzePreview.sql.map((sql, idx) => (
                            <pre
                              key={idx}
                              className="text-sm font-mono text-emerald-300 whitespace-pre-wrap break-all bg-black/40 rounded-2xl p-4 border border-white/5"
                            >
                              {sql}
                            </pre>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground italic border-t border-white/5 pt-4">
                          ANALYZE sadece okuma kilidi alır ve sorgu planlayıcıya yardım eder.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
                        <TerminalSquare className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                        <p className="font-semibold text-lg">SQL Önizlemesi</p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Önce seçenekleri ayarlayıp {"\""}Dry Run{"\""} butonuna tıklayın
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="reindex" className="mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Database className="h-5 w-5 text-emerald-400" />
                        REINDEX Seçenekleri
                      </h3>
                      <form className="space-y-5">
                        <div className="grid grid-cols-3 gap-5">
                          <div className="space-y-2">
                            <Label>Şema</Label>
                            <Input
                              {...reiRegister("schema_name")}
                              placeholder="public"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tablo</Label>
                            <Input
                              {...reiRegister("table_name")}
                              placeholder="orders"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>İndeks (ops.)</Label>
                            <Input
                              {...reiRegister("index_name")}
                              placeholder="idx_orders_date"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          Hedefi daraltmak için soldan sağa doldurun; boş = tüm kapsam
                        </p>

                        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                          <Checkbox
                            id="rei-concurrent"
                            checked={reiWatch("concurrently")}
                            onCheckedChange={(v) =>
                              reiSetValue("concurrently", typeof v === "boolean" ? v : true)
                            }
                          />
                          <div>
                            <label
                              htmlFor="rei-concurrent"
                              className="text-sm font-medium cursor-pointer text-emerald-400"
                            >
                              CONCURRENTLY
                            </label>
                            <p className="text-xs text-muted-foreground">
                              Tabloyu kilitlemeden indeksi yeniden oluştur (önerilen)
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleReindexDryRun}
                            disabled={reiSubmitting}
                            className="h-12 flex-1 rounded-full"
                          >
                            <TerminalSquare className="h-4 w-4 mr-2" />
                            Dry Run (SQL Önizleme)
                          </Button>
                          <Button
                            type="button"
                            onClick={handleReindexApply}
                            disabled={!reindexPreview || reindexMutation.isPending}
                            className="h-12 flex-1 rounded-full font-bold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                          >
                            {reindexMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Çalışıyor…
                              </>
                            ) : (
                              <>
                                <PlayCircle className="h-4 w-4 mr-2" />
                                REINDEX Uygula
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {reindexPreview ? (
                      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            <TerminalSquare className="h-5 w-5 text-emerald-400" />
                            SQL Önizlemesi
                          </h3>
                          <RiskBadge riskLevel={reindexPreview.risk} size="md" />
                        </div>
                        <div className="space-y-2">
                          {reindexPreview.sql.map((sql, idx) => (
                            <pre
                              key={idx}
                              className="text-sm font-mono text-emerald-300 whitespace-pre-wrap break-all bg-black/40 rounded-2xl p-4 border border-white/5"
                            >
                              {sql}
                            </pre>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground italic border-t border-white/5 pt-4">
                          {reiWatch("concurrently")
                            ? "CONCURRENTLY mod: yazma işlemlerini engellemez ama daha uzun sürer."
                            : "Standart REINDEX: ilgili nesneleri geçici olarak kilitleyebilir."}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
                        <TerminalSquare className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                        <p className="font-semibold text-lg">SQL Önizlemesi</p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Önce seçenekleri ayarlayıp {"\""}Dry Run{"\""} butonuna tıklayın
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <Search className="h-5 w-5 text-indigo-400" />
                Tablo Bakım Durumu
              </CardTitle>
              <CardDescription>
                Dead tuple, vacuum/analyze geçmişi ve bloat riski
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <RiskBadge riskLevel="OK" size="sm">
                OK: {tablesByStatus.ok}
              </RiskBadge>
              <RiskBadge riskLevel="WARNING" size="sm">
                WARNING: {tablesByStatus.warning}
              </RiskBadge>
              <RiskBadge riskLevel="DANGEROUS" size="sm">
                CRITICAL: {tablesByStatus.critical}
              </RiskBadge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="!p-0">
          {reportLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : tables.length === 0 ? (
            <div className="p-12 text-center">
              <Database className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
              <p className="font-semibold text-lg">Tablo bulunamadı</p>
              <p className="text-sm text-muted-foreground mt-1">
                Bu veritabanında henüz tablo yok
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5 max-h-[520px] overflow-y-auto">
              {tables.map((t: TableMaintenance, idx) => (
                <div
                  key={`${t.schema_name ?? "public"}.${t.table_name}-${idx}`}
                  className="p-5 hover:bg-white/5 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <RiskBadge
                        riskLevel={
                          t.status === "CRITICAL"
                            ? "DANGEROUS"
                            : t.status === "WARNING"
                            ? "WARNING"
                            : "OK"
                        }
                        size="sm"
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {t.schema_name ? (
                            <span className="text-muted-foreground font-normal">
                              {t.schema_name}.
                            </span>
                          ) : null}
                          <span>{t.table_name}</span>
                        </p>
                        <div className="flex items-center gap-4 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            Canlı:{" "}
                            <span className="font-mono text-foreground">
                              {formatNumber(t.live_tuples)}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ölü:{" "}
                            <span
                              className={cn(
                                "font-mono",
                                t.dead_tuple_percent > 10
                                  ? "text-red-400"
                                  : t.dead_tuple_percent > 3
                                  ? "text-amber-400"
                                  : "text-foreground"
                              )}
                            >
                              {formatNumber(t.dead_tuples)}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Bloat:{" "}
                            <span
                              className={cn(
                                "font-mono font-semibold",
                                t.dead_tuple_percent > 10
                                  ? "text-red-400"
                                  : t.dead_tuple_percent > 3
                                  ? "text-amber-400"
                                  : "text-emerald-400"
                              )}
                            >
                              %{t.dead_tuple_percent.toFixed(1)}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                      <div className="w-40 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            t.dead_tuple_percent > 10
                              ? "bg-gradient-to-r from-red-500 to-orange-500"
                              : t.dead_tuple_percent > 3
                              ? "bg-gradient-to-r from-amber-500 to-yellow-500"
                              : "bg-gradient-to-r from-emerald-500 to-teal-500"
                          )}
                          style={{
                            width: `${Math.min(100, t.dead_tuple_percent * 5)}%`,
                          }}
                        />
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Son VACUUM
                        </p>
                        <p className="text-xs font-mono truncate max-w-[140px]">
                          {t.last_autovacuum ?? t.last_vacuum ?? "HIÇ"}
                        </p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Son ANALYZE
                        </p>
                        <p className="text-xs font-mono truncate max-w-[140px]">
                          {t.last_autoanalyze ?? t.last_analyze ?? "HIÇ"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
