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
import { api, ApiError } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { IfWriter } from "@/components/role-guard";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useI18n } from "@/lib/i18n";
import { useProfileStore } from "@/store/useProfileStore";
import {
  AlertTriangle,
  Plus,
  Trash2,
  Star,
  Search,
  ChevronLeft,
  ChevronRight,
  Server,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";

type PageSize = 10 | 25 | 50;

const NO_PROFILES: Profile[] = [];

// Same rule the backend enforces; the 422 is still surfaced if the two ever differ.
const PASSWORD_ENV_PATTERN = /^[A-Z_][A-Z0-9_]*(PASS|PASSWORD|PWD)[A-Z0-9_]*$/;
const PASSWORD_ENV_DENIED = /^(PGGUARDIAN_|PGPASSWORD$)/;

const FORM_FIELDS = ["name", "host", "port", "database", "username", "password", "password_env"] as const;
type FormField = (typeof FORM_FIELDS)[number];

export default function ConnectionsPage() {
  const { t, formatNumber } = useI18n();
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
    setError,
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

  // This page is reachable before a profile is chosen, so it only ever talks to /profiles.
  const { data: profiles, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: qk.profiles.all(),
    queryFn: () => endpoints.listProfiles(),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    reset();
    setShowPassword(false);
  };

  const createMutation = useMutation({
    // skipToast: validation failures are shown next to the field that caused them.
    mutationFn: (body: ProfileCreate) => api.post<Profile>("/profiles", body, { skipToast: true }),
    onSuccess: () => {
      toast.success(t("connections.toast.created"));
      queryClient.invalidateQueries({ queryKey: qk.profiles.all() });
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => endpoints.deleteProfile(name),
    onSuccess: (_, name) => {
      toast.success(t("connections.toast.deleted"));
      queryClient.invalidateQueries({ queryKey: qk.profiles.all() });
      // The session must not keep pointing at a profile that no longer exists.
      const store = useProfileStore.getState();
      if (store.selectedProfileName === name) {
        queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== "profiles" });
        store.setSelectedProfileName(null);
      }
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (name: string) => endpoints.setDefaultProfile(name),
    onSuccess: () => {
      toast.success(t("connections.toast.defaultUpdated"));
      queryClient.invalidateQueries({ queryKey: qk.profiles.all() });
    },
  });

  const allProfiles = profiles ?? NO_PROFILES;
  const hasDefault = allProfiles.some((p) => p.is_default);

  const showSubmitError = (error: unknown) => {
    const validation = error instanceof ApiError ? error.validationErrors : null;
    let placed = false;
    for (const item of validation ?? []) {
      const field = item.loc[item.loc.length - 1];
      if (FORM_FIELDS.includes(field as FormField)) {
        setError(field as FormField, { message: item.msg.replace(/^Value error,\s*/, "") });
        placed = true;
      }
    }
    if (!placed) {
      setError("root", {
        message: error instanceof Error ? error.message : t("connections.toast.createFailed"),
      });
    }
  };

  const onSubmitCreate = handleSubmit(async (data) => {
    const name = data.name.trim();
    if (!name) {
      setError("name", { message: t("connections.form.required") });
      return;
    }
    // POST /profiles is an upsert: an existing name would be silently replaced.
    if (allProfiles.some((p) => p.name === name)) {
      setError("name", { message: t("connections.form.nameTaken", { name }) });
      return;
    }
    const payload: ProfileCreate = {
      name,
      host: data.host?.trim() || undefined,
      port: data.port ? Number(data.port) : undefined,
      database: data.database?.trim() || undefined,
      username: data.username?.trim() || undefined,
      password: data.password ? data.password : null,
      password_env: data.password_env?.trim() || null,
      is_default: data.is_default ?? false,
    };
    try {
      await createMutation.mutateAsync(payload);
    } catch (error) {
      showSubmitError(error);
    }
  });

  const handleDelete = async (profile: Profile) => {
    if (profile.is_default) {
      toast.error(t("connections.toast.defaultProtected"));
      return;
    }
    const ok = await confirm({
      title: t("connections.confirmDelete.title", { name: profile.name }),
      description: t("connections.confirmDelete.description"),
      risk_level: "DANGEROUS",
      confirm_label: t("common.delete"),
      cancel_label: t("common.cancel"),
      confirm_name_required: true,
      confirm_name_value: profile.name,
      confirm_name_placeholder: t("connections.confirmDelete.placeholder", { name: profile.name }),
    });
    if (ok) deleteMutation.mutate(profile.name);
  };

  const handleSetDefault = async (profile: Profile) => {
    if (profile.is_default) return;
    const ok = await confirm({
      title: t("connections.confirmDefault.title", { name: profile.name }),
      description: t("connections.confirmDefault.description"),
      risk_level: "MAINTENANCE",
      confirm_label: t("connections.confirmDefault.confirm"),
      cancel_label: t("common.cancel"),
    });
    if (ok) defaultMutation.mutate(profile.name);
  };

  const columns: ColumnDef<Profile>[] = [
    {
      accessorKey: "name",
      header: t("connections.columns.name"),
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="truncate font-mono font-medium">{p.name}</span>
            {p.is_default && (
              <Badge variant="outline" className="gap-1 border-warning/30 text-[10px] text-warning">
                <Star className="h-3 w-3 fill-warning" />
                {t("connections.default")}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "host",
      header: t("connections.columns.host"),
      cell: ({ row }) => <span className="font-mono">{row.original.host ?? "-"}</span>,
    },
    {
      accessorKey: "port",
      header: t("connections.columns.port"),
      cell: ({ row }) => <span className="font-mono">{row.original.port ?? "-"}</span>,
    },
    {
      accessorKey: "database",
      header: t("connections.columns.database"),
      cell: ({ row }) => <span className="font-mono">{row.original.database ?? "-"}</span>,
    },
    {
      accessorKey: "username",
      header: t("connections.columns.username"),
      cell: ({ row }) => <span className="font-mono">{row.original.username ?? "-"}</span>,
    },
    {
      id: "actions",
      header: () => <div className="text-right">{t("connections.columns.actions")}</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const p = row.original;
        const busy = deleteMutation.isPending || defaultMutation.isPending;
        return (
          <IfWriter>
            <div className="flex items-center justify-end gap-1">
              {!p.is_default && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleSetDefault(p)}
                  className="h-7 px-2"
                >
                  <Star className="h-3.5 w-3.5" />
                  {t("connections.setDefault")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || p.is_default}
                onClick={() => handleDelete(p)}
                className={cn(
                  "h-7 px-2",
                  !p.is_default && "text-destructive hover:bg-destructive/10 hover:text-destructive"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common.delete")}
              </Button>
            </div>
          </IfWriter>
        );
      },
    },
  ];

  const table = useReactTable({
    data: allProfiles,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    state: { sorting, columnFilters, globalFilter },
    initialState: { pagination: { pageSize } },
  });

  const currentPage = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Server className="h-4 w-4 text-muted-foreground" />
            {t("connections.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("connections.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          <IfWriter>
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  {t("connections.newProfile")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("connections.form.title")}</DialogTitle>
                  <DialogDescription>{t("connections.form.description")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmitCreate} className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1 md:col-span-2">
                      <Label htmlFor="profile-name">{t("connections.form.name")}</Label>
                      <Input
                        id="profile-name"
                        {...register("name", { required: t("connections.form.required") })}
                        placeholder="prod-primary"
                        className={cn("font-mono", errors.name && "border-destructive/50")}
                      />
                      {errors.name && (
                        <p className="text-xs text-destructive">{errors.name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="profile-host">{t("connections.columns.host")}</Label>
                      <Input
                        id="profile-host"
                        {...register("host")}
                        placeholder="localhost"
                        className={cn("font-mono", errors.host && "border-destructive/50")}
                      />
                      {errors.host && (
                        <p className="text-xs text-destructive">{errors.host.message}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="profile-port">{t("connections.columns.port")}</Label>
                      <Input
                        id="profile-port"
                        type="number"
                        {...register("port", {
                          valueAsNumber: true,
                          validate: (v) =>
                            v === undefined ||
                            Number.isNaN(v) ||
                            (v >= 1 && v <= 65535) ||
                            t("connections.form.portRange"),
                        })}
                        placeholder="5432"
                        className={cn("font-mono", errors.port && "border-destructive/50")}
                      />
                      {errors.port && (
                        <p className="text-xs text-destructive">{errors.port.message}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="profile-database">{t("connections.columns.database")}</Label>
                      <Input
                        id="profile-database"
                        {...register("database")}
                        placeholder="postgres"
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="profile-username">{t("connections.columns.username")}</Label>
                      <Input
                        id="profile-username"
                        {...register("username")}
                        placeholder="postgres"
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="profile-password">{t("connections.form.password")}</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPassword((s) => !s)}
                        className="h-6 px-2"
                      >
                        {showPassword ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        {showPassword ? t("connections.form.hide") : t("connections.form.show")}
                      </Button>
                    </div>
                    <Input
                      id="profile-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      {...register("password")}
                      placeholder="••••••••"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="profile-password-env">{t("connections.form.passwordEnv")}</Label>
                    <Input
                      id="profile-password-env"
                      {...register("password_env", {
                        validate: (value) => {
                          const v = value?.trim();
                          if (!v) return true;
                          return (
                            (PASSWORD_ENV_PATTERN.test(v) && !PASSWORD_ENV_DENIED.test(v)) ||
                            t("connections.form.passwordEnvInvalid")
                          );
                        },
                      })}
                      placeholder="PROD_DB_PASSWORD"
                      className={cn("font-mono", errors.password_env && "border-destructive/50")}
                    />
                    {errors.password_env ? (
                      <p className="text-xs text-destructive">{errors.password_env.message}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t("connections.form.passwordEnvHelp")}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div>
                      <Label htmlFor="profile-default">{t("connections.form.isDefault")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {hasDefault
                          ? t("connections.form.isDefaultReplaces")
                          : t("connections.form.isDefaultHelp")}
                      </p>
                    </div>
                    <Switch
                      id="profile-default"
                      checked={watch("is_default")}
                      onCheckedChange={(v) => setValue("is_default", v)}
                    />
                  </div>

                  {errors.root && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {errors.root.message}
                    </p>
                  )}

                  <DialogFooter>
                    <Button type="button" variant="outline" size="sm" onClick={closeDialog}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSubmitting || createMutation.isPending}
                    >
                      {isSubmitting || createMutation.isPending ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {isSubmitting || createMutation.isPending
                        ? t("connections.form.creating")
                        : t("connections.form.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </IfWriter>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="font-mono text-xs text-muted-foreground">
            {t("connections.count", {
              total: formatNumber(allProfiles.length),
              defaults: formatNumber(allProfiles.filter((p) => p.is_default).length),
            })}
          </p>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(String(e.target.value))}
              placeholder={t("connections.searchPlaceholder")}
              aria-label={t("connections.searchPlaceholder")}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
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
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="space-y-1.5" aria-label={t("common.loading")}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="flex items-center justify-center gap-3 py-4 text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {t("common.loadFailed")}
                    <Button variant="outline" size="sm" className="h-7" onClick={() => refetch()}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t("common.retry")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : allProfiles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="py-6 text-center">
                    <p className="font-medium text-foreground">{t("connections.empty.title")}</p>
                    <p className="mb-2 mt-0.5 text-muted-foreground">
                      {t("connections.empty.hint")}
                    </p>
                    <IfWriter>
                      <Button size="sm" onClick={() => setDialogOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        {t("connections.empty.create")}
                      </Button>
                    </IfWriter>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredCount === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                  {t("connections.noMatch")}
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
        {!isLoading && !isError && allProfiles.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="font-mono">
                {t("connections.pagination.summary", {
                  page: currentPage + 1,
                  pages: Math.max(1, pageCount),
                  total: formatNumber(filteredCount),
                })}
              </span>
              <span className="flex items-center gap-1.5">
                {t("connections.pagination.perPage")}
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    const n = Number(v) as PageSize;
                    setPageSize(n);
                    table.setPageSize(n);
                  }}
                >
                  <SelectTrigger
                    className="h-7 w-16 font-mono text-xs"
                    aria-label={t("connections.pagination.perPage")}
                  >
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
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t("connections.pagination.previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                {t("connections.pagination.next")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
