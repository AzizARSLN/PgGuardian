"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Hash,
  HardDrive,
  ListOrdered,
  Lock,
  RefreshCw,
  Search,
  Skull,
  StopCircle,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/types";
import type {
  BackendActionResult,
  ConnectionInfo,
  DiagnosticFinding,
  DryRunResult,
  IndexInfo,
  LockInfo,
  PgStatStatementsRow,
  QueryInfo,
  TableMaintenance,
  TableSize,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IfWriter } from "@/components/role-guard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm, type ConfirmOptions } from "@/lib/hooks/useConfirm";
import {
  QueryInsightDialog,
  type QueryInsightTarget,
} from "@/components/query-insight/query-insight-dialog";
import { SequencesPanel } from "@/components/diagnostics/sequences-panel";
import { formatBytes } from "@/lib/utils";
import { useI18n, useT, type TFunction } from "@/lib/i18n";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";

type PageSize = 10 | 25 | 50;

const LONG_RUNNING_SECONDS = 300;
// Default row count pulled per diagnostics list tab.
const LIST_LIMIT = 5000;
const METRIC = "font-mono tabular-nums";
const PRE = "font-mono text-[11px] text-muted-foreground whitespace-pre-wrap overflow-hidden";

const TABS = [
  { id: "findings", labelKey: "diagnostics.tabs.findings", icon: AlertTriangle },
  { id: "connections", labelKey: "diagnostics.tabs.connections", icon: Users },
  { id: "active", labelKey: "diagnostics.tabs.active", icon: Zap },
  { id: "long", labelKey: "diagnostics.tabs.long", icon: Clock },
  { id: "locks", labelKey: "diagnostics.tabs.locks", icon: Lock },
  { id: "storage", labelKey: "diagnostics.tabs.storage", icon: HardDrive },
  { id: "indexes", labelKey: "diagnostics.tabs.indexes", icon: Database },
  { id: "maintenance", labelKey: "diagnostics.tabs.maintenance", icon: Wrench },
  { id: "pgss", labelKey: "diagnostics.tabs.pgss", icon: ListOrdered },
  { id: "sequences", labelKey: "diagnostics.tabs.sequences", icon: Hash },
] as const;

type TabId = (typeof TABS)[number]["id"];

function formatSeconds(seconds: number, t: TFunction): string {
  if (!Number.isFinite(seconds) || seconds < 1) return t("diagnostics.units.second", { n: "<1" });
  const s = Math.floor(seconds);
  const values = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
  const labels = [
    t("diagnostics.units.day", { n: values[0] }),
    t("diagnostics.units.hour", { n: values[1] }),
    t("diagnostics.units.minute", { n: values[2] }),
    t("diagnostics.units.second", { n: values[3] }),
  ];
  const first = values.findIndex((v) => v > 0);
  return labels.slice(first, first + 2).join(" ");
}

/** pg_stat_statements reports times in milliseconds. */
function formatMs(
  ms: number,
  t: TFunction,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1) return t("diagnostics.units.ms", { n: "<1" });
  if (ms < 1000) return t("diagnostics.units.ms", { n: formatNumber(ms, { maximumFractionDigits: 0 }) });
  if (ms < 60000) {
    return t("diagnostics.units.second", {
      n: formatNumber(ms / 1000, { maximumFractionDigits: 1 }),
    });
  }
  return formatSeconds(ms / 1000, t);
}

function severityToRisk(sev: string): "OK" | "WARNING" | "DANGEROUS" | "INFO" {
  switch (sev) {
    case "CRITICAL":
      return "DANGEROUS";
    case "WARNING":
      return "WARNING";
    case "OK":
      return "OK";
    default:
      return "INFO";
  }
}

