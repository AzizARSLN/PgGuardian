"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  SortingState,
  getSortedRowModel,
  ColumnFiltersState,
  getFilteredRowModel,
} from "@tanstack/react-table";
import {
  endpoints,
  type SettingInfo,
  type SettingChange,
  type DryRunResult,
  type MutationRequest,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings2,
  Search,
  RefreshCw,
  Save,
  AlertCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Power,
  Pencil,
  X,
  Check,
  Database,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/lib/hooks/useConfirm";

type PageSize = 10 | 25 | 50;

type EditState = {
  name: string;
  newValue: string;
} | null;

function TableSkeleton() {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

const CONTEXT_RISK: Record<string, RiskLevel> = {
  internal: "OK",
  postmaster: "DANGEROUS",
  sighup: "MAINTENANCE",
  superuser: "WARNING",
  user: "OK",
  backend: "MAINTENANCE",
  superuser_backend: "WARNING",
};

export default function ConfigPage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [globalFilter, setGlobalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [contextFilter, setContextFilter] = useState<string>("all");
  const [editState, setEditState] = useState<EditState>(null);

  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: qk.configops.all(),
    queryFn: () => endpoints.listSettings(),
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    (settings ?? []).forEach((s) => s.category && cats.add(s.category));
    return Array.from(cats).sort();
  }, [settings]);

  const contexts = useMemo(() => {
    const cts = new Set<string>();
    (settings ?? []).forEach((s) => s.context && cts.add(s.context));
    return Array.from(cts).sort();
  }, [settings]);

  const filteredSettings = useMemo(() => {
    let list = settings ?? [];
    if (categoryFilter !== "all") {
      list = list.filter((s) => s.category === categoryFilter);
    }
    if (contextFilter !== "all") {
      list = list.filter((s) => s.context === contextFilter);
    }
    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.setting ?? "").toLowerCase().includes(q) ||
          (s.category ?? "").toLowerCase().includes(q) ||
          (s.unit ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [settings, categoryFilter, contextFilter, globalFilter]);

  const pendingRestartCount = (settings ?? []).filter((s) => s.pending_restart).length;
  const superuserContextCount = (settings ?? []).filter(
    (s) => s.context === "superuser" || s.context === "superuser_backend"
  ).length;
  const sighupContextCount = (settings ?? []).filter((s) => s.context === "sighup").length;
  const postmasterContextCount = (settings ?? []).filter((s) => s.context === "postmaster").length;

  const changeSettingMutation = useMutation({
    mutationFn: (payload: { name: string; body: SettingChange }) =>
      endpoints.changeSetting(payload.name, payload.body),
    onSuccess: () => {
      toast.success("Ayar güncellendi");
      queryClient.invalidateQueries({ queryKey: qk.configops.all() });
    },
    onError: () => {
      toast.error("Ayar güncellenemedi");
    },
  });

  const reloadConfigMutation = useMutation({
    mutationFn: (body: MutationRequest) => endpoints.reloadConfig(body),
    onSuccess: (res) => {
      const r = res as { reloaded?: boolean };
      if (r && r.reloaded) {
        toast.success("Konfigürasyon başarıyla yeniden yüklendi (SIGHUP)");
      } else {
        toast.success("pg_reload_conf() çağrıldı");
      }
      queryClient.invalidateQueries({ queryKey: qk.configops.all() });
    },
    onError: () => {
      toast.error("Konfigürasyon yeniden yüklenemedi");
    },
  });

  const handleEditStart = (setting: SettingInfo) => {
    setEditState({ name: setting.name, newValue: setting.setting ?? "" });
  };

  const handleEditCancel = () => {
    setEditState(null);
  };

  const handleEditSave = async (setting: SettingInfo) => {
    if (!editState) return;
    const newValue = editState.newValue.trim();
    if (newValue === setting.setting) {
      setEditState(null);
      toast.info("Değişiklik algılanmadı");
      return;
    }

    try {
      const dryRunPayload: SettingChange = {
        value: newValue,
        dry_run: true,
      };
      const dryRunRes = (await endpoints.changeSetting(
        setting.name,
        dryRunPayload
      )) as DryRunResult;

      const sql = dryRunRes?.sql ?? [
        `ALTER SYSTEM SET ${setting.name} = '${newValue}';`,
      ];
      const risk = (dryRunRes?.risk ?? "DANGEROUS") as "MAINTENANCE" | "DANGEROUS";

      const ok = await confirm({
        title: `"${setting.name}" değeri değiştirilsin mi?`,
        description:
          setting.context === "postmaster"
            ? `Bu ayarın (${setting.context}) uygulanması için PostgreSQL sunucusunun YENİDEN BAŞLATILMASI gerekir. Uygulamadan sonra sunucuyu restart etmelisiniz.`
            : setting.context === "sighup"
            ? `Bu ayar (${setting.context}) SIGHUP ile (pg_reload_conf) uygulanabilir. Değişiklik sonrası "Konfigürasyonu Yeniden Yükle" butonuna basmayı unutmayın.`
            : `Bu ayar (${setting.context}) yeni bağlantılarda/süreçlerde devreye girebilir.`,
        risk_level: risk,
        sql_preview: sql,
        confirm_label: "ALTER SYSTEM SET Uygula",
        cancel_label: "İptal",
      });
      if (!ok) return;

      const payload: SettingChange = {
        value: newValue,
        confirm: true,
      };
      await changeSettingMutation.mutateAsync({ name: setting.name, body: payload });
      setEditState(null);
    } catch (e) {}
  };

  const handleReloadConfig = async () => {
    const ok = await confirm({
      title: "Sunucu konfigürasyonu yeniden yüklensin mi?",
      description:
        "pg_reload_conf() çağrılacak ve postgresql.conf / ALTER SYSTEM değişiklikleri SIGHUP ile yüklenecektir. Bu işlem çalışan bağlantıları kesmez ancak tüm ayarlar (postmaster) için yeniden başlatma gerekebilir.",
      risk_level: "MAINTENANCE",
      confirm_label: "pg_reload_conf() Çalıştır",
      cancel_label: "İptal",
      sql_preview: ["SELECT pg_reload_conf();"],
    });
    if (!ok) return;
    await reloadConfigMutation.mutateAsync({ confirm: true });
  };

  const columns: ColumnDef<SettingInfo>[] = [
    {
      accessorKey: "name",
      header: "Ayar Adı",
      size: 260,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="flex items-center gap-3 min-w-0">
            {s.pending_restart && (
              <div className="h-10 w-1.5 rounded-full bg-gradient-to-b from-red-500 to-red-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold truncate">{s.name}</p>
              {s.category && (
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5 truncate">
                  {s.category}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "setting",
      header: "Değer",
      size: 220,
      cell: ({ row }) => {
        const s = row.original;
        const isEditing = editState?.name === s.name;
        if (isEditing && editState) {
          return (
            <div className="flex items-center gap-2">
              <Input
                value={editState.newValue}
                onChange={(e) =>
                  setEditState({ ...editState, newValue: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEditSave(s);
                  if (e.key === "Escape") handleEditCancel();
                }}
                className="h-9 font-mono text-sm"
                autoFocus
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleEditSave(s)}
                disabled={changeSettingMutation.isPending}
                className="h-9 w-9 rounded-full border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleEditCancel}
                className="h-9 w-9 rounded-full text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono bg-white/5 px-3 py-1.5 rounded-full truncate max-w-[180px]">
              {s.setting ?? "-"}
            </code>
            {s.unit && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {s.unit}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "unit",
      header: "Birim",
      size: 90,
      cell: ({ row }) => (
        <span className="text-xs font-mono text-muted-foreground">
          {row.original.unit ?? "-"}
        </span>
      ),
      enableColumnFilter: false,
    },
    {
      accessorKey: "context",
      header: "Context",
      size: 160,
      cell: ({ row }) => {
        const ctx = row.original.context ?? "-";
        const risk = CONTEXT_RISK[ctx] ?? "INFO";
        return <RiskBadge riskLevel={risk} size="sm">{ctx}</RiskBadge>;
      },
    },
    {
      accessorKey: "pending_restart",
      header: "Durum",
      size: 150,
      cell: ({ row }) => {
        const s = row.original;
        if (s.pending_restart) {
          return (
            <RiskBadge riskLevel="DANGEROUS" size="sm" className="animate-pulse">
              <AlertCircle className="h-3 w-3" />
              RESTART GEREKİYOR
            </RiskBadge>
          );
        }
        return (
          <RiskBadge riskLevel="OK" size="sm">
            <Check className="h-3 w-3" />
            Uygulandı
          </RiskBadge>
        );
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">İşlem</div>,
      size: 110,
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        const isEditing = editState?.name === s.name;
        const busy = changeSettingMutation.isPending;
        if (isEditing) return null;
        return (
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full"
              onClick={() => handleEditStart(s)}
              disabled={busy}
            >
              <Pencil className="h-3.5 w-3.5" />
              Düzenle
            </Button>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: filteredSettings,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
    initialState: {
      pagination: {
        pageSize,
      },
      sorting: [{ id: "name", desc: false }],
    },
  });

  const currentPage = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const canPrev = currentPage > 0;
  const canNext = currentPage < pageCount - 1;

  return (
    <div className="space-y-8">
      <ConfirmDialog />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Settings2 className="h-8 w-8 text-purple-400" />
            Sunucu Yapılandırması
          </h1>
          <p className="text-muted-foreground mt-1">
            PostgreSQL postgresql.conf parametreleri — ALTER SYSTEM SET ile güvenli değiştirim
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              refetch();
              toast.success("Ayarlar yenilendi");
            }}
            className="h-12 px-6 rounded-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Yenile
          </Button>
          <Button
            onClick={handleReloadConfig}
            disabled={reloadConfigMutation.isPending}
            className={cn(
              "h-12 px-6 rounded-full font-semibold",
              pendingRestartCount > 0
                ? "bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 animate-pulse"
                : "bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600"
            )}
          >
            {reloadConfigMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Yükleniyor…
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4 mr-2" />
                {pendingRestartCount > 0
                  ? `${pendingRestartCount} Ayar · Konfigürasyonu Yeniden Yükle`
                  : "Konfigürasyonu Yeniden Yükle (Reload)"}
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
        {isLoading ? (
          [0, 1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-9 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          [
            {
              label: "Toplam Ayar",
              val: (settings ?? []).length,
              icon: Settings2,
              from: "from-indigo-500",
              to: "to-purple-500",
            },
            {
              label: "SIGHUP (Reload)",
              val: sighupContextCount,
              icon: RotateCcw,
              from: "from-amber-500",
              to: "to-yellow-500",
              risk: sighupContextCount > 0 ? ("MAINTENANCE" as RiskLevel) : null,
            },
            {
              label: "Süperuser Context",
              val: superuserContextCount,
              icon: Power,
              from: "from-rose-500",
              to: "to-pink-500",
              risk: superuserContextCount > 50 ? ("WARNING" as RiskLevel) : null,
            },
            {
              label: "Postmaster (Restart)",
              val: postmasterContextCount,
              icon: Server,
              from: "from-red-500",
              to: "to-orange-500",
              risk: postmasterContextCount > 0 ? ("DANGEROUS" as RiskLevel) : null,
            },
            {
              label: "Restart Bekleyen",
              val: pendingRestartCount,
              icon: AlertCircle,
              from: pendingRestartCount > 0 ? "from-red-500" : "from-emerald-500",
              to: pendingRestartCount > 0 ? "to-rose-500" : "to-teal-500",
              risk:
                pendingRestartCount > 5
                  ? ("DANGEROUS" as RiskLevel)
                  : pendingRestartCount > 0
                  ? ("WARNING" as RiskLevel)
                  : ("OK" as RiskLevel),
              borderWarn: pendingRestartCount > 0,
            },
          ].map((m) => (
            <Card
              key={m.label}
              className={cn(
                "relative overflow-hidden",
                m.risk === "DANGEROUS" && "border-red-500/30",
                m.risk === "WARNING" && "border-amber-500/30",
                m.borderWarn && "border-red-500/30"
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
                    <RiskBadge riskLevel={m.risk} size="sm" className="w-full justify-center" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <Database className="h-5 w-5 text-purple-400" />
                Yapılandırma Ayarları
              </CardTitle>
              <CardDescription>
                {filteredSettings.length} / {(settings ?? []).length} ayar listeleniyor
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full md:w-72">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={globalFilter ?? ""}
                  onChange={(e) => {
                    setGlobalFilter(String(e.target.value));
                    table.setPageIndex(0);
                  }}
                  placeholder="Ayar ara (ad/değer/kategori)..."
                  className="pl-11 h-11"
                />
              </div>
              <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); table.setPageIndex(0); }}>
                <SelectTrigger className="h-11 w-full md:w-56 rounded-full">
                  <span className="text-xs text-muted-foreground mr-1">Kategori:</span>
                  <SelectValue placeholder="Kategori seç..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Kategoriler</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={contextFilter} onValueChange={(v) => { setContextFilter(v); table.setPageIndex(0); }}>
                <SelectTrigger className="h-11 w-full md:w-48 rounded-full">
                  <span className="text-xs text-muted-foreground mr-1">Context:</span>
                  <SelectValue placeholder="Context seç..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {contexts.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="!p-0">
          <div className="rounded-3xl overflow-hidden">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead
                        key={h.id}
                        style={{ width: h.column.getSize() }}
                        className={cn(
                          h.id === "actions" && "text-right"
                        )}
                      >
                        {h.isPlaceholder
                          ? null
                          : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="!p-0">
                      <TableSkeleton />
                    </TableCell>
                  </TableRow>
                ) : table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="p-16 text-center">
                      <Settings2 className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                      <p className="font-semibold text-lg">Ayar bulunamadı</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Filtreleri değiştirerek veya arama terimini temizleyerek tekrar deneyin.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        row.original.pending_restart &&
                          "bg-red-500/5 [&:hover]:bg-red-500/10"
                      )}
                      style={
                        row.original.pending_restart
                          ? {
                              boxShadow: "inset 4px 0 0 0 rgb(239 68 68 / 0.7)",
                            }
                          : undefined
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && filteredSettings.length > 0 && (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 border-t border-white/5">
              <div className="flex items-center gap-3 text-sm">
                <p className="text-muted-foreground">
                  Sayfa{" "}
                  <span className="font-semibold text-foreground">
                    {currentPage + 1}
                  </span>{" "}
                  / {Math.max(1, pageCount)} · Toplam{" "}
                  <span className="font-semibold text-foreground">
                    {filteredSettings.length}
                  </span>{" "}
                  kayıt
                </p>
                <div className="h-6 w-px bg-white/10" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Sayfa başına:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      const n = Number(v) as PageSize;
                      setPageSize(n);
                      table.setPageSize(n);
                    }}
                  >
                    <SelectTrigger className="h-9 w-[88px] rounded-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.previousPage()}
                  disabled={!canPrev}
                  className="h-9 rounded-full"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Önceki
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.nextPage()}
                  disabled={!canNext}
                  className="h-9 rounded-full"
                >
                  Sonraki
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
