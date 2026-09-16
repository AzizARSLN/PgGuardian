"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { endpoints, type Profile, type ProfileCreate } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { useConfirm } from "@/lib/hooks/useConfirm";
import {
  Database,
  Plus,
  Trash2,
  Star,
  Search,
  ChevronLeft,
  ChevronRight,
  Server,
  KeyRound,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";

type PageSize = 10 | 25 | 50;

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [globalFilter, setGlobalFilter] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProfileCreate>({
    defaultValues: {
      name: "",
      host: "localhost",
      port: 5432,
      database: "postgres",
      username: "postgres",
      password: "",
      password_env: "",
      is_default: false,
    },
  });

  const { data: profiles, isLoading, refetch } = useQuery({
    queryKey: qk.profiles.all(),
    queryFn: () => endpoints.listProfiles(),
  });

  const createMutation = useMutation({
    mutationFn: (body: ProfileCreate) => endpoints.upsertProfile(body),
    onSuccess: () => {
      toast.success("Bağlantı profili oluşturuldu");
      queryClient.invalidateQueries({ queryKey: qk.profiles.all() });
      setDialogOpen(false);
      reset();
      setShowPassword(false);
    },
    onError: () => {
      toast.error("Profil oluşturulamadı");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => endpoints.deleteProfile(name),
    onSuccess: () => {
      toast.success("Profil silindi");
      queryClient.invalidateQueries({ queryKey: qk.profiles.all() });
    },
    onError: () => {
      toast.error("Profil silinemedi");
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (name: string) => endpoints.setDefaultProfile(name),
    onSuccess: () => {
      toast.success("Varsayılan profil güncellendi");
      queryClient.invalidateQueries({ queryKey: qk.profiles.all() });
    },
    onError: () => {
      toast.error("Varsayılan ayarlanamadı");
    },
  });

  const hasDefault = (profiles ?? []).some((p) => p.is_default);

  const onSubmitCreate = handleSubmit(async (data) => {
    try {
      const payload: ProfileCreate = {
        name: data.name.trim(),
        host: data.host?.trim() || undefined,
        port: data.port ? Number(data.port) : undefined,
        database: data.database?.trim() || undefined,
        username: data.username?.trim() || undefined,
        password: data.password ? data.password : null,
        password_env: data.password_env?.trim() || null,
        is_default: data.is_default ?? false,
      };
      if (!payload.name) {
        toast.error("Profil adı zorunludur");
        return;
      }
      await createMutation.mutateAsync(payload);
    } catch (e) {
    }
  });

  const handleDelete = async (profile: Profile) => {
    if (profile.is_default) {
      toast.error("Varsayılan profil silinemez. Önce başka bir profili varsayılan yapın.");
      return;
    }
    const ok = await confirm({
      title: `"${profile.name}" profilini sil?`,
      description:
        "Bu işlem geri alınamaz. Profil ve ilişkili tüm ayarlar kalıcı olarak silinecektir. Devam etmek istediğinizden emin misiniz?",
      risk_level: "DANGEROUS",
      confirm_label: "SİL",
      cancel_label: "İptal",
      confirm_name_required: true,
      confirm_name_value: profile.name,
      confirm_name_placeholder: `Onaylamak için "${profile.name}" yazın`,
      sql_preview: [
        `DELETE FROM profiles WHERE name = '${profile.name}'`,
      ],
    });
    if (ok) {
      await deleteMutation.mutateAsync(profile.name);
    }
  };

  const handleSetDefault = async (profile: Profile) => {
    if (profile.is_default) return;
    const ok = await confirm({
      title: `"${profile.name}" varsayılan yapılsın mı?`,
      description:
        "Tüm yeni işlemler artık bu bağlantı profili üzerinden yürütülecek. Mevcut varsayılan profil değiştirilecek.",
      risk_level: "MAINTENANCE",
      confirm_label: "Varsayılan Yap",
      cancel_label: "İptal",
      sql_preview: [
        `UPDATE profiles SET is_default = true WHERE name = '${profile.name}'`,
      ],
    });
    if (ok) {
      await defaultMutation.mutateAsync(profile.name);
    }
  };

  const columns: ColumnDef<Profile>[] = [
    {
      accessorKey: "name",
      header: "Profil Adı",
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-white/10 flex items-center justify-center shrink-0">
              <Database className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm truncate">{p.name}</p>
                {p.is_default && (
                  <RiskBadge riskLevel="OK" size="sm">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    Varsayılan
                  </RiskBadge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[260px]">
                {p.username ?? "-"}@{p.host ?? "-"}:{p.port ?? 5432}/{p.database ?? "-"}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "host",
      header: "Host",
      cell: ({ row }) => (
        <code className="text-xs font-mono text-muted-foreground bg-white/5 px-3 py-1.5 rounded-full">
          {row.original.host ?? "-"}
        </code>
      ),
    },
    {
      accessorKey: "port",
      header: "Port",
      cell: ({ row }) => (
        <span className="text-sm font-mono">{row.original.port ?? "-"}</span>
      ),
    },
    {
      accessorKey: "database",
      header: "Veritabanı",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.database ?? "-"}</span>
      ),
    },
    {
      accessorKey: "username",
      header: "Kullanıcı",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-mono">{row.original.username ?? "-"}</span>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">İşlemler</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const p = row.original;
        const busy =
          deleteMutation.isPending || defaultMutation.isPending;
        return (
          <div className="flex items-center justify-end gap-2">
          {!p.is_default && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || defaultMutation.isPending}
              onClick={() => handleSetDefault(p)}
              className="h-9 rounded-full"
            >
              <Star className="h-3.5 w-3.5" />
              Varsayılan
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || p.is_default}
            onClick={() => handleDelete(p)}
            className={cn(
              "h-9 rounded-full",
              !p.is_default && "text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50"
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Sil
          </Button>
        </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: profiles ?? [],
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
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize,
      },
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
            <Server className="h-8 w-8 text-indigo-400" />
            Bağlantı Profilleri
          </h1>
          <p className="text-muted-foreground mt-1">
            PostgreSQL bağlantı profillerini yönetin. Bir tanesini varsayılan olarak ayarlayın.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => refetch()}
            className="h-12 px-6 rounded-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Yenile
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-12 px-6 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600">
                <Plus className="h-4 w-4 mr-2" />
                Yeni Profil
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-emerald-400" />
                  Yeni Bağlantı Profili
                </DialogTitle>
                <DialogDescription>
                  PostgreSQL sunucusuna bağlanmak için bilgileri girin.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmitCreate} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Profil Adı *</Label>
                    <Input
                      {...register("name", { required: "Zorunlu alan" })}
                      placeholder="prod-primary"
                      className={cn(errors.name && "border-red-500/50")}
                    />
                    {errors.name && (
                      <p className="text-xs text-red-400">{errors.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Host</Label>
                    <Input {...register("host")} placeholder="localhost" />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      {...register("port", { valueAsNumber: true })}
                      placeholder="5432"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Veritabanı</Label>
                    <Input {...register("database")} placeholder="postgres" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kullanıcı Adı</Label>
                    <Input {...register("username")} placeholder="postgres" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                  <Label>Şifre</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPassword((s) => !s)}
                    className="h-8 px-3 rounded-full text-xs"
                  >
                    {showPassword ? (
                      <><EyeOff className="h-3 w-3 mr-1" />Gizle</>
                    ) : (
                      <><Eye className="h-3 w-3 mr-1" />Göster</>
                    )}
                  </Button>
                  </div>
                  <Input
                    type={showPassword ? "text" : "password"}
                    {...register("password")}
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Şifre Ortam Değişkeni</Label>
                  <Input
                    {...register("password_env")}
                    placeholder="PGPASSWORD (isteğe bağlı, şifre yerine kullanılır)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Şifre yerine ortam değişkeni adı yazarsanız güvenlik daha iyi olur.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div>
                    <Label>Varsayılan olarak ayarla</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {hasDefault
                        ? "Mevcut varsayılan profil değiştirilecek"
                        : "Tüm işlemler bu profil ile başlar"}
                    </p>
                  </div>
                  <Switch
                    checked={watch("is_default")}
                    onCheckedChange={(v) => setValue("is_default", v)}
                  />
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      reset();
                      setShowPassword(false);
                    }}
                    className="h-11 rounded-full"
                  >
                    İptal
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting || createMutation.isPending}
                    className="h-11 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600"
                  >
                    {isSubmitting || createMutation.isPending ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Oluşturuluyor…</>
                    ) : (
                      <><Plus className="h-4 w-4 mr-2" />Profili Oluştur</>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Database className="h-5 w-5 text-indigo-400" />
              Profiller
            </CardTitle>
            <CardDescription>
              {(profiles?.length ?? 0)} adet profil · {(profiles ?? []).filter((p) => p.is_default).length} varsayılan
            </CardDescription>
          </div>
          <div className="relative max-w-md w-full">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(String(e.target.value))}
              placeholder="Profil, host, kullanıcı ara..."
              className="pl-12 h-11"
            />
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
                    <TableHead key={h.id}>
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
                  <TableCell colSpan={columns.length} className="p-6">
                    <TableSkeleton />
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="p-16 text-center">
                    <Database className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                    <p className="font-semibold text-lg">Henüz profil yok</p>
                    <p className="text-sm text-muted-foreground mt-2 mb-5">
                      Bir PostgreSQL bağlantısı oluşturmak için {'"'}Yeni Profil{'"'}e tıklayın.
                    </p>
                    <Button
                      onClick={() => setDialogOpen(true)}
                      className="h-11 px-6 rounded-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      İlk Profili Oluştur
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && (profiles?.length ?? 0) > 0 && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 border-t border-white/5">
            <div className="flex items-center gap-3 text-sm">
              <p className="text-muted-foreground">
                Sayfa{" "}
                <span className="font-semibold text-foreground">
                  {currentPage + 1}
                </span>{" "}
                / {Math.max(1, pageCount)} · Toplam{" "}
                <span className="font-semibold text-foreground">
                  {profiles?.length ?? 0}
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