function latestDate(...dates: (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  for (const d of dates) {
    if (d && !Number.isNaN(new Date(d).getTime())) {
      if (!latest || new Date(d) > new Date(latest)) latest = d;
    }
  }
  return latest;
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  emptyTitle: string;
  emptyDesc: string;
  searchPlaceholder: string;
}

function DataTable<TData>({
  columns,
  data,
  isLoading,
  isError,
  error,
  onRetry,
  emptyTitle,
  emptyDesc,
  searchPlaceholder,
}: DataTableProps<TData>) {
  const t = useT();
  const { formatNumber } = useI18n();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // A column whose first row is null must stay searchable.
    getColumnCanGlobalFilter: () => true,
    // Polling replaces the data; the reader must stay on their page.
    autoResetPageIndex: false,
    state: { sorting, columnFilters, globalFilter },
    initialState: { pagination: { pageSize: 25 } },
  });

  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const filteredCount = table.getFilteredRowModel().rows.length;

  useEffect(() => {
    if (pageIndex > 0 && pageIndex >= pageCount) table.setPageIndex(Math.max(0, pageCount - 1));
  }, [pageIndex, pageCount, table]);

  if (isError) {
    const message = error instanceof Error ? error.message : "";
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        <span className="font-medium text-foreground">{t("common.loadFailed")}</span>
        {message && <span className="min-w-0 truncate text-muted-foreground">{message}</span>}
        <Button variant="outline" size="sm" onClick={onRetry} className="h-6 px-2 text-xs">
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            table.setPageIndex(0);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const label = h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <TableHead
                      key={h.id}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                      className="h-8 whitespace-nowrap px-2 py-1.5 text-xs font-semibold"
                    >
                      {h.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {label}
                          {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
                          {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-2">
                  <div className="space-y-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-3 py-2">
                  <p className="font-medium text-foreground">{emptyTitle}</p>
                  <p className="text-muted-foreground">{emptyDesc}</p>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-2 py-1.5 text-xs">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className={METRIC}>
            {t("diagnostics.table.pageInfo", {
              page: pageIndex + 1,
              pages: Math.max(1, pageCount),
              total: formatNumber(filteredCount),
            })}
          </span>
          <span>{t("diagnostics.table.perPage")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => table.setPageSize(Number(v) as PageSize)}
          >
            <SelectTrigger
              className="h-7 w-[64px] rounded-md text-xs"
              aria-label={t("diagnostics.table.perPage")}
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
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-7 px-2 text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("diagnostics.table.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-7 px-2 text-xs"
          >
            {t("diagnostics.table.next")}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const TONES = {
  success: "text-success",
  muted: "text-muted-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
} as const;

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`${METRIC} text-base font-semibold ${TONES[tone]}`}>{value}</p>
    </div>
  );
}

function Notice({
  icon,
  title,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`mb-2 flex items-start gap-2 rounded-md border px-3 py-2 ${className ?? "border-border bg-card"}`}>
      {icon}
      <div className="text-xs">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function PercentBar({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-muted">
      <div className={`h-full ${className}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function isActionResult(data: DryRunResult | BackendActionResult): data is BackendActionResult {
  return "signal_sent" in data;
}

const CONN_BATCH_PREVIEW_LIMIT = 10;
const LONG_ACTION_TIMEOUT_MS = 30 * 60 * 1000;

type ConnGroupKey = "user" | "client_address" | "state" | "application_name";
type ConnGroupAction = "cancel" | "terminate";

const CONN_GROUP_OPTIONS: { id: ConnGroupKey; labelKey: string }[] = [
  { id: "user", labelKey: "diagnostics.columns.user" },
  { id: "client_address", labelKey: "diagnostics.columns.client" },
  { id: "state", labelKey: "diagnostics.columns.state" },
  { id: "application_name", labelKey: "diagnostics.columns.application" },
];

const CONN_GROUP_FIELD: Record<ConnGroupKey, keyof ConnectionInfo> = {
  user: "user",
  client_address: "client_address",
  state: "state",
  application_name: "application_name",
};

interface ConnGroup {
  key: string;
  items: ConnectionInfo[];
}

interface ConnBatchState {
  key: string;
  action: ConnGroupAction;
  total: number;
  done: number;
  ok: number;
  failed: number;
}

/** Connections bucketed by a dimension, each with a count and bulk actions. */
function ConnectionGroups({
  groups,
  label,
  busy,
  batch,
  onGroupAction,
  onCancelPid,
  onTerminatePid,
}: {
  groups: ConnGroup[];
  label: string;
  busy: boolean;
  batch: ConnBatchState | null;
  onGroupAction: (action: ConnGroupAction, group: ConnGroup) => void;
  onCancelPid: (pid: number) => void;
  onTerminatePid: (pid: number) => void;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 px-2 py-1.5 text-xs font-semibold">{label}</TableHead>
            <TableHead className="h-8 w-[72px] px-2 py-1.5 text-right text-xs font-semibold">
              {t("diagnostics.connections.groupCount")}
            </TableHead>
            <TableHead className="h-8 px-2 py-1.5 text-xs font-semibold">
              {t("diagnostics.connections.groupBreakdown")}
            </TableHead>
            <TableHead className="h-8 px-2 py-1.5 text-right text-xs font-semibold">
              <IfWriter>{t("diagnostics.columns.actions")}</IfWriter>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const open = expanded === group.key;
            const running = batch?.key === group.key;
            const activeCount = group.items.filter((c) => c.state === "active").length;
            const txCount = group.items.filter((c) => c.state === "idle in transaction").length;
            const waitCount = group.items.filter((c) => c.wait_event_type).length;
            return (
              <Fragment key={group.key}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setExpanded(open ? null : group.key)}
                >
                  <TableCell className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                          open ? "rotate-90" : ""
                        }`}
                      />
                      <span className="truncate font-mono">{group.key}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-right">
                    <span className={`${METRIC} font-semibold`}>
                      {formatNumber(group.items.length)}
                    </span>
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {activeCount > 0 && (
                        <RiskBadge riskLevel="OK" size="sm" showIcon={false}>
                          {t("diagnostics.connections.active")} {activeCount}
                        </RiskBadge>
                      )}
                      {txCount > 0 && (
                        <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                          {t("diagnostics.connections.idleInTx")} {txCount}
                        </RiskBadge>
                      )}
                      {waitCount > 0 && (
                        <RiskBadge riskLevel="DANGEROUS" size="sm" showIcon={false}>
                          {t("diagnostics.connections.waiting")} {waitCount}
                        </RiskBadge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    <IfWriter>
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {running && (
                          <span className={`${METRIC} text-[11px] text-muted-foreground`}>
                            {t("diagnostics.connections.batchProgress", {
                              done: batch.done,
                              total: batch.total,
                            })}
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => onGroupAction("cancel", group)}
                          className="h-6 px-1.5 text-[11px]"
                        >
                          <StopCircle className="h-3 w-3" />
                          {t("diagnostics.connections.groupCancelAll")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => onGroupAction("terminate", group)}
                          className="h-6 border-destructive/30 px-1.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Skull className="h-3 w-3" />
                          {t("diagnostics.connections.groupTerminateAll")}
                        </Button>
                      </div>
                    </IfWriter>
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="bg-muted/30 px-2 py-2">
                      <Table className="text-[11px]">
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="h-7 px-2 py-1 font-semibold">PID</TableHead>
                            <TableHead className="h-7 px-2 py-1 font-semibold">
                              {t("diagnostics.columns.client")}
                            </TableHead>
                            <TableHead className="h-7 px-2 py-1 font-semibold">
                              {t("diagnostics.columns.state")}
                            </TableHead>
                            <TableHead className="h-7 px-2 py-1 font-semibold">
                              {t("diagnostics.columns.duration")}
                            </TableHead>
                            <TableHead className="h-7 px-2 py-1 text-right font-semibold">
                              <IfWriter>{t("diagnostics.columns.actions")}</IfWriter>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.items.map((conn) => (
                            <TableRow key={conn.pid}>
                              <TableCell className="px-2 py-1">
                                <span className={`${METRIC} text-info`}>{conn.pid}</span>
                              </TableCell>
                              <TableCell className="px-2 py-1">
                                <span className="font-mono text-muted-foreground">
                                  {conn.client_address ?? "-"}
                                </span>
                              </TableCell>
                              <TableCell className="px-2 py-1">
                                {conn.state ?? "unknown"}
                              </TableCell>
                              <TableCell className={`${METRIC} px-2 py-1`}>
                                {typeof conn.query_duration_seconds === "number"
                                  ? formatSeconds(conn.query_duration_seconds, t)
                                  : "-"}
                              </TableCell>
                              <TableCell className="px-2 py-1">
                                <IfWriter>
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => onCancelPid(conn.pid)}
                                      className="h-6 px-1.5 text-[11px]"
                                    >
                                      <StopCircle className="h-3 w-3" />
                                      {t("diagnostics.actions.cancel")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => onTerminatePid(conn.pid)}
                                      className="h-6 border-destructive/30 px-1.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    >
                                      <Skull className="h-3 w-3" />
                                      {t("diagnostics.actions.terminate")}
                                    </Button>
                                  </div>
                                </IfWriter>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DiagnosticsPage() {
  const t = useT();
  const { formatNumber, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);

  const [activeTab, setActiveTab] = useState<TabId>("findings");
  const [connGroupBy, setConnGroupBy] = useState<ConnGroupKey | "none">("none");
  const [connBatch, setConnBatch] = useState<ConnBatchState | null>(null);
  const [insightTarget, setInsightTarget] = useState<QueryInsightTarget | null>(null);

  // Shared cost/advice panel: any pid row can open the same dialog.
  const openInsight = useCallback((row: QueryInfo) => {
    if (!row.query) return;
    setInsightTarget({ ...row, query: row.query });
  }, []);

  // Only the visible tab polls, so the heavier catalog reports are not hit in the background.
  const poll = (tab: TabId) => (autoRefresh && activeTab === tab ? pollInterval : false);

  const findingsQ = useQuery({
    queryKey: qk.diagnostics.diagnose(),
    queryFn: () => endpoints.getDiagnose(),
    refetchInterval: poll("findings"),
  });
  const connQ = useQuery({
    queryKey: qk.diagnostics.connections(LIST_LIMIT),
    queryFn: () => endpoints.getConnections(LIST_LIMIT),
    refetchInterval: poll("connections"),
  });
  const aqQ = useQuery({
    queryKey: qk.diagnostics.queries.active(LIST_LIMIT),
    queryFn: () => endpoints.getActiveQueries(LIST_LIMIT),
    refetchInterval: poll("active"),
  });
  const lrQ = useQuery({
    queryKey: qk.diagnostics.queries.longRunning(LONG_RUNNING_SECONDS, LIST_LIMIT),
    queryFn: () => endpoints.getLongRunningQueries(LONG_RUNNING_SECONDS, LIST_LIMIT),
    refetchInterval: poll("long"),
  });
  const locksQ = useQuery({
    queryKey: qk.diagnostics.locks(LIST_LIMIT),
    queryFn: () => endpoints.getLocks(LIST_LIMIT),
    refetchInterval: poll("locks"),
  });
  const storageQ = useQuery({
    queryKey: qk.diagnostics.storage("tables", LIST_LIMIT),
    queryFn: () => endpoints.getStorage("tables", LIST_LIMIT),
    refetchInterval: poll("storage"),
  });
  const idxQ = useQuery({
    queryKey: qk.diagnostics.indexes(LIST_LIMIT),
    queryFn: () => endpoints.getIndexes(LIST_LIMIT),
    refetchInterval: poll("indexes"),
  });
  const maintQ = useQuery({
    queryKey: qk.diagnostics.maintenance(LIST_LIMIT),
    queryFn: () => endpoints.getMaintenance(LIST_LIMIT),
    refetchInterval: poll("maintenance"),
  });
  const pgssQ = useQuery({
    queryKey: qk.diagnostics.pgStatStatements(LIST_LIMIT),
    queryFn: () => endpoints.getPgStatStatements(LIST_LIMIT),
    refetchInterval: poll("pgss"),
  });

  const notifyResult = (data: DryRunResult | BackendActionResult, pid: number, sentKey: string) => {
    queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() });
    if (isActionResult(data) && !data.signal_sent) {
      toast.warning(t("diagnostics.toast.notSent", { pid }));
    } else {
      toast.success(t(sentKey), { description: `PID ${pid}` });
    }
  };

  // Failures are toasted by the API client.
  const { mutate: cancelBackend, isPending: cancelling } = useMutation({
    mutationFn: (pid: number) => endpoints.cancelBackend(pid, { confirm: true }),
    onSuccess: (data, pid) => notifyResult(data, pid, "diagnostics.toast.cancelled"),
  });
  const { mutate: terminateBackend, isPending: terminating } = useMutation({
    mutationFn: (pid: number) =>
      endpoints.terminateBackend(pid, { confirm: true, confirm_name: String(pid) }),
    onSuccess: (data, pid) => notifyResult(data, pid, "diagnostics.toast.terminated"),
  });

  const storageData = useMemo(
    () =>
      [...(storageQ.data?.tables ?? [])].sort(
        (a, b) => (b.total_size_bytes ?? 0) - (a.total_size_bytes ?? 0)
      ),
    [storageQ.data]
  );
  const idxData = useMemo(() => idxQ.data?.indexes ?? [], [idxQ.data]);
  const lrData = useMemo(() => lrQ.data?.queries ?? [], [lrQ.data]);
  const aqData = useMemo(() => aqQ.data?.queries ?? [], [aqQ.data]);
  const connData = useMemo(() => connQ.data?.connections ?? [], [connQ.data]);
  const connGroups = useMemo<ConnGroup[]>(() => {
    if (connGroupBy === "none") return [];
    const field = CONN_GROUP_FIELD[connGroupBy];
    const buckets = new Map<string, ConnectionInfo[]>();
    for (const conn of connData) {
      const raw = conn[field];
      const key =
        raw === null || raw === undefined || raw === ""
          ? t("diagnostics.connections.groupUnset")
          : String(raw);
      const list = buckets.get(key);
      if (list) list.push(conn);
      else buckets.set(key, [conn]);
    }
    return [...buckets.entries()]
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
  }, [connData, connGroupBy, t]);
  const connGroupLabel =
    connGroupBy === "none"
      ? ""
      : t(CONN_GROUP_OPTIONS.find((o) => o.id === connGroupBy)?.labelKey ?? "");
  const locksData = useMemo(() => locksQ.data?.locks ?? [], [locksQ.data]);
  const maintData = useMemo(() => maintQ.data?.tables ?? [], [maintQ.data]);
  const pgssData = useMemo(() => pgssQ.data ?? [], [pgssQ.data]);
  const findingsData = useMemo(() => findingsQ.data ?? [], [findingsQ.data]);

  const percent = useMemo(
    () => (value: number, digits = 1) =>
      t("diagnostics.percent", {
        value: formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
      }),
    [t, formatNumber]
  );

  const findingsCols = useMemo<ColumnDef<DiagnosticFinding>[]>(
    () => [
      {
        accessorKey: "severity",
        header: () => t("diagnostics.findings.severity"),
        cell: ({ row }) => (
          <RiskBadge riskLevel={severityToRisk(row.original.severity)} size="sm" showIcon={false}>
            {row.original.severity}
          </RiskBadge>
        ),
      },
      {
        accessorKey: "code",
        header: () => t("diagnostics.findings.code"),
        cell: ({ row }) => (
          <code className="font-mono text-[11px] text-muted-foreground">{row.original.code}</code>
        ),
      },
      {
        accessorKey: "title",
        header: () => t("diagnostics.findings.heading"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium text-foreground">{row.original.title}</p>
            <p className="line-clamp-1 text-[11px] text-muted-foreground">{row.original.description}</p>
          </div>
        ),
      },
      {
        accessorKey: "value",
        header: () => t("diagnostics.findings.value"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-muted-foreground`}>{row.original.value ?? "-"}</span>
        ),
      },
      {
        accessorKey: "recommendation",
        header: () => t("diagnostics.findings.recommendation"),
        cell: ({ row }) =>
          row.original.recommendation ? (
            <p className="flex max-w-md items-start gap-1 text-[11px] text-success">
              <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{row.original.recommendation}</span>
            </p>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
    ],
    [t]
  );

  const handleCancel = useCallback(
    async (pid: number) => {
      const ok = await confirm({
        title: t("diagnostics.confirm.cancelTitle", { pid }),
        description: t("diagnostics.confirm.cancelDesc"),
        risk_level: "MAINTENANCE",
        confirm_label: t("diagnostics.actions.cancel"),
        cancel_label: t("common.cancel"),
        sql_preview: [`SELECT pg_cancel_backend(${pid});`],
      });
      if (ok) cancelBackend(pid);
    },
    [confirm, t, cancelBackend]
  );

  const handleTerminate = useCallback(
    async (pid: number) => {
      const ok = await confirm({
        title: t("diagnostics.confirm.terminateTitle", { pid }),
        description: t("diagnostics.confirm.terminateDesc"),
        risk_level: "DANGEROUS",
        confirm_label: t("diagnostics.actions.terminate"),
        cancel_label: t("common.cancel"),
        confirm_name_required: true,
        confirm_name_value: String(pid),
        confirm_name_placeholder: t("diagnostics.confirm.typePid", { pid }),
        sql_preview: [`SELECT pg_terminate_backend(${pid});`],
      });
      if (ok) terminateBackend(pid);
    },
    [confirm, t, terminateBackend]
  );

  const handleGroupAction = useCallback(
    async (action: ConnGroupAction, group: ConnGroup) => {
      const count = group.items.length;
      const isTerminate = action === "terminate";
      const fn = isTerminate ? "pg_terminate_backend" : "pg_cancel_backend";
      const sqlPreview = group.items
        .slice(0, CONN_BATCH_PREVIEW_LIMIT)
        .map((c) => `SELECT ${fn}(${c.pid});`);
      if (count > CONN_BATCH_PREVIEW_LIMIT) {
        sqlPreview.push(`-- … +${count - CONN_BATCH_PREVIEW_LIMIT}`);
      }
      const ok = await confirm({
        title: t(
          isTerminate
            ? "diagnostics.connections.batchTerminateTitle"
            : "diagnostics.connections.batchCancelTitle",
          { group: group.key, count }
        ),
        description: t(
          isTerminate
            ? "diagnostics.connections.batchTerminateDesc"
            : "diagnostics.connections.batchCancelDesc",
          { count }
        ),
        risk_level: isTerminate ? "DANGEROUS" : "MAINTENANCE",
        confirm_label: t(
          isTerminate
            ? "diagnostics.connections.groupTerminateAll"
            : "diagnostics.connections.groupCancelAll"
        ),
        cancel_label: t("common.cancel"),
        confirm_name_required: isTerminate,
        confirm_name_value: String(count),
        confirm_name_placeholder: t("diagnostics.connections.typeCount", { count }),
        sql_preview: sqlPreview,
      });
      if (!ok) return;

      const targets = group.items.map((c) => c.pid);
      setConnBatch({
        key: group.key,
        action,
        total: targets.length,
        done: 0,
        ok: 0,
        failed: 0,
      });
      let okCount = 0;
      let failedCount = 0;
      for (const pid of targets) {
        try {
          const data = await api.post<DryRunResult | BackendActionResult>(
            `/queries/${pid}/${isTerminate ? "terminate" : "cancel"}`,
            isTerminate ? { confirm: true, confirm_name: String(pid) } : { confirm: true },
            { skipToast: true, timeout: LONG_ACTION_TIMEOUT_MS }
          );
          if (isActionResult(data) && !data.signal_sent) failedCount += 1;
          else okCount += 1;
        } catch {
          failedCount += 1;
        }
        setConnBatch((prev) =>
          prev && prev.key === group.key
            ? { ...prev, done: prev.done + 1, ok: okCount, failed: failedCount }
            : prev
        );
      }
      setConnBatch(null);
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() });
      const summary = t("diagnostics.connections.batchSummary", {
        ok: okCount,
        failed: failedCount,
      });
      if (failedCount > 0) toast.warning(summary, { description: group.key });
      else toast.success(summary, { description: group.key });
    },
    [confirm, t, queryClient]
  );

  const connCols = useMemo<ColumnDef<ConnectionInfo>[]>(() => {
    return [
      {
        accessorKey: "pid",
        header: () => "PID",
        cell: ({ row }) => (
          <code className={`${METRIC} font-semibold text-info`}>{row.original.pid}</code>
        ),
      },
      {
        accessorKey: "user",
        header: () => t("diagnostics.columns.user"),
        cell: ({ row }) => <span className="font-mono">{row.original.user ?? "-"}</span>,
      },
      {
        accessorKey: "database",
        header: () => t("diagnostics.columns.database"),
        cell: ({ row }) => <span className="font-mono">{row.original.database ?? "-"}</span>,
      },
      {
        accessorKey: "client_address",
        header: () => t("diagnostics.columns.client"),
        cell: ({ row }) => (
          <code className="font-mono text-muted-foreground">{row.original.client_address ?? "-"}</code>
        ),
      },
      {
        accessorKey: "state",
        header: () => t("diagnostics.columns.state"),
        cell: ({ row }) => {
          const state = row.original.state ?? "unknown";
          const risk: "OK" | "WARNING" | "INFO" =
            state === "active" ? "OK" : state === "idle in transaction" ? "WARNING" : "INFO";
          return (
            <RiskBadge riskLevel={risk} size="sm" showIcon={false}>
              {state}
            </RiskBadge>
          );
        },
      },
      {
        accessorKey: "query_duration_seconds",
        header: () => t("diagnostics.columns.duration"),
        cell: ({ row }) => {
          const s = row.original.query_duration_seconds;
          if (typeof s !== "number") return <span className="text-muted-foreground">-</span>;
          return (
            <span
              className={`${METRIC} ${s > 300 ? "text-destructive" : s > 60 ? "text-warning" : ""}`}
            >
              {formatSeconds(s, t)}
            </span>
          );
        },
      },
      {
        accessorKey: "application_name",
        header: () => t("diagnostics.columns.application"),
        cell: ({ row }) => (
          <span className="block max-w-[180px] truncate text-muted-foreground">
            {row.original.application_name ?? "-"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => (
          <IfWriter>
            <div className="text-right">{t("diagnostics.columns.actions")}</div>
          </IfWriter>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const pid = row.original.pid;
          const busy = cancelling || terminating;
          return (
            <IfWriter>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleCancel(pid)}
                  className="h-6 px-1.5 text-[11px]"
                >
                  <StopCircle className="h-3 w-3" />
                  {t("diagnostics.actions.cancel")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleTerminate(pid)}
                  className="h-6 border-destructive/30 px-1.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Skull className="h-3 w-3" />
                  {t("diagnostics.actions.terminate")}
                </Button>
              </div>
            </IfWriter>
          );
        },
      },
    ];
  }, [t, handleCancel, handleTerminate, cancelling, terminating]);

  const queryCols = useMemo<ColumnDef<QueryInfo>[]>(
    () => [
      {
        accessorKey: "pid",
        header: () => "PID",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => openInsight(row.original)}
            title={t("queryInsight.openHint")}
            className={`${METRIC} font-semibold text-info underline-offset-2 hover:underline`}
          >
            {row.original.pid}
          </button>
        ),
      },
      {
        accessorKey: "user",
        header: () => t("diagnostics.columns.user"),
        cell: ({ row }) => <span className="font-mono">{row.original.user ?? "-"}</span>,
      },
      {
        accessorKey: "state",
        header: () => t("diagnostics.columns.state"),
        cell: ({ row }) => (
          <RiskBadge riskLevel="INFO" size="sm" showIcon={false}>
            {row.original.state ?? "-"}
          </RiskBadge>
        ),
      },
      {
        accessorKey: "duration_seconds",
        header: () => t("diagnostics.columns.duration"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-warning`}>
            {typeof row.original.duration_seconds === "number"
              ? formatSeconds(row.original.duration_seconds, t)
              : "-"}
          </span>
        ),
      },
      {
        accessorKey: "wait_event",
        header: () => t("diagnostics.columns.wait"),
        cell: ({ row }) => (
          <code className="font-mono text-[11px] text-muted-foreground">
            {row.original.wait_event_type
              ? `${row.original.wait_event_type}${
                  row.original.wait_event ? `:${row.original.wait_event}` : ""
                }`
              : "-"}
          </code>
        ),
      },
      {
        accessorKey: "query",
        header: () => t("diagnostics.columns.query"),
        cell: ({ row }) => (
          <pre className={`${PRE} line-clamp-2 max-w-[520px]`}>{row.original.query ?? "-"}</pre>
        ),
      },
    ],
    [t, openInsight]
  );

  const lockCols = useMemo<ColumnDef<LockInfo>[]>(
    () => [
      {
        accessorKey: "blocking_pid",
        header: () => t("diagnostics.locks.blockingPid"),
        cell: ({ row }) => (
          <code className={`${METRIC} font-semibold text-destructive`}>{row.original.blocking_pid}</code>
        ),
      },
      {
        accessorKey: "blocked_pid",
        header: () => t("diagnostics.locks.blockedPid"),
        cell: ({ row }) => (
          <code className={`${METRIC} font-semibold text-warning`}>{row.original.blocked_pid}</code>
        ),
      },
      {
        accessorKey: "relation",
        header: () => t("diagnostics.locks.relation"),
        cell: ({ row }) => (
          <code className="font-mono text-muted-foreground">{row.original.relation ?? "-"}</code>
        ),
      },
      {
        accessorKey: "lock_type",
        header: () => t("diagnostics.locks.type"),
        cell: ({ row }) => (
          <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
            {row.original.lock_type ?? "-"}
          </RiskBadge>
        ),
      },
      {
        accessorKey: "blocked_mode",
        header: () => t("diagnostics.locks.mode"),
        cell: ({ row }) => (
          <span className="font-mono text-[11px]">
            {row.original.blocking_mode ?? "-"} → {row.original.blocked_mode ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "blocking_duration_seconds",
        header: () => t("diagnostics.locks.blockingDuration"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-destructive`}>
            {typeof row.original.blocking_duration_seconds === "number"
              ? formatSeconds(row.original.blocking_duration_seconds, t)
              : "-"}
          </span>
        ),
      },
      {
        accessorKey: "blocking_query",
        header: () => t("diagnostics.locks.blockingQuery"),
        cell: ({ row }) => (
          <pre className={`${PRE} line-clamp-2 max-w-[400px]`}>{row.original.blocking_query ?? "-"}</pre>
        ),
      },
    ],
    [t]
  );

  const storageCols = useMemo<ColumnDef<TableSize>[]>(
    () => [
      {
        accessorKey: "schema_name",
        header: () => t("diagnostics.columns.schema"),
        cell: ({ row }) => (
          <code className="font-mono text-muted-foreground">{row.original.schema_name ?? "public"}</code>
        ),
      },
      {
        accessorKey: "table_name",
        header: () => t("diagnostics.columns.table"),
        cell: ({ row }) => <span className="font-medium">{row.original.table_name}</span>,
      },
      {
        accessorKey: "total_size_bytes",
        header: () => t("diagnostics.storage.total"),
        cell: ({ row }) => (
          <span className={`${METRIC} font-semibold`}>{formatBytes(row.original.total_size_bytes ?? 0)}</span>
        ),
      },
      {
        accessorKey: "table_size_bytes",
        header: () => t("diagnostics.storage.tableSize"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-muted-foreground`}>
            {formatBytes(row.original.table_size_bytes ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: "indexes_size_bytes",
        header: () => t("diagnostics.storage.indexes"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-muted-foreground`}>
            {formatBytes(row.original.indexes_size_bytes ?? 0)}
          </span>
        ),
      },
      {
        id: "index_ratio",
        header: () => t("diagnostics.storage.indexRatio"),
        cell: ({ row }) => {
          const total = row.original.total_size_bytes ?? 0;
          const pct = total > 0 ? ((row.original.indexes_size_bytes ?? 0) / total) * 100 : 0;
          return (
            <div className="flex items-center gap-2">
              <PercentBar pct={pct} className="bg-info" />
              <span className={`${METRIC} text-muted-foreground`}>{percent(pct)}</span>
            </div>
          );
        },
      },
    ],
    [t, percent]
  );

  const idxCols = useMemo<ColumnDef<IndexInfo>[]>(
    () => [
      {
        id: "index",
        accessorFn: (r) => `${r.index_name} ${r.schema_name ?? "public"}.${r.table_name ?? "-"}`,
        header: () => t("diagnostics.indexes.index"),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.index_name}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {row.original.schema_name ?? "public"}.{row.original.table_name ?? "-"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "index_size_bytes",
        header: () => t("diagnostics.indexes.size"),
        cell: ({ row }) => (
          <span className={METRIC}>{formatBytes(row.original.index_size_bytes ?? 0)}</span>
        ),
      },
      {
        accessorKey: "index_scans",
        header: () => t("diagnostics.indexes.scans"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-success`}>{formatNumber(row.original.index_scans ?? 0)}</span>
        ),
      },
      {
        accessorKey: "tuples_fetched",
        header: () => t("diagnostics.indexes.tuples"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-[11px] text-muted-foreground`}>
            {t("diagnostics.indexes.tuplesValue", {
              read: formatNumber(row.original.tuples_read ?? 0),
              fetched: formatNumber(row.original.tuples_fetched ?? 0),
            })}
          </span>
        ),
      },
      {
        accessorKey: "potentially_unused",
        header: () => t("diagnostics.columns.state"),
        cell: ({ row }) =>
          row.original.potentially_unused ? (
            <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
              {t("diagnostics.indexes.maybeUnused")}
            </RiskBadge>
          ) : (
            <RiskBadge riskLevel="OK" size="sm" showIcon={false}>
              {t("diagnostics.indexes.inUse")}
            </RiskBadge>
          ),
      },
    ],
    [t, formatNumber]
  );

  const maintCols = useMemo<ColumnDef<TableMaintenance>[]>(
    () => [
      {
        accessorKey: "table_name",
        header: () => t("diagnostics.columns.table"),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.table_name}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {row.original.schema_name ?? "public"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: () => t("diagnostics.columns.state"),
        cell: ({ row }) => (
          <RiskBadge riskLevel={severityToRisk(row.original.status)} size="sm" showIcon={false}>
            {row.original.status}
          </RiskBadge>
        ),
      },
      {
        accessorKey: "dead_tuple_percent",
        header: () => t("diagnostics.maintenance.deadPercent"),
        cell: ({ row }) => {
          const pct = row.original.dead_tuple_percent ?? 0;
          return (
            <div className="flex items-center gap-2">
              <PercentBar
                pct={pct}
                className={pct > 40 ? "bg-destructive" : pct > 20 ? "bg-warning" : "bg-success"}
              />
              <span className={`${METRIC} font-semibold`}>{percent(pct)}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "live_tuples",
        header: () => t("diagnostics.maintenance.liveDead"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-[11px]`}>
            <span className="text-success">{formatNumber(row.original.live_tuples ?? 0)}</span>
            {" / "}
            <span className="text-destructive">{formatNumber(row.original.dead_tuples ?? 0)}</span>
          </span>
        ),
      },
      {
        id: "last_vacuum",
        accessorFn: (r) => latestDate(r.last_vacuum, r.last_autovacuum) ?? "",
        header: () => t("diagnostics.maintenance.lastVacuum"),
        cell: ({ row }) => {
          const last = latestDate(row.original.last_vacuum, row.original.last_autovacuum);
          return (
            <div>
              <div className={METRIC}>{last ? formatDate(last) : "-"}</div>
              <div className={`${METRIC} text-[11px] text-muted-foreground`}>
                {t("diagnostics.maintenance.vacuumCounts", {
                  auto: formatNumber(row.original.autovacuum_count ?? 0),
                  manual: formatNumber(row.original.vacuum_count ?? 0),
                })}
              </div>
            </div>
          );
        },
      },
    ],
    [t, formatNumber, formatDate, percent]
  );

  const pgssCols = useMemo<ColumnDef<PgStatStatementsRow>[]>(
    () => [
      {
        accessorKey: "queryid",
        header: () => "QueryID",
        cell: ({ row }) =>
          row.original.queryid ? (
            <Link
              href={`/statements/${encodeURIComponent(row.original.queryid)}`}
              className="font-mono text-[11px] text-info hover:underline"
            >
              {row.original.queryid}
            </Link>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        accessorKey: "calls",
        header: () => t("diagnostics.pgss.calls"),
        cell: ({ row }) => (
          <span className={`${METRIC} font-semibold`}>{formatNumber(Number(row.original.calls ?? 0))}</span>
        ),
      },
      {
        accessorKey: "total_exec_time",
        header: () => t("diagnostics.pgss.totalTime"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-warning`}>
            {formatMs(Number(row.original.total_exec_time ?? 0), t, formatNumber)}
          </span>
        ),
      },
      {
        accessorKey: "mean_exec_time",
        header: () => t("diagnostics.pgss.meanTime"),
        cell: ({ row }) => (
          <span className={METRIC}>
            {formatMs(Number(row.original.mean_exec_time ?? 0), t, formatNumber)}
          </span>
        ),
      },
      {
        accessorKey: "rows",
        header: () => t("diagnostics.pgss.rows"),
        cell: ({ row }) => (
          <span className={`${METRIC} text-muted-foreground`}>
            {formatNumber(Number(row.original.rows ?? 0))}
          </span>
        ),
      },
      {
        accessorKey: "query",
        header: () => t("diagnostics.columns.query"),
        cell: ({ row }) => {
          const text = (
            <pre className={`${PRE} line-clamp-2 max-w-[520px]`}>{String(row.original.query ?? "-")}</pre>
          );
          return row.original.queryid ? (
            <Link
              href={`/statements/${encodeURIComponent(row.original.queryid)}`}
              className="block hover:underline"
            >
              {text}
            </Link>
          ) : (
            text
          );
        },
      },
    ],
    [t, formatNumber]
  );

  const unusedCount = idxData.filter((i) => i.potentially_unused).length;
  const connSummary = connQ.isError ? undefined : connQ.data?.summary;
  const lockSummary = locksQ.isError ? undefined : locksQ.data?.summary;
  const maintSummary = maintQ.isError ? undefined : maintQ.data?.summary;

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Activity className="h-4 w-4 text-info" />
            {t("diagnostics.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("diagnostics.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() })}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t("common.refresh")}
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        className="w-full"
      >
        <div className="overflow-x-auto">
          <TabsList className="inline-flex h-auto min-w-max gap-0.5 p-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.id} value={tab.id} className="h-7 px-2 text-xs">
                  <Icon className="mr-1 h-3 w-3" />
                  {t(tab.labelKey)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="findings" className="mt-2">
          <DataTable
            columns={findingsCols}
            data={findingsData}
            isLoading={findingsQ.isLoading}
            isError={findingsQ.isError}
            error={findingsQ.error}
            onRetry={() => findingsQ.refetch()}
            emptyTitle={t("diagnostics.findings.emptyTitle")}
            emptyDesc={t("diagnostics.findings.emptyDesc")}
            searchPlaceholder={t("diagnostics.findings.search")}
          />
        </TabsContent>

        <TabsContent value="connections" className="mt-2">
          {connSummary && (
            <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              <StatCard label={t("diagnostics.connections.active")} value={formatNumber(connSummary.active)} tone="success" />
              <StatCard label={t("diagnostics.connections.idle")} value={formatNumber(connSummary.idle)} tone="muted" />
              <StatCard label={t("diagnostics.connections.idleInTx")} value={formatNumber(connSummary.idle_in_transaction)} tone="warning" />
              <StatCard label={t("diagnostics.connections.waiting")} value={formatNumber(connSummary.waiting)} tone="destructive" />
              <StatCard label={t("diagnostics.connections.usage")} value={percent(connSummary.usage_percent)} tone="info" />
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("diagnostics.connections.groupBy")}
            </span>
            <Select
              value={connGroupBy}
              onValueChange={(v) => setConnGroupBy(v as ConnGroupKey | "none")}
            >
              <SelectTrigger className="h-7 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("diagnostics.connections.groupNone")}</SelectItem>
                {CONN_GROUP_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {t(opt.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {connGroupBy !== "none" && !connQ.isError && (
              <span className="text-xs text-muted-foreground">
                {t("diagnostics.connections.groupSummary", {
                  groups: formatNumber(connGroups.length),
                  count: formatNumber(connData.length),
                })}
              </span>
            )}
          </div>
          {connGroupBy === "none" ? (
            <DataTable
              columns={connCols}
              data={connData}
              isLoading={connQ.isLoading}
              isError={connQ.isError}
              error={connQ.error}
              onRetry={() => connQ.refetch()}
              emptyTitle={t("diagnostics.connections.emptyTitle")}
              emptyDesc={t("diagnostics.connections.emptyDesc")}
              searchPlaceholder={t("diagnostics.connections.search")}
            />
          ) : connQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : connGroups.length === 0 ? (
            <p className="rounded-md border border-border px-3 py-6 text-center text-xs text-muted-foreground">
              {t("diagnostics.connections.emptyDesc")}
            </p>
          ) : (
            <ConnectionGroups
              groups={connGroups}
              label={connGroupLabel}
              busy={cancelling || terminating || connBatch !== null}
              batch={connBatch}
              onGroupAction={handleGroupAction}
              onCancelPid={handleCancel}
              onTerminatePid={handleTerminate}
            />
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-2">
          <DataTable
            columns={queryCols}
            data={aqData}
            isLoading={aqQ.isLoading}
            isError={aqQ.isError}
            error={aqQ.error}
            onRetry={() => aqQ.refetch()}
            emptyTitle={t("diagnostics.active.emptyTitle")}
            emptyDesc={t("diagnostics.active.emptyDesc")}
            searchPlaceholder={t("diagnostics.active.search")}
          />
        </TabsContent>

        <TabsContent value="long" className="mt-2">
          {lrQ.data && !lrQ.isError && (
            <Notice
              icon={<Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}
              title={t("diagnostics.long.title", { minutes: LONG_RUNNING_SECONDS / 60 })}
              className="border-warning/30 bg-warning/10"
            >
              {t("diagnostics.long.desc", { count: lrData.length })}
            </Notice>
          )}
          <DataTable
            columns={queryCols}
            data={lrData}
            isLoading={lrQ.isLoading}
            isError={lrQ.isError}
            error={lrQ.error}
            onRetry={() => lrQ.refetch()}
            emptyTitle={t("diagnostics.long.emptyTitle")}
            emptyDesc={t("diagnostics.long.emptyDesc", { minutes: LONG_RUNNING_SECONDS / 60 })}
            searchPlaceholder={t("diagnostics.active.search")}
          />
        </TabsContent>

        <TabsContent value="locks" className="mt-2">
          {lockSummary && (
            <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-3">
              <StatCard label={t("diagnostics.locks.total")} value={formatNumber(lockSummary.total_locks)} tone="info" />
              <StatCard label={t("diagnostics.locks.waiting")} value={formatNumber(lockSummary.waiting_locks)} tone="warning" />
              <StatCard label={t("diagnostics.locks.blockingPairs")} value={formatNumber(lockSummary.blocking_pairs)} tone="destructive" />
            </div>
          )}
          <DataTable
            columns={lockCols}
            data={locksData}
            isLoading={locksQ.isLoading}
            isError={locksQ.isError}
            error={locksQ.error}
            onRetry={() => locksQ.refetch()}
            emptyTitle={t("diagnostics.locks.emptyTitle")}
            emptyDesc={t("diagnostics.locks.emptyDesc")}
            searchPlaceholder={t("diagnostics.locks.search")}
          />
        </TabsContent>

        <TabsContent value="storage" className="mt-2">
          <DataTable
            columns={storageCols}
            data={storageData}
            isLoading={storageQ.isLoading}
            isError={storageQ.isError}
            error={storageQ.error}
            onRetry={() => storageQ.refetch()}
            emptyTitle={t("diagnostics.storage.emptyTitle")}
            emptyDesc={t("diagnostics.storage.emptyDesc")}
            searchPlaceholder={t("diagnostics.storage.search")}
          />
        </TabsContent>

        <TabsContent value="indexes" className="mt-2">
          {idxQ.data && !idxQ.isError && (
            <Notice
              icon={<Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />}
              title={t("diagnostics.indexes.noticeTitle")}
            >
              {t("diagnostics.indexes.noticeDesc", { total: idxData.length, unused: unusedCount })}
            </Notice>
          )}
          <DataTable
            columns={idxCols}
            data={idxData}
            isLoading={idxQ.isLoading}
            isError={idxQ.isError}
            error={idxQ.error}
            onRetry={() => idxQ.refetch()}
            emptyTitle={t("diagnostics.indexes.emptyTitle")}
            emptyDesc={t("diagnostics.indexes.emptyDesc")}
            searchPlaceholder={t("diagnostics.indexes.search")}
          />
        </TabsContent>

        <TabsContent value="maintenance" className="mt-2">
          {maintSummary && (
            <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatCard label={t("diagnostics.maintenance.liveTuples")} value={formatNumber(maintSummary.total_live_tuples)} tone="success" />
              <StatCard label={t("diagnostics.maintenance.deadTuples")} value={formatNumber(maintSummary.total_dead_tuples)} tone="destructive" />
              <StatCard label={t("diagnostics.maintenance.deadPercent")} value={percent(maintSummary.dead_tuple_percent, 2)} tone="warning" />
              <StatCard label={t("diagnostics.maintenance.neverVacuumed")} value={formatNumber(maintSummary.tables_never_vacuumed)} tone="info" />
            </div>
          )}
          <DataTable
            columns={maintCols}
            data={maintData}
            isLoading={maintQ.isLoading}
            isError={maintQ.isError}
            error={maintQ.error}
            onRetry={() => maintQ.refetch()}
            emptyTitle={t("diagnostics.maintenance.emptyTitle")}
            emptyDesc={t("diagnostics.maintenance.emptyDesc")}
            searchPlaceholder={t("diagnostics.maintenance.search")}
          />
        </TabsContent>

        <TabsContent value="pgss" className="mt-2">
          <Notice
            icon={<ListOrdered className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}
            title={t("diagnostics.pgss.noticeTitle")}
          >
            {t("diagnostics.pgss.noticeDesc")}
          </Notice>
          <DataTable
            columns={pgssCols}
            data={pgssData}
            isLoading={pgssQ.isLoading}
            isError={pgssQ.isError}
            error={pgssQ.error}
            onRetry={() => pgssQ.refetch()}
            emptyTitle={t("diagnostics.pgss.emptyTitle")}
            emptyDesc={t("diagnostics.pgss.emptyDesc")}
            searchPlaceholder={t("diagnostics.pgss.search")}
          />
        </TabsContent>

        <TabsContent value="sequences" className="mt-2">
          <Notice
            icon={<Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
            title={t("diagnostics.sequences.noticeTitle")}
            className="border-destructive/30 bg-destructive/10"
          >
            {t("diagnostics.sequences.noticeDesc")}
          </Notice>
          <SequencesPanel refetchInterval={autoRefresh ? pollInterval : false} />
        </TabsContent>
      </Tabs>

      <QueryInsightDialog target={insightTarget} onClose={() => setInsightTarget(null)} />
    </div>
  );
}
