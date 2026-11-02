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
import { endpoints, type RoleInfo, type RoleCreate } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
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
import { IfWriter } from "@/components/role-guard";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useI18n } from "@/lib/i18n";
import {
  AlertTriangle,
  Shield,
  Plus,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  Check,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";

type PageSize = 10 | 25 | 50;

const NO_ROLES: RoleInfo[] = [];
const CONNECTION_LIMITS = [1, 5, 10, 20, 50, 100];

/** The backend refuses to drop these, so the button should not offer it. */
function isProtectedRole(name: string): boolean {
  return name === "postgres" || name.toLowerCase().startsWith("pg_");
}

function AttrCell({ value }: { value: boolean }) {
  return value ? (
    <Check className="h-3.5 w-3.5 text-success" />
  ) : (
    <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />
  );
}

export default function RolesPage() {
  const { t, formatNumber } = useI18n();
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

  const { data: roles, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: qk.roles.all(),
    queryFn: () => endpoints.listRoles(),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    reset();
  };

  const createMutation = useMutation({
    mutationFn: (body: RoleCreate) => endpoints.createRole(body),
    onSuccess: () => {
      toast.success(t("roles.toast.created"));
      queryClient.invalidateQueries({ queryKey: qk.roles.all() });
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => endpoints.dropRole(name, { confirm: true, confirm_name: name }),
    onSuccess: () => {
      toast.success(t("roles.toast.deleted"));
      queryClient.invalidateQueries({ queryKey: qk.roles.all() });
    },
  });

  const onSubmitCreate = handleSubmit(async (data) => {
    const name = data.name.trim();
    const payload: RoleCreate = {
      name,
      login: data.login,
      password: data.password || null,
      superuser: data.superuser,
      createdb: data.createdb,
      createrole: data.createrole,
      connection_limit: data.connection_limit,
    };
    // Failures reach the user through the API client's toast with the backend message.
    try {
      const dryRun = await endpoints.createRole({ ...payload, dry_run: true });
      if ("sql" in dryRun && dryRun.sql) {
        const ok = await confirm({
          title: t("roles.confirmCreate.title", { name }),
          description: t("roles.confirmCreate.description"),
          risk_level: (dryRun.risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS",
          confirm_label: t("roles.form.create"),
          cancel_label: t("common.cancel"),
          sql_preview: dryRun.sql,
        });
        if (!ok) return;
      }
      await createMutation.mutateAsync({ ...payload, confirm: true });
    } catch {
      // Already reported; the dialog stays open so the input can be corrected.
    }
  });

  const handleDelete = async (role: RoleInfo) => {
    if (isProtectedRole(role.name)) return;
    const ok = await confirm({
      title: t("roles.confirmDelete.title", { name: role.name }),
      description: t("roles.confirmDelete.description"),
      risk_level: "DANGEROUS",
      confirm_label: t("common.delete"),
      cancel_label: t("common.cancel"),
      confirm_name_required: true,
      confirm_name_value: role.name,
      confirm_name_placeholder: t("roles.confirmDelete.placeholder", { name: role.name }),
      sql_preview: [`DROP ROLE "${role.name}";`],
    });
    if (ok) deleteMutation.mutate(role.name);
  };

  const columns: ColumnDef<RoleInfo>[] = [
    {
      accessorKey: "name",
      header: t("roles.columns.name"),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-2">
            <Link
              href={`/roles/${encodeURIComponent(r.name)}`}
              className="group inline-flex items-center gap-1 font-mono font-medium hover:text-info"
            >
              {r.name}
              <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
            {r.superuser && (
              <RiskBadge riskLevel="DANGEROUS" size="sm" showIcon={false}>
                SUPERUSER
              </RiskBadge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "superuser",
      header: "SUPERUSER",
      cell: ({ row }) => <AttrCell value={row.original.superuser} />,
    },
    {
      accessorKey: "createdb",
      header: "CREATEDB",
      cell: ({ row }) => <AttrCell value={row.original.createdb} />,
    },
    {
      accessorKey: "createrole",
      header: "CREATEROLE",
      cell: ({ row }) => <AttrCell value={row.original.createrole} />,
    },
    {
      accessorKey: "can_login",
      header: "LOGIN",
      cell: ({ row }) => <AttrCell value={row.original.can_login} />,
    },
    {
      accessorKey: "connection_limit",
      header: t("roles.columns.connectionLimit"),
      cell: ({ row }) => {
        const lim = row.original.connection_limit;
        return <span className="font-mono">{lim === -1 || lim === null ? "∞" : lim}</span>;
      },
    },
    {
      accessorKey: "valid_until",
      header: t("roles.columns.validUntil"),
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground">
          {row.original.valid_until ? row.original.valid_until.split(/[T ]/)[0] : "-"}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">{t("roles.columns.actions")}</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const locked = isProtectedRole(r.name);
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
              <Link href={`/roles/${encodeURIComponent(r.name)}`}>{t("roles.details")}</Link>
            </Button>
            <IfWriter>
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteMutation.isPending || locked}
                onClick={() => handleDelete(r)}
                title={locked ? t("roles.protected") : undefined}
                className={cn(
                  "h-7 px-2",
                  !locked && "text-destructive hover:bg-destructive/10 hover:text-destructive"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common.delete")}
              </Button>
            </IfWriter>
          </div>
        );
      },
    },
  ];

  const allRoles = roles ?? NO_ROLES;

  const table = useReactTable({
    data: allRoles,
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

  const superuserCount = allRoles.filter((r) => r.superuser).length;
  const tiles = [
    { label: t("roles.stats.total"), val: allRoles.length },
    { label: t("roles.stats.superuser"), val: superuserCount, warn: superuserCount > 3 },
    { label: t("roles.stats.canLogin"), val: allRoles.filter((r) => r.can_login).length },
    {
      label: t("roles.stats.elevated"),
      val: allRoles.filter((r) => r.createdb || r.createrole).length,
    },
  ];

  const attributes = [
    { key: "login", id: "attr-login", label: t("roles.form.login"), help: t("roles.form.loginHelp") },
    {
      key: "superuser",
      id: "attr-superuser",
      label: t("roles.form.superuser"),
      help: t("roles.form.superuserHelp"),
      warn: true,
    },
    {
      key: "createdb",
      id: "attr-createdb",
      label: t("roles.form.createdb"),
      help: t("roles.form.createdbHelp"),
    },
    {
      key: "createrole",
      id: "attr-createrole",
      label: t("roles.form.createrole"),
      help: t("roles.form.createroleHelp"),
    },
  ] as const;

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Shield className="h-4 w-4 text-muted-foreground" />
            {t("roles.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("roles.subtitle")}</p>
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
                  {t("roles.newRole")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("roles.form.title")}</DialogTitle>
                  <DialogDescription>{t("roles.form.description")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmitCreate} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="role-name">{t("roles.form.name")}</Label>
                    <Input
                      id="role-name"
                      {...register("name", {
                        validate: (v) => Boolean(v.trim()) || t("roles.form.required"),
                      })}
                      placeholder="app_user"
                      className={cn("font-mono", errors.name && "border-destructive/50")}
                    />
                    {errors.name && (
                      <p className="text-xs text-destructive">{errors.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="role-password">{t("roles.form.password")}</Label>
                    <Input
                      id="role-password"
                      type="password"
                      autoComplete="new-password"
                      {...register("password")}
                      placeholder={t("roles.form.passwordPlaceholder")}
                    />
                  </div>

                  <fieldset className="space-y-2 rounded-md border border-border px-3 py-2">
                    <legend className="px-1 text-xs font-medium">{t("roles.form.attributes")}</legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {attributes.map((attr) => (
                        <div key={attr.key} className="flex items-start gap-2">
                          <Checkbox
                            id={attr.id}
                            className="mt-0.5"
                            checked={watch(attr.key)}
                            onCheckedChange={(v) => setValue(attr.key, v === true)}
                          />
                          <div>
                            <label
                              htmlFor={attr.id}
                              className={cn(
                                "cursor-pointer text-xs font-medium",
                                "warn" in attr && "text-warning"
                              )}
                            >
                              {attr.label}
                            </label>
                            <p className="text-xs text-muted-foreground">{attr.help}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </fieldset>

                  <div className="space-y-1">
                    <Label>{t("roles.columns.connectionLimit")}</Label>
                    <Select
                      value={String(watch("connection_limit") ?? "-1")}
                      onValueChange={(v) => setValue("connection_limit", Number(v))}
                    >
                      <SelectTrigger aria-label={t("roles.columns.connectionLimit")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-1">{t("roles.form.unlimited")}</SelectItem>
                        {CONNECTION_LIMITS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {t("roles.form.connections", { count: n })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

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
                        ? t("roles.form.creating")
                        : t("roles.form.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </IfWriter>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map((m) => (
          <div
            key={m.label}
            className={cn(
              "rounded-md border border-border bg-card px-3 py-2",
              m.warn && "border-warning/40"
            )}
          >
            <p className="text-xs text-muted-foreground">{m.label}</p>
            {isLoading ? (
              <Skeleton className="mt-1 h-5 w-10" />
            ) : (
              <p className={cn("font-mono text-base font-semibold", m.warn && "text-warning")}>
                {isError ? "-" : formatNumber(m.val)}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="font-mono text-xs text-muted-foreground">
            {t("roles.count", { count: formatNumber(filteredCount) })}
          </p>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(String(e.target.value))}
              placeholder={t("roles.searchPlaceholder")}
              aria-label={t("roles.searchPlaceholder")}
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
                    {Array.from({ length: 6 }).map((_, i) => (
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
            ) : allRoles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="py-6 text-center">
                    <p className="font-medium text-foreground">{t("roles.empty.title")}</p>
                    <p className="mb-2 mt-0.5 text-muted-foreground">{t("roles.empty.hint")}</p>
                    <IfWriter>
                      <Button size="sm" onClick={() => setDialogOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        {t("roles.empty.create")}
                      </Button>
                    </IfWriter>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredCount === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                  {t("roles.noMatch")}
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
        {!isLoading && !isError && allRoles.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="font-mono">
                {t("roles.pagination.summary", {
                  page: currentPage + 1,
                  pages: Math.max(1, pageCount),
                  total: formatNumber(filteredCount),
                })}
              </span>
              <span className="flex items-center gap-1.5">
                {t("roles.pagination.perPage")}
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
                    aria-label={t("roles.pagination.perPage")}
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
                {t("roles.pagination.previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                {t("roles.pagination.next")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
