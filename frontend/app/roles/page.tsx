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
import Link from "next/link";
import { endpoints, type RoleInfo, type RoleCreate, type DryRunResult } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/lib/hooks/useConfirm";
import {
  Shield,
  Plus,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
  RefreshCw,
  Edit3,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";

type PageSize = 10 | 25 | 50;

function TableSkeleton() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function AttrBadge({ label, value }: { label: string; value: boolean }) {
  return value ? (
    <RiskBadge riskLevel="OK" size="sm" showIcon={false} className="h-7">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      {label}
    </RiskBadge>
  ) : (
    <RiskBadge riskLevel="INFO" size="sm" showIcon={false} className="h-7 opacity-60">
      <XCircle className="h-3 w-3 mr-1" />
      {label}
    </RiskBadge>
  );
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
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
  } = useForm<RoleCreate>({
    defaultValues: {
      name: "",
      login: true,
      password: "",
      superuser: false,
      createdb: false,
      createrole: false,
      connection_limit: -1,
    },
  });

  const { data: roles, isLoading, refetch } = useQuery({
    queryKey: qk.roles.all(),
    queryFn: () => endpoints.listRoles(),
  });

  const createMutation = useMutation({
    mutationFn: (body: RoleCreate) => endpoints.createRole(body),
    onSuccess: () => {
      toast.success("Rol başarıyla oluşturuldu");
      queryClient.invalidateQueries({ queryKey: qk.roles.all() });
      setDialogOpen(false);
      reset();
    },
    onError: () => {
      toast.error("Rol oluşturulamadı");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      endpoints.dropRole(name, { confirm: true, confirm_name: name }),
    onSuccess: () => {
      toast.success("Rol silindi");
      queryClient.invalidateQueries({ queryKey: qk.roles.all() });
    },
    onError: () => {
      toast.error("Rol silinemedi");
    },
  });

  const onSubmitCreate = handleSubmit(async (data) => {
    try {
      const trimmedName = data.name.trim();
      if (!trimmedName) {
        toast.error("Rol adı zorunludur");
        return;
      }

      const dryRunPayload: RoleCreate = {
        name: trimmedName,
        login: data.login,
        password: data.password || null,
        superuser: data.superuser,
        createdb: data.createdb,
        createrole: data.createrole,
        connection_limit: data.connection_limit,
        dry_run: true,
      };

      const dryRunRes = await endpoints.createRole(dryRunPayload);
      const dryRun = dryRunRes as DryRunResult;

      if (dryRun && "sql" in dryRunRes && dryRunRes.sql) {
        const riskLevel = (dryRunRes.risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS";
        const ok = await confirm({
          title: `"${trimmedName}" rolü oluşturulsun mu?`,
          description:
            "Yeni PostgreSQL rolü oluşturulacak. Aşağıdaki SQL komutu çalıştırılacak. Onaylıyor musunuz?",
          risk_level: riskLevel,
          confirm_label: "Rolü Oluştur",
          cancel_label: "İptal",
          sql_preview: dryRunRes.sql,
        });
        if (!ok) return;
      }

      const payload: RoleCreate = {
        name: trimmedName,
        login: data.login,
        password: data.password || null,
        superuser: data.superuser,
        createdb: data.createdb,
        createrole: data.createrole,
        connection_limit: data.connection_limit,
        confirm: true,
      };
      await createMutation.mutateAsync(payload);
    } catch (e) {}
  });

  const handleDelete = async (role: RoleInfo) => {
    if (role.name === "postgres") {
      toast.error("postgres süper kullanıcısı silinemez");
      return;
    }
    const ok = await confirm({
      title: `"${role.name}" rolünü sil?`,
      description:
        "Bu işlem geri alınamaz. Rol ve varsa tüm üyelikleri kalıcı olarak silinecektir. Devam etmek istediğinizden emin misiniz?",
      risk_level: "DANGEROUS",
      confirm_label: "SİL",
      cancel_label: "İptal",
      confirm_name_required: true,
      confirm_name_value: role.name,
      confirm_name_placeholder: `Onaylamak için "${role.name}" yazın`,
      sql_preview: [`DROP ROLE ${role.name};`],
    });
    if (ok) {
      await deleteMutation.mutateAsync(role.name);
    }
  };

  const handleEdit = async (role: RoleInfo) => {
    toast.info("Rol detayına yönlendiriliyorsunuz", {
      description: "Attributes, Grants ve Memberships sekmelerinden düzenleme yapabilirsiniz",
    });
  };

  const columns: ColumnDef<RoleInfo>[] = [
    {
      accessorKey: "name",
      header: "Rol Adı",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Link href={`/roles/${encodeURIComponent(r.name)}`} className="block group">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-white/10 flex items-center justify-center shrink-0 group-hover:from-indigo-500/30 group-hover:to-emerald-500/30 transition-all">
                <Users className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate group-hover:text-emerald-400 transition-colors">
                    {r.name}
                  </p>
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  {r.superuser && (
                    <RiskBadge riskLevel="DANGEROUS" size="sm">
                      SUPERUSER
                    </RiskBadge>
                  )}
                </div>
                {r.valid_until && (
                  <p className="text-xs text-muted-foreground truncate">
                    Şifre geçerlilik: {r.valid_until.split("T")[0]}
                  </p>
                )}
              </div>
            </div>
          </Link>
        );
      },
    },
    {
      accessorKey: "superuser",
      header: "Süper",
      cell: ({ row }) => <AttrBadge label="SUPER" value={row.original.superuser} />,
    },
    {
      accessorKey: "createdb",
      header: "DB",
      cell: ({ row }) => <AttrBadge label="CREATEDB" value={row.original.createdb} />,
    },
    {
      accessorKey: "createrole",
      header: "Rol",
      cell: ({ row }) => <AttrBadge label="CREATEROLE" value={row.original.createrole} />,
    },
    {
      accessorKey: "can_login",
      header: "Giriş",
      cell: ({ row }) => <AttrBadge label="LOGIN" value={row.original.can_login} />,
    },
    {
      accessorKey: "connection_limit",
      header: "Bağlantı Limiti",
      cell: ({ row }) => {
        const lim = row.original.connection_limit;
        return (
          <code className="text-xs font-mono bg-white/5 px-3 py-1.5 rounded-full">
            {lim === -1 || lim === null ? "∞" : lim}
          </code>
        );
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">İşlemler</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const busy = deleteMutation.isPending;
        return (
          <div className="flex items-center justify-end gap-2">
            <Link href={`/roles/${encodeURIComponent(r.name)}`}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEdit(r)}
                className="h-9 rounded-full"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Düzenle
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || r.name === "postgres"}
              onClick={() => handleDelete(r)}
              className={cn(
                "h-9 rounded-full",
                r.name !== "postgres" &&
                  "text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50"
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
    data: roles ?? [],
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

  const superuserCount = (roles ?? []).filter((r) => r.superuser).length;
  const canLoginCount = (roles ?? []).filter((r) => r.can_login).length;
  const createdbCount = (roles ?? []).filter((r) => r.createdb).length;
  const createroleCount = (roles ?? []).filter((r) => r.createrole).length;

  return (
    <div className="space-y-8">
      <ConfirmDialog />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Shield className="h-8 w-8 text-indigo-400" />
            Roller ve İzinler
          </h1>
          <p className="text-muted-foreground mt-1">
            PostgreSQL rollerini, özniteliklerini ve izinlerini yönetin
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
                Yeni Rol
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-emerald-400" />
                  Yeni Rol Oluştur
                </DialogTitle>
                <DialogDescription>
                  PostgreSQL sunucusunda yeni bir rol (kullanıcı) oluşturun
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmitCreate} className="space-y-5">
                <div className="space-y-2">
                  <Label>Rol Adı *</Label>
                  <Input
                    {...register("name", { required: "Zorunlu alan" })}
                    placeholder="app_user"
                    className={cn(errors.name && "border-red-500/50")}
                  />
                  {errors.name && (
                    <p className="text-xs text-red-400">{errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Şifre</Label>
                  <Input
                    type="password"
                    {...register("password")}
                    placeholder="•••••••• (boş bırakılırsa şifresiz)"
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
                  <Label className="font-semibold">Rol Öznitelikleri</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="attr-login"
                        checked={watch("login")}
                        onCheckedChange={(v) =>
                          setValue("login", typeof v === "boolean" ? v : false)
                        }
                      />
                      <div>
                        <label
                          htmlFor="attr-login"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Giriş Yapabilir (LOGIN)
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Bu rol ile sunucuya bağlanılabilsin
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="attr-superuser"
                        checked={watch("superuser")}
                        onCheckedChange={(v) =>
                          setValue("superuser", typeof v === "boolean" ? v : false)
                        }
                      />
                      <div>
                        <label
                          htmlFor="attr-superuser"
                          className="text-sm font-medium cursor-pointer text-amber-400"
                        >
                          Süper Kullanıcı (SUPERUSER)
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Tüm kısıtlamalardan muaf, DANGEROUS
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="attr-createdb"
                        checked={watch("createdb")}
                        onCheckedChange={(v) =>
                          setValue("createdb", typeof v === "boolean" ? v : false)
                        }
                      />
                      <div>
                        <label
                          htmlFor="attr-createdb"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Veritabanı Oluştur (CREATEDB)
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Yeni DB yaratabilsin
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="attr-createrole"
                        checked={watch("createrole")}
                        onCheckedChange={(v) =>
                          setValue("createrole", typeof v === "boolean" ? v : false)
                        }
                      />
                      <div>
                        <label
                          htmlFor="attr-createrole"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Rol Oluştur (CREATEROLE)
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Diğer rolleri yönetebilsin
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Bağlantı Limiti</Label>
                  <Select
                    value={String(watch("connection_limit") ?? "-1")}
                    onValueChange={(v) => setValue("connection_limit", Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-1">Sınırsız (∞)</SelectItem>
                      <SelectItem value="1">1 bağlantı</SelectItem>
                      <SelectItem value="5">5 bağlantı</SelectItem>
                      <SelectItem value="10">10 bağlantı</SelectItem>
                      <SelectItem value="20">20 bağlantı</SelectItem>
                      <SelectItem value="50">50 bağlantı</SelectItem>
                      <SelectItem value="100">100 bağlantı</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      reset();
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
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Oluşturuluyor…
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Rolü Oluştur
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {[
          {
            label: "Toplam Rol",
            val: roles?.length ?? 0,
            icon: Users,
            from: "from-indigo-500",
            to: "to-blue-500",
          },
          {
            label: "Süper Kullanıcı",
            val: superuserCount,
            icon: Shield,
            from: "from-amber-500",
            to: "to-orange-500",
            warn: superuserCount > 3,
          },
          {
            label: "Giriş Yapabilen",
            val: canLoginCount,
            icon: CheckCircle2,
            from: "from-emerald-500",
            to: "to-teal-500",
          },
          {
            label: "DB + Rol Yetkisi",
            val: createdbCount + createroleCount,
            icon: Edit3,
            from: "from-purple-500",
            to: "to-pink-500",
          },
        ].map((m) => (
          <Card
            key={m.label}
            className={cn(
              "relative overflow-hidden",
              m.warn && "border-amber-500/30"
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
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
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
                    "h-12 w-12 rounded-2xl bg-gradient-to-br flex items-center justify-center",
                    m.from,
                    m.to,
                    "bg-opacity-20"
                  )}
                  style={{ opacity: 0.85 }}
                >
                  <m.icon className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-400" />
                Roller
              </CardTitle>
              <CardDescription>
                {(roles?.length ?? 0)} adet rol listeleniyor
              </CardDescription>
            </div>
            <div className="relative max-w-md w-full">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={globalFilter ?? ""}
                onChange={(e) => setGlobalFilter(String(e.target.value))}
                placeholder="Rol adı ara..."
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
                    <TableCell colSpan={columns.length} className="!p-0">
                      <TableSkeleton />
                    </TableCell>
                  </TableRow>
                ) : table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="p-16 text-center">
                      <Shield className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                      <p className="font-semibold text-lg">Henüz rol yok</p>
                      <p className="text-sm text-muted-foreground mt-2 mb-5">
                        Bir PostgreSQL rolü oluşturmak için {"\""}Yeni Rol{"\""}e tıklayın.
                      </p>
                      <Button
                        onClick={() => setDialogOpen(true)}
                        className="h-11 px-6 rounded-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        İlk Rolü Oluştur
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
          {!isLoading && (roles?.length ?? 0) > 0 && (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 border-t border-white/5">
              <div className="flex items-center gap-3 text-sm">
                <p className="text-muted-foreground">
                  Sayfa{" "}
                  <span className="font-semibold text-foreground">
                    {currentPage + 1}
                  </span>{" "}
                  / {Math.max(1, pageCount)} · Toplam{" "}
                  <span className="font-semibold text-foreground">
                    {roles?.length ?? 0}
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
