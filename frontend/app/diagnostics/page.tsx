"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { endpoints } from "@/lib/api/types";
import type {
  ConnectionInfo,
  QueryInfo,
  LockInfo,
  TableSize,
  IndexInfo,
  TableMaintenance,
  PgStatStatementsRow,
  BloatRow,
  SequenceRow,
  DiagnosticFinding,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/lib/hooks/useConfirm";
import {
  Activity,
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
  Zap,
  Clock,
  Lock,
  HardDrive,
  Database,
  Wrench,
  ListOrdered,
  Hash,
  FileSearch,
  StopCircle,
  Skull,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatBytes,
  formatInterval,
  formatDuration,
  formatNumber,
  formatDate,
} from "@/lib/utils";

type PageSize = 10 | 25 | 50;

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading: boolean;
  emptyTitle?: string;
  emptyDesc?: string;
  pageSize: PageSize;
  setPageSize: (n: PageSize) => void;
  globalFilter: string;
  setGlobalFilter: (v: string) => void;
  searchPlaceholder?: string;
}

function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  emptyTitle = "Veri yok",
  emptyDesc = "Görüntülenecek kayıt bulunamadı.",
  pageSize,
  setPageSize,
  globalFilter,
  setGlobalFilter,
  searchPlaceholder = "Ara...",
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    initialState: {
      pagination: { pageSize },
    },
  });

  const currentPage = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const canPrev = currentPage > 0;
  const canNext = currentPage < pageCount - 1;

  return (
    <div className="space-y-5">
      <div className="relative max-w-md w-full">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={globalFilter ?? ""}
          onChange={(e) => {
            setGlobalFilter(String(e.target.value));
            table.setGlobalFilter(String(e.target.value));
          }}
          placeholder={searchPlaceholder}
          className="pl-12 h-11"
        />
      </div>

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
                  <FileSearch className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="font-semibold">{emptyTitle}</p>
                  <p className="text-sm text-muted-foreground mt-1">{emptyDesc}</p>
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

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <p className="text-muted-foreground">
            Sayfa{" "}
            <span className="font-semibold text-foreground">{currentPage + 1}</span> /{" "}
            {Math.max(1, pageCount)} · Toplam{" "}
            <span className="font-semibold text-foreground">{data.length}</span> kayıt
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
    </div>
  );
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

