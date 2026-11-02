"use client";

import { useMemo, useRef, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  endpoints,
  type DryRunResult,
  type MutationRequest,
  type SettingChange,
  type SettingInfo,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useI18n, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { IfWriter } from "@/components/role-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PageSize = 10 | 25 | 50;

type EditState = {
  name: string;
  newValue: string;
} | null;

const CELL = "px-2 py-1.5 text-xs";
const HEAD = "h-8 px-2 text-xs";

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
  const t = useT();
  const { formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [globalFilter, setGlobalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [contextFilter, setContextFilter] = useState<string>("all");
  const [editState, setEditState] = useState<EditState>(null);
  // Enter can fire again while the dry run or confirm dialog is still open.
  const savingRef = useRef(false);

  const settingsQuery = useQuery({
    queryKey: qk.configops.all(),
    queryFn: () => endpoints.listSettings(),
  });
  const settings = settingsQuery.data;

  const categories = useMemo(() => {
    const values = new Set<string>();
    (settings ?? []).forEach((s) => s.category && values.add(s.category));
    return Array.from(values).sort();
  }, [settings]);

  const contexts = useMemo(() => {
    const values = new Set<string>();
    (settings ?? []).forEach((s) => s.context && values.add(s.context));
    return Array.from(values).sort();
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
      const needle = globalFilter.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          (s.setting ?? "").toLowerCase().includes(needle) ||
          (s.category ?? "").toLowerCase().includes(needle) ||
          (s.unit ?? "").toLowerCase().includes(needle)
      );
    }
    return list;
  }, [settings, categoryFilter, contextFilter, globalFilter]);

  const all = settings ?? [];
  const pendingRestartCount = all.filter((s) => s.pending_restart).length;
  const superuserContextCount = all.filter(
    (s) => s.context === "superuser" || s.context === "superuser_backend"
  ).length;
  const sighupContextCount = all.filter((s) => s.context === "sighup").length;
  const postmasterContextCount = all.filter((s) => s.context === "postmaster").length;

  const changeSettingMutation = useMutation({
    mutationFn: (payload: { name: string; body: SettingChange }) =>
      endpoints.changeSetting(payload.name, payload.body),
    onSuccess: () => {
      toast.success(t("config.toast.updated"));
      queryClient.invalidateQueries({ queryKey: qk.configops.all() });
    },
    onError: () => {
      toast.error(t("config.toast.updateFailed"));
    },
  });

  const reloadConfigMutation = useMutation({
    mutationFn: (body: MutationRequest) => endpoints.reloadConfig(body),
    onSuccess: (result) => {
      const reloaded = (result as { reloaded?: boolean } | null)?.reloaded;
      toast.success(t(reloaded ? "config.toast.reloaded" : "config.toast.reloadCalled"));
      queryClient.invalidateQueries({ queryKey: qk.configops.all() });
    },
    onError: () => {
      toast.error(t("config.toast.reloadFailed"));
    },
  });

  const handleEditStart = (setting: SettingInfo) => {
    setEditState({ name: setting.name, newValue: setting.setting ?? "" });
  };

  const handleEditCancel = () => {
    setEditState(null);
  };

  const handleEditSave = async (setting: SettingInfo) => {
    if (!editState || savingRef.current) return;
    const newValue = editState.newValue.trim();
    if (newValue === setting.setting) {
      setEditState(null);
      toast.info(t("config.toast.noChange"));
      return;
    }

    savingRef.current = true;
    try {
      const dryRun = (await endpoints.changeSetting(setting.name, {
        value: newValue,
        dry_run: true,
      })) as DryRunResult;

      // The dry run masks the value, but the user is approving this exact change.
      const quoted = `'${newValue.replace(/'/g, "''")}'`;
      const sql = (dryRun?.sql ?? [`ALTER SYSTEM SET ${setting.name} = '<value>'`]).map((line) =>
        line.replace("'<value>'", () => quoted)
      );
      const context = setting.context ?? "-";

      const ok = await confirm({
        title: t("config.confirm.changeTitle", { name: setting.name }),
        description: t(
          setting.context === "postmaster"
            ? "config.confirm.changePostmaster"
            : setting.context === "sighup"
              ? "config.confirm.changeSighup"
              : "config.confirm.changeOther",
          { context }
        ),
        risk_level: dryRun?.risk === "MAINTENANCE" ? "MAINTENANCE" : "DANGEROUS",
        sql_preview: sql,
        confirm_label: t("config.confirm.changeAction"),
        cancel_label: t("common.cancel"),
      });
      if (!ok) return;

      await changeSettingMutation.mutateAsync({
        name: setting.name,
        body: { value: newValue, confirm: true },
      });
      setEditState(null);
    } catch {
      // Already reported by the API client and the mutation; keep the edit open.
    } finally {
      savingRef.current = false;
    }
  };

  const handleReloadConfig = async () => {
    const ok = await confirm({
      title: t("config.confirm.reloadTitle"),
      description: t("config.confirm.reload"),
      risk_level: "MAINTENANCE",
      confirm_label: t("config.confirm.reloadAction"),
      cancel_label: t("common.cancel"),
      sql_preview: ["SELECT pg_reload_conf();"],
    });
    if (ok) reloadConfigMutation.mutate({ confirm: true });
  };

  const handleRefresh = async () => {
    const result = await settingsQuery.refetch();
    if (!result.isError) toast.success(t("config.toast.refreshed"));
  };

  const columns: ColumnDef<SettingInfo>[] = [
    {
      accessorKey: "name",
      header: t("config.columns.name"),
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="min-w-0">
            <p className="truncate font-mono font-semibold">{s.name}</p>
            {s.category && <p className="truncate text-muted-foreground">{s.category}</p>}
          </div>
        );
      },
    },
    {
      accessorKey: "setting",
      header: t("config.columns.value"),
      cell: ({ row }) => {
        const s = row.original;
        if (editState?.name === s.name) {
          return (
            <div className="flex items-center gap-1">
              <Input
                value={editState.newValue}
                onChange={(e) => setEditState({ ...editState, newValue: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEditSave(s);
                  if (e.key === "Escape") handleEditCancel();
                }}
                aria-label={t("config.columns.value")}
                className="h-7 font-mono text-xs"
                autoFocus
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("common.save")}
                onClick={() => handleEditSave(s)}
                disabled={changeSettingMutation.isPending}
                className="h-7 w-7 shrink-0 border-success/40 text-success hover:bg-success/10"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("common.cancel")}
                onClick={handleEditCancel}
                className="h-7 w-7 shrink-0 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }
        return (
          <code className="block max-w-[260px] truncate font-mono" title={s.setting ?? undefined}>
            {s.setting || "-"}
          </code>
        );
      },
    },
    {
      accessorKey: "unit",
      header: t("config.columns.unit"),
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground">{row.original.unit ?? "-"}</span>
      ),
    },
    {
      accessorKey: "context",
      header: t("config.columns.context"),
      cell: ({ row }) => {
        const context = row.original.context ?? "-";
        return (
          <RiskBadge riskLevel={CONTEXT_RISK[context] ?? "INFO"} size="sm">
            <span className="font-mono">{context}</span>
          </RiskBadge>
        );
      },
    },
    {
      accessorKey: "pending_restart",
      header: t("config.columns.status"),
      cell: ({ row }) =>
        row.original.pending_restart ? (
          <RiskBadge riskLevel="DANGEROUS" size="sm">
            {t("config.status.restartRequired")}
          </RiskBadge>
        ) : (
          <RiskBadge riskLevel="OK" size="sm">
            {t("config.status.applied")}
          </RiskBadge>
        ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">{t("config.columns.actions")}</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        if (editState?.name === s.name) return null;
        const readOnly = s.context === "internal";
        return (
          <div className="flex items-center justify-end">
            <IfWriter>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleEditStart(s)}
                disabled={changeSettingMutation.isPending || readOnly}
                title={readOnly ? t("config.internalHint") : undefined}
              >
                <Pencil className="mr-1 h-3 w-3" />
                {t("config.edit")}
              </Button>
            </IfWriter>
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
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize } },
  });

  const currentPage = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();

  const tiles = [
    {
      label: t("config.stats.total"),
      value: all.length,
      icon: Settings2,
      tone: "text-foreground",
    },
    {
      label: t("config.stats.sighup"),
      value: sighupContextCount,
      icon: RotateCcw,
      tone: "text-foreground",
    },
    {
      label: t("config.stats.superuser"),
      value: superuserContextCount,
      icon: Power,
      tone: "text-foreground",
    },
    {
      label: t("config.stats.postmaster"),
      value: postmasterContextCount,
      icon: Server,
      tone: "text-foreground",
    },
    {
      label: t("config.stats.pendingRestart"),
      value: pendingRestartCount,
      icon: AlertCircle,
      tone: pendingRestartCount > 0 ? "text-destructive" : "text-success",
    },
  ];

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Settings2 className="h-4 w-4 text-info" />
            {t("config.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("config.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleRefresh}>
            <RefreshCw
              className={cn("mr-1.5 h-3.5 w-3.5", settingsQuery.isFetching && "animate-spin")}
            />
            {t("common.refresh")}
          </Button>
          <IfWriter>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleReloadConfig}
              disabled={reloadConfigMutation.isPending}
            >
              {reloadConfigMutation.isPending ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t(reloadConfigMutation.isPending ? "config.reloading" : "config.reload")}
            </Button>
          </IfWriter>
        </div>
      </div>

      {!settingsQuery.isError && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {settingsQuery.isLoading
            ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[54px] w-full rounded-md" />)
            : tiles.map((tile) => (
                <StatTile
                  key={tile.label}
                  label={tile.label}
                  value={formatNumber(tile.value)}
                  icon={tile.icon}
                  tone={tile.tone}
                />
              ))}
        </div>
      )}

      {pendingRestartCount > 0 && (
        <p
          className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="status"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {t("config.pendingRestartNotice", { count: pendingRestartCount })}
        </p>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t("config.list.title")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("config.list.subtitle", {
                shown: filteredSettings.length,
                total: all.length,
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full md:w-56">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value);
                  table.setPageIndex(0);
                }}
                placeholder={t("config.list.searchPlaceholder")}
                aria-label={t("common.search")}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select
              value={categoryFilter}
              onValueChange={(value) => {
                setCategoryFilter(value);
                table.setPageIndex(0);
              }}
            >
              <SelectTrigger
                className="h-8 w-full text-xs md:w-48"
                aria-label={t("config.list.category")}
              >
                <SelectValue placeholder={t("config.list.category")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("config.list.allCategories")}</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={contextFilter}
              onValueChange={(value) => {
                setContextFilter(value);
                table.setPageIndex(0);
              }}
            >
              <SelectTrigger
                className="h-8 w-full text-xs md:w-40"
                aria-label={t("config.columns.context")}
              >
                <SelectValue placeholder={t("config.columns.context")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("config.list.allContexts")}</SelectItem>
                {contexts.map((context) => (
                  <SelectItem key={context} value={context}>
                    {context}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {settingsQuery.isError ? (
          <div className="flex items-center justify-between gap-2 px-3 py-3" role="alert">
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t("common.loadFailed")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => settingsQuery.refetch()}
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              {t("common.retry")}
            </Button>
          </div>
        ) : settingsQuery.isLoading ? (
          <div className="space-y-1.5 p-3" aria-label={t("common.loading")}>
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : undefined
                          }
                          className={cn(HEAD, header.column.getCanSort() && "cursor-pointer select-none")}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="inline-flex items-center gap-1">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
                            {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="px-3 py-6 text-center">
                      <p className="text-sm font-medium">{t("config.list.emptyTitle")}</p>
                      <p className="text-xs text-muted-foreground">{t("config.list.emptyHint")}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        row.original.pending_restart &&
                          "bg-destructive/5 shadow-[inset_3px_0_0_0_hsl(var(--destructive))] hover:bg-destructive/10"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={CELL}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {!settingsQuery.isLoading && !settingsQuery.isError && filteredSettings.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                {t("config.pagination.summary", {
                  page: currentPage + 1,
                  pages: Math.max(1, pageCount),
                  total: filteredSettings.length,
                })}
              </span>
              <span className="flex items-center gap-1.5">
                {t("config.pagination.pageSize")}
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    const next = Number(value) as PageSize;
                    setPageSize(next);
                    table.setPageSize(next);
                  }}
                >
                  <SelectTrigger
                    className="h-7 w-[68px] font-mono text-xs"
                    aria-label={t("config.pagination.pageSize")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-7 px-2 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t("config.pagination.previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-7 px-2 text-xs"
              >
                {t("config.pagination.next")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("font-mono text-base font-semibold", tone)}>{value}</div>
    </div>
  );
}