export default function DiagnosticsPage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [activeTab, setActiveTab] = useState("findings");

  const [findingsSearch, setFindingsSearch] = useState("");
  const [findingsPS, setFindingsPS] = useState<PageSize>(25);

  const [connSearch, setConnSearch] = useState("");
  const [connPS, setConnPS] = useState<PageSize>(25);

  const [aqSearch, setAqSearch] = useState("");
  const [aqPS, setAqPS] = useState<PageSize>(25);

  const [lrSearch, setLrSearch] = useState("");
  const [lrPS, setLrPS] = useState<PageSize>(25);

  const [locksSearch, setLocksSearch] = useState("");
  const [locksPS, setLocksPS] = useState<PageSize>(25);

  const [storageSearch, setStorageSearch] = useState("");
  const [storagePS, setStoragePS] = useState<PageSize>(25);

  const [idxSearch, setIdxSearch] = useState("");
  const [idxPS, setIdxPS] = useState<PageSize>(25);

  const [maintSearch, setMaintSearch] = useState("");
  const [maintPS, setMaintPS] = useState<PageSize>(25);

  const [pgssSearch, setPgssSearch] = useState("");
  const [pgssPS, setPgssPS] = useState<PageSize>(25);

  const [seqSearch, setSeqSearch] = useState("");
  const [seqPS, setSeqPS] = useState<PageSize>(50);

  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: qk.diagnostics.diagnose(),
    queryFn: () => endpoints.getDiagnose(),
  });

  const { data: connReport, isLoading: connLoading } = useQuery({
    queryKey: qk.diagnostics.connections(100),
    queryFn: () => endpoints.getConnections(100),
  });

  const { data: aqReport, isLoading: aqLoading } = useQuery({
    queryKey: qk.diagnostics.queries.active(100),
    queryFn: () => endpoints.getActiveQueries(100),
  });

  const { data: lrReport, isLoading: lrLoading } = useQuery({
    queryKey: qk.diagnostics.queries.longRunning(300, 100),
    queryFn: () => endpoints.getLongRunningQueries(300, 100),
  });

  const { data: locksReport, isLoading: locksLoading } = useQuery({
    queryKey: qk.diagnostics.locks(100),
    queryFn: () => endpoints.getLocks(100),
  });

  const { data: storageReport, isLoading: storageLoading } = useQuery({
    queryKey: qk.diagnostics.storage("tables", 200),
    queryFn: () => endpoints.getStorage("tables", 200),
  });

  const { data: idxReport, isLoading: idxLoading } = useQuery({
    queryKey: qk.diagnostics.indexes(200),
    queryFn: () => endpoints.getIndexes(200),
  });

  const { data: maintReport, isLoading: maintLoading } = useQuery({
    queryKey: qk.diagnostics.maintenance(200),
    queryFn: () => endpoints.getMaintenance(200),
  });

  const { data: pgssRows, isLoading: pgssLoading } = useQuery({
    queryKey: qk.diagnostics.pgStatStatements(200),
    queryFn: () => endpoints.getPgStatStatements(200),
  });

  const { data: bloatRows, isLoading: bloatLoading } = useQuery({
    queryKey: qk.diagnostics.bloat(200),
    queryFn: () => endpoints.getBloat(200),
  });

  const { data: seqRows, isLoading: seqLoading } = useQuery({
    queryKey: qk.diagnostics.sequences(500),
    queryFn: () => endpoints.getSequences(500),
  });

  const cancelMutation = useMutation({
    mutationFn: (pid: number) =>
      endpoints.cancelBackend(pid, { confirm: true }),
    onSuccess: () => {
      toast.success("Sorgu iptal edildi");
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() });
    },
    onError: () => toast.error("İptal başarısız"),
  });

  const termMutation = useMutation({
    mutationFn: (pid: number) =>
      endpoints.terminateBackend(pid, { confirm: true, confirm_name: String(pid) }),
    onSuccess: () => {
      toast.success("Bağlantı sonlandırıldı");
      queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() });
    },
    onError: () => toast.error("Sonlandırma başarısız"),
  });

  const handleCancel = async (pid: number) => {
    const ok = await confirm({
      title: `PID ${pid} sorgusunu iptal et?`,
      description:
        "Şu an çalışan sorguyu pg_cancel_backend() ile iptal edeceğiz. Bağlantı açık kalır, sadece aktif sorgu kesilir.",
      risk_level: "MAINTENANCE",
      confirm_label: "İptal Et",
      cancel_label: "Vazgeç",
      sql_preview: [`SELECT pg_cancel_backend(${pid});`],
    });
    if (ok) await cancelMutation.mutateAsync(pid);
  };

  const handleTerminate = async (pid: number) => {
    const ok = await confirm({
      title: `PID ${pid} bağlantısını SONLANDIR?`,
      description:
        "Bu işlem pg_terminate_backend() çalıştırır — bağlantı tamamen kapanır, aktif işlem rollback olur. Dikkatli kullanın.",
      risk_level: "DANGEROUS",
      confirm_label: "SONLANDIR",
      cancel_label: "İptal",
      confirm_name_required: true,
      confirm_name_value: String(pid),
      confirm_name_placeholder: `Onaylamak için PID "${pid}" yazın`,
      sql_preview: [`SELECT pg_terminate_backend(${pid});`],
    });
    if (ok) await termMutation.mutateAsync(pid);
  };

  const connData: ConnectionInfo[] = connReport?.connections ?? [];
  const aqData: QueryInfo[] = aqReport?.queries ?? [];
  const lrData: QueryInfo[] = lrReport?.queries ?? [];
  const locksData: LockInfo[] = locksReport?.locks ?? [];
  const storageData: TableSize[] = storageReport?.tables ?? [];
  const idxData: IndexInfo[] = idxReport?.indexes ?? [];
  const maintData: TableMaintenance[] = maintReport?.tables ?? (bloatRows as unknown as TableMaintenance[]) ?? [];
  const pgssData: PgStatStatementsRow[] = pgssRows ?? [];
  const seqData: SequenceRow[] = seqRows ?? [];

  const findingsCols: ColumnDef<DiagnosticFinding>[] = useMemo(
    () => [
      {
        accessorKey: "severity",
        header: "Seviye",
        cell: ({ row }) => (
          <RiskBadge
            riskLevel={severityToRisk(row.original.severity)}
            size="sm"
          >
            {row.original.severity}
          </RiskBadge>
        ),
      },
      {
        accessorKey: "code",
        header: "Kod",
        cell: ({ row }) => (
          <code className="text-[11px] font-mono text-muted-foreground bg-white/5 px-2.5 py-1 rounded-full">
            {row.original.code}
          </code>
        ),
      },
      {
        accessorKey: "title",
        header: "Başlık",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-semibold text-sm">{row.original.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {row.original.description}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "value",
        header: "Değer",
        cell: ({ row }) => (
          <span className="text-xs font-mono text-muted-foreground">
            {row.original.value ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "recommendation",
        header: "Öneri",
        cell: ({ row }) => (
          row.original.recommendation ? (
            <p className="text-xs text-emerald-400/90 flex items-start gap-1.5 max-w-md">
              <ArrowUpRight className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="line-clamp-2">{row.original.recommendation}</span>
            </p>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )
        ),
      },
    ],
    []
  );

  const connCols: ColumnDef<ConnectionInfo>[] = useMemo(
    () => [
      {
        accessorKey: "pid",
        header: "PID",
        cell: ({ row }) => (
          <code className="text-xs font-mono font-semibold text-indigo-400">
            {row.original.pid}
          </code>
        ),
      },
      {
        accessorKey: "user",
        header: "Kullanıcı",
        cell: ({ row }) => (
          <span className="text-sm font-mono">{row.original.user ?? "-"}</span>
        ),
      },
      {
        accessorKey: "database",
        header: "DB",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.database ?? "-"}</span>
        ),
      },
      {
        accessorKey: "client_address",
        header: "Client",
        cell: ({ row }) => (
          <code className="text-xs font-mono text-muted-foreground">
            {row.original.client_address ?? "-"}
          </code>
        ),
      },
      {
        accessorKey: "state",
        header: "Durum",
        cell: ({ row }) => {
          const st = row.original.state ?? "unknown";
          const color: "OK" | "WARNING" | "INFO" =
            st === "active"
              ? "OK"
              : st === "idle in transaction"
              ? "WARNING"
              : "INFO";
          return <RiskBadge riskLevel={color} size="sm">{st}</RiskBadge>;
        },
      },
      {
        accessorKey: "query_duration_seconds",
        header: "Süre",
        cell: ({ row }) => {
          const s = row.original.query_duration_seconds;
          const n = typeof s === "number" ? s : null;
          return (
            <span
              className={
                "text-sm font-mono " +
                (n !== null && n > 300
                  ? "text-red-400"
                  : n !== null && n > 60
                  ? "text-amber-400"
                  : "")
              }
            >
              {n !== null ? formatInterval(n) : "-"}
            </span>
          );
        },
      },
      {
        accessorKey: "application_name",
        header: "Uygulama",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[180px]">
            {row.original.application_name ?? "-"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">İşlemler</div>,
        enableSorting: false,
        cell: ({ row }) => {
          const pid = row.original.pid;
          const busy = cancelMutation.isPending || termMutation.isPending;
          return (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || cancelMutation.isPending}
                onClick={() => handleCancel(pid)}
                className="h-9 rounded-full"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || termMutation.isPending}
                onClick={() => handleTerminate(pid)}
                className="h-9 rounded-full text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50"
              >
                <Skull className="h-3.5 w-3.5" />
                Terminate
              </Button>
            </div>
          );
        },
      },
    ],
    [cancelMutation.isPending, termMutation.isPending]
  );

  const qCols = (): ColumnDef<QueryInfo>[] => [
    {
      accessorKey: "pid",
      header: "PID",
      cell: ({ row }) => (
        <code className="text-xs font-mono font-semibold text-indigo-400">
          {row.original.pid}
        </code>
      ),
    },
    {
      accessorKey: "user",
      header: "Kullanıcı",
      cell: ({ row }) => (
        <span className="text-sm font-mono">{row.original.user ?? "-"}</span>
      ),
    },
    {
      accessorKey: "state",
      header: "Durum",
      cell: ({ row }) => (
        <RiskBadge riskLevel="INFO" size="sm">
          {row.original.state ?? "-"}
        </RiskBadge>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: "Süre",
      cell: ({ row }) => (
        <span className="text-sm font-mono text-amber-400">
          {typeof row.original.duration_seconds === "number"
            ? formatInterval(row.original.duration_seconds)
            : "-"}
        </span>
      ),
    },
    {
      accessorKey: "wait_event",
      header: "Wait",
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.original.wait_event_type ? (
            <code className="bg-white/5 px-2 py-0.5 rounded-full">
              {row.original.wait_event_type}
              {row.original.wait_event ? `:${row.original.wait_event}` : ""}
            </code>
          ) : (
            "-"
          )}
        </div>
      ),
    },
    {
      accessorKey: "query",
      header: "Sorgu",
      cell: ({ row }) => (
        <pre className="text-[11px] font-mono text-muted-foreground bg-white/5 rounded-xl p-3 max-h-20 overflow-hidden whitespace-pre-wrap line-clamp-3 max-w-[480px]">
          {row.original.query ?? "-"}
        </pre>
      ),
    },
  ];

  const lockCols: ColumnDef<LockInfo>[] = [
    {
      accessorKey: "blocking_pid",
      header: "Blok Eden PID",
      cell: ({ row }) => (
        <code className="text-xs font-mono font-semibold text-red-400">
          {row.original.blocking_pid}
        </code>
      ),
    },
    {
      accessorKey: "blocked_pid",
      header: "Blok Olan PID",
      cell: ({ row }) => (
        <code className="text-xs font-mono font-semibold text-amber-400">
          {row.original.blocked_pid}
        </code>
      ),
    },
    {
      accessorKey: "relation",
      header: "İlişki",
      cell: ({ row }) => (
        <code className="text-xs font-mono text-muted-foreground bg-white/5 px-2 py-1 rounded-full">
          {row.original.relation ?? "-"}
        </code>
      ),
    },
    {
      accessorKey: "lock_type",
      header: "Kilit Türü",
      cell: ({ row }) => (
        <RiskBadge riskLevel="WARNING" size="sm">
          {row.original.lock_type ?? "-"}
        </RiskBadge>
      ),
    },
    {
      accessorKey: "blocked_mode",
      header: "Mod",
      cell: ({ row }) => (
        <span className="text-xs font-mono">
          {row.original.blocking_mode ?? "-"} → {row.original.blocked_mode ?? "-"}
        </span>
      ),
    },
    {
      accessorKey: "blocking_duration_seconds",
      header: "Bekleme",
      cell: ({ row }) => (
        <span className="text-sm font-mono text-red-400">
          {typeof row.original.blocking_duration_seconds === "number"
            ? formatInterval(row.original.blocking_duration_seconds)
            : "-"}
        </span>
      ),
    },
    {
      accessorKey: "blocking_query",
      header: "Blok Eden Sorgu",
      cell: ({ row }) => (
        <pre className="text-[11px] font-mono text-muted-foreground bg-white/5 rounded-xl p-3 max-h-16 overflow-hidden whitespace-pre-wrap line-clamp-2 max-w-[400px]">
          {row.original.blocking_query ?? "-"}
        </pre>
      ),
    },
  ];

  const storageCols: ColumnDef<TableSize>[] = [
    {
      accessorKey: "schema_name",
      header: "Schema",
      cell: ({ row }) => (
        <code className="text-xs font-mono text-muted-foreground">
          {row.original.schema_name ?? "public"}
        </code>
      ),
    },
    {
      accessorKey: "table_name",
      header: "Tablo",
      cell: ({ row }) => (
        <span className="font-semibold text-sm">{row.original.table_name}</span>
      ),
    },
    {
      accessorKey: "total_size_bytes",
      header: "Toplam Boyut",
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-sm">
          {formatBytes(row.original.total_size_bytes ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "table_size_bytes",
      header: "Tablo",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground font-mono">
          {formatBytes(row.original.table_size_bytes ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "indexes_size_bytes",
      header: "İndeksler",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground font-mono">
          {formatBytes(row.original.indexes_size_bytes ?? 0)}
        </span>
      ),
    },
    {
      id: "index_ratio",
      header: "İndeks Oranı",
      cell: ({ row }) => {
        const t = row.original.total_size_bytes ?? 1;
        const i = row.original.indexes_size_bytes ?? 0;
        const pct = (i / t) * 100;
        return (
          <div className="flex items-center gap-3">
            <div className="h-2 w-24 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
  ];

  const idxCols: ColumnDef<IndexInfo>[] = [
    {
      accessorKey: "table_name",
      header: "Tablo",
      cell: ({ row }) => (
        <div className="text-xs">
          <div className="font-semibold">{row.original.index_name}</div>
          <div className="text-muted-foreground font-mono text-[11px]">
            {row.original.schema_name ?? "public"}.{row.original.table_name ?? "-"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "index_size_bytes",
      header: "Boyut",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {formatBytes(row.original.index_size_bytes ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "index_scans",
      header: "Scan",
      cell: ({ row }) => (
        <span className="font-mono text-sm text-emerald-400">
          {formatNumber(row.original.index_scans ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "tuples_fetched",
      header: "Tuples",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          Read: {formatNumber(row.original.tuples_read ?? 0)} · Fetch: {formatNumber(row.original.tuples_fetched ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "potentially_unused",
      header: "Durum",
      cell: ({ row }) =>
        row.original.potentially_unused ? (
          <RiskBadge riskLevel="WARNING" size="sm">
            Kullanılmayabilir
          </RiskBadge>
        ) : (
          <RiskBadge riskLevel="OK" size="sm">Kullanımda</RiskBadge>
        ),
    },
  ];

  const maintCols: ColumnDef<TableMaintenance>[] = [
    {
      accessorKey: "table_name",
      header: "Tablo",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold text-sm">{row.original.table_name}</div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {row.original.schema_name ?? "public"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Durum",
      cell: ({ row }) => (
        <RiskBadge riskLevel={severityToRisk(row.original.status)} size="sm">
          {row.original.status}
        </RiskBadge>
      ),
    },
    {
      accessorKey: "dead_tuple_percent",
      header: "Dead Tuple %",
      cell: ({ row }) => {
        const pct = row.original.dead_tuple_percent ?? 0;
        return (
          <div className="flex items-center gap-3 min-w-[180px]">
            <div className="h-2 flex-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full ${pct > 40 ? "bg-red-500" : pct > 20 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className="text-xs font-mono font-semibold w-12 text-right">
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "live_tuples",
      header: "Canlı / Ölü",
      cell: ({ row }) => (
        <div className="text-xs font-mono space-y-0.5">
          <div className="text-emerald-400">Live: {formatNumber(row.original.live_tuples ?? 0)}</div>
          <div className="text-red-400">Dead: {formatNumber(row.original.dead_tuples ?? 0)}</div>
        </div>
      ),
    },
    {
      accessorKey: "last_vacuum",
      header: "Son VACUUM",
      cell: ({ row }) => {
        const d = row.original.last_autovacuum ?? row.original.last_vacuum;
        return (
          <div className="text-xs">
            <div className="font-mono">{d ? formatDate(d) : "-"}</div>
            <div className="text-muted-foreground mt-0.5">
              AV cnt: {row.original.autovacuum_count ?? 0} · V cnt: {row.original.vacuum_count ?? 0}
            </div>
          </div>
        );
      },
    },
  ];

  const pgssCols: ColumnDef<PgStatStatementsRow>[] = [
    {
      accessorKey: "queryid",
      header: "QueryID",
      cell: ({ row }) => (
        <code className="text-[11px] font-mono text-indigo-400 bg-white/5 px-2 py-1 rounded-full">
          {String(row.original.queryid ?? "-")}
        </code>
      ),
    },
    {
      accessorKey: "calls",
      header: "Çağrı",
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-emerald-400">
          {formatNumber(Number(row.original.calls ?? 0))}
        </span>
      ),
    },
    {
      accessorKey: "total_exec_time",
      header: "Toplam Zaman",
      cell: ({ row }) => (
        <span className="font-mono text-amber-400">
          {formatDuration(Number(row.original.total_exec_time ?? 0))}
        </span>
      ),
    },
    {
      accessorKey: "mean_exec_time",
      header: "Ort. Zaman",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {formatDuration(Number(row.original.mean_exec_time ?? 0))}
        </span>
      ),
    },
    {
      accessorKey: "rows",
      header: "Rows",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatNumber(Number(row.original.rows ?? 0))}
        </span>
      ),
    },
    {
      accessorKey: "query",
      header: "Sorgu",
      cell: ({ row }) => (
        <pre className="text-[11px] font-mono text-muted-foreground bg-white/5 rounded-xl p-3 max-h-20 overflow-hidden whitespace-pre-wrap line-clamp-3 max-w-[520px]">
          {String(row.original.query ?? "-")}
        </pre>
      ),
    },
  ];

  const seqCols: ColumnDef<SequenceRow>[] = [
    {
      accessorKey: "sequence_name",
      header: "Sequence",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold text-sm font-mono">
            {row.original.sequence_name}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {row.original.schema_name ?? "public"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "last_value",
      header: "Son Değer",
      cell: ({ row }) => (
        <code className="text-xs font-mono">
          {formatNumber(Number(row.original.last_value ?? 0))}
        </code>
      ),
    },
    {
      accessorKey: "max_value",
      header: "Max Değer",
      cell: ({ row }) => (
        <code className="text-xs font-mono text-muted-foreground">
          {formatNumber(Number(row.original.max_value ?? 0))}
        </code>
      ),
    },
    {
      accessorKey: "exhaustion_percent",
      header: "Cycle Riski",
      cell: ({ row }) => {
        const pct = Number(row.original.exhaustion_percent ?? 0);
        const risk: "OK" | "WARNING" | "DANGEROUS" =
          pct >= 90 ? "DANGEROUS" : pct >= 75 ? "WARNING" : "OK";
        return (
          <div className="flex items-center gap-4 min-w-[260px]">
            <div className="h-2 flex-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  pct >= 90
                    ? "bg-red-500"
                    : pct >= 75
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold w-14 text-right">
                {pct.toFixed(2)}%
              </span>
              <RiskBadge riskLevel={risk} size="sm" />
            </div>
          </div>
        );
      },
    },
  ];

  const tabs = [
    { id: "findings", label: "Bulgu", icon: AlertTriangle },
    { id: "connections", label: "Bağlantılar", icon: Users },
    { id: "active", label: "Aktif Sorgular", icon: Zap },
    { id: "long", label: "Uzun Çalışan", icon: Clock },
    { id: "locks", label: "Kilitler", icon: Lock },
    { id: "storage", label: "Depolama", icon: HardDrive },
    { id: "indexes", label: "İndeksler", icon: Database },
    { id: "maintenance", label: "Bakım", icon: Wrench },
    { id: "pgss", label: "pg_stat", icon: ListOrdered },
    { id: "sequences", label: "Sequences", icon: Hash },
  ] as const;

  return (
    <div className="space-y-8">
      <ConfirmDialog />
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Activity className="h-8 w-8 text-purple-400" />
          Diagnostics
        </h1>
        <p className="text-muted-foreground mt-1">
          Tanı bulguları, bağlantılar, sorgular, kilitler, depolama, indeksler, bakım ve performans özeti.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl flex items-center gap-2">
            <Database className="h-5 w-5 text-purple-400" />
            Tanı Paneli
          </CardTitle>
          <CardDescription>
            Sekmeler arasında geçiş yaparak farklı açılardan inceleyin
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="overflow-x-auto pb-2 -mx-2 px-2">
              <TabsList className="h-auto inline-flex gap-1 p-1 min-w-max">
                {tabs.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger
                      key={t.id}
                      value={t.id}
                      className="h-10 px-4 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 mr-1.5" />
                      {t.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <TabsContent value="findings" className="mt-6">
              <DataTable
                columns={findingsCols}
                data={findings ?? []}
                isLoading={findingsLoading}
                emptyTitle="Tanı bulgusu yok"
                emptyDesc="Sağlık denetimlerinde sorun bulunmadı."
                pageSize={findingsPS}
                setPageSize={setFindingsPS}
                globalFilter={findingsSearch}
                setGlobalFilter={setFindingsSearch}
                searchPlaceholder="Başlık, kod, açıklama ara..."
              />
            </TabsContent>

            <TabsContent value="connections" className="mt-6">
              <div className="mb-5 grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard
                  label="Aktif"
                  value={String(connReport?.summary.active ?? 0)}
                  tone="emerald"
                />
                <StatCard
                  label="Boşta"
                  value={String(connReport?.summary.idle ?? 0)}
                  tone="muted"
                />
                <StatCard
                  label="Trans'da"
                  value={String(connReport?.summary.idle_in_transaction ?? 0)}
                  tone="amber"
                />
                <StatCard
                  label="Bekleyen"
                  value={String(connReport?.summary.waiting ?? 0)}
                  tone="red"
                />
                <StatCard
                  label="Kullanım"
                  value={`${(connReport?.summary.usage_percent ?? 0).toFixed(1)}%`}
                  tone="indigo"
                />
              </div>
              <DataTable
                columns={connCols}
                data={connData}
                isLoading={connLoading}
                emptyTitle="Bağlantı yok"
                emptyDesc="Aktif PostgreSQL bağlantısı bulunamadı."
                pageSize={connPS}
                setPageSize={setConnPS}
                globalFilter={connSearch}
                setGlobalFilter={setConnSearch}
                searchPlaceholder="PID, kullanıcı, DB, client ara..."
              />
            </TabsContent>

            <TabsContent value="active" className="mt-6">
              <DataTable
                columns={qCols()}
                data={aqData}
                isLoading={aqLoading}
                emptyTitle="Aktif sorgu yok"
                emptyDesc="Şu an çalışan sorgu bulunmuyor."
                pageSize={aqPS}
                setPageSize={setAqPS}
                globalFilter={aqSearch}
                setGlobalFilter={setAqSearch}
                searchPlaceholder="PID, kullanıcı, sorgu ara..."
              />
            </TabsContent>

            <TabsContent value="long" className="mt-6">
              <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex items-start gap-3">
                <Clock className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-400">
                    5 dakikadan uzun çalışan sorgular
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {lrData.length} adet uzun çalışan sorgu bulundu. Performans etkisi için optimize edin.
                  </p>
                </div>
              </div>
              <DataTable
                columns={qCols()}
                data={lrData}
                isLoading={lrLoading}
                emptyTitle="Uzun sorgu yok"
                emptyDesc="Harika — 5dk eşiğini aşan sorgu yok."
                pageSize={lrPS}
                setPageSize={setLrPS}
                globalFilter={lrSearch}
                setGlobalFilter={setLrSearch}
                searchPlaceholder="PID, kullanıcı, sorgu ara..."
              />
            </TabsContent>

            <TabsContent value="locks" className="mt-6">
              <div className="mb-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatCard
                  label="Toplam Kilit"
                  value={String(locksReport?.summary.total_locks ?? 0)}
                  tone="indigo"
                />
                <StatCard
                  label="Bekleyen"
                  value={String(locksReport?.summary.waiting_locks ?? 0)}
                  tone="amber"
                />
                <StatCard
                  label="Bloke Çift"
                  value={String(locksReport?.summary.blocking_pairs ?? 0)}
                  tone="red"
                />
              </div>
              <DataTable
                columns={lockCols}
                data={locksData}
                isLoading={locksLoading}
                emptyTitle="Kilit sorunu yok"
                emptyDesc="Bekleyen veya blok eden kilit bulunmadı."
                pageSize={locksPS}
                setPageSize={setLocksPS}
                globalFilter={locksSearch}
                setGlobalFilter={setLocksSearch}
                searchPlaceholder="PID, ilişki, kilit türü ara..."
              />
            </TabsContent>

            <TabsContent value="storage" className="mt-6">
              <DataTable
                columns={storageCols}
                data={storageData.sort(
                  (a, b) => (b.total_size_bytes ?? 0) - (a.total_size_bytes ?? 0)
                )}
                isLoading={storageLoading}
                emptyTitle="Tablo bulunamadı"
                emptyDesc="Depolama raporunda tablo yok."
                pageSize={storagePS}
                setPageSize={setStoragePS}
                globalFilter={storageSearch}
                setGlobalFilter={setStorageSearch}
                searchPlaceholder="Tablo adı, şema ara..."
              />
            </TabsContent>

            <TabsContent value="indexes" className="mt-6">
              <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5 flex items-start gap-3">
                <Database className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">İndeks durumu</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Toplam {idxData.length} indeks ·{" "}
                    <span className="text-amber-400">
                      {idxData.filter((i) => i.potentially_unused).length} adedi
                      kullanılmamış olabilir
                    </span>{" "}
                    · REINDEX önermeden önce kullanımı gözlemleyin.
                  </p>
                </div>
              </div>
              <DataTable
                columns={idxCols}
                data={idxData}
                isLoading={idxLoading}
                emptyTitle="İndeks yok"
                emptyDesc="İndeks raporu boş."
                pageSize={idxPS}
                setPageSize={setIdxPS}
                globalFilter={idxSearch}
                setGlobalFilter={setIdxSearch}
                searchPlaceholder="İndeks / tablo adı ara..."
              />
            </TabsContent>

            <TabsContent value="maintenance" className="mt-6">
              <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Canlı Tuples"
                  value={formatNumber(maintReport?.summary.total_live_tuples ?? 0)}
                  tone="emerald"
                />
                <StatCard
                  label="Ölü Tuples"
                  value={formatNumber(maintReport?.summary.total_dead_tuples ?? 0)}
                  tone="red"
                />
                <StatCard
                  label="Dead %"
                  value={`${(maintReport?.summary.dead_tuple_percent ?? 0).toFixed(2)}%`}
                  tone="amber"
                />
                <StatCard
                  label="Hiç VACUUM Olmayan"
                  value={String(maintReport?.summary.tables_never_vacuumed ?? 0)}
                  tone="indigo"
                />
              </div>
              <DataTable
                columns={maintCols}
                data={maintData}
                isLoading={maintLoading && bloatLoading}
                emptyTitle="Bakım önerisi yok"
                emptyDesc="Tabloların dead tuple oranı düşük."
                pageSize={maintPS}
                setPageSize={setMaintPS}
                globalFilter={maintSearch}
                setGlobalFilter={setMaintSearch}
                searchPlaceholder="Tablo adı ara..."
              />
            </TabsContent>

            <TabsContent value="pgss" className="mt-6">
              <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5 flex items-start gap-3">
                <ListOrdered className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">pg_stat_statements — Top sorgular</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Toplam çalışma süresine göre sıralanmış en yüksek maliyetli sorgular.
                    Uzun süreli performans analizi için kullanın.
                  </p>
                </div>
              </div>
              <DataTable
                columns={pgssCols}
                data={pgssData}
                isLoading={pgssLoading}
                emptyTitle="pg_stat_statements yüklenemedi"
                emptyDesc="Eklenti etkin mi? pg_stat_statements yüklü olmalı."
                pageSize={pgssPS}
                setPageSize={setPgssPS}
                globalFilter={pgssSearch}
                setGlobalFilter={setPgssSearch}
                searchPlaceholder="QueryID veya sorgu içinde ara..."
              />
            </TabsContent>

            <TabsContent value="sequences" className="mt-6">
              <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 flex items-start gap-3">
                <Hash className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-red-400">
                    Sequence Cycle Riski
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    %90+ olanlar DANGEROUS — nextval hatası (sequence exhausted)
                    almadan ALTER SEQUENCE ile MAXVALUE artırın.
                  </p>
                </div>
              </div>
              <DataTable
                columns={seqCols}
                data={seqData.sort(
                  (a, b) =>
                    Number(b.exhaustion_percent ?? 0) -
                    Number(a.exhaustion_percent ?? 0)
                )}
                isLoading={seqLoading}
                emptyTitle="Sequence bulunamadı"
                emptyDesc="Sequence listesi boş."
                pageSize={seqPS}
                setPageSize={setSeqPS}
                globalFilter={seqSearch}
                setGlobalFilter={setSeqSearch}
                searchPlaceholder="Sequence adı ara..."
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

type Tone = "emerald" | "muted" | "amber" | "red" | "indigo" | "purple";

const toneMap: Record<Tone, string> = {
  emerald: "from-emerald-500/15 to-emerald-500/0 text-emerald-400 border-emerald-500/20",
  muted: "from-white/10 to-white/0 text-muted-foreground border-white/10",
  amber: "from-amber-500/15 to-amber-500/0 text-amber-400 border-amber-500/20",
  red: "from-red-500/15 to-red-500/0 text-red-400 border-red-500/20",
  indigo: "from-indigo-500/15 to-indigo-500/0 text-indigo-400 border-indigo-500/20",
  purple: "from-purple-500/15 to-purple-500/0 text-purple-400 border-purple-500/20",
};

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div
      className={`relative rounded-2xl border bg-gradient-to-br ${toneMap[tone]} p-5 overflow-hidden`}
    >
      <div className="relative">
        <p className="text-[11px] uppercase tracking-wider font-semibold opacity-75">
          {label}
        </p>
        <p className="text-2xl font-bold mt-2">{value}</p>
      </div>
    </div>
  );
}
