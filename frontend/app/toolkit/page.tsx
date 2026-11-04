"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
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
  ChartColumn,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  HardDrive,
  Info,
  ListChecks,
  ListOrdered,
  Loader2,
  Lock,
  Play,
  Puzzle,
  Recycle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Table2,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/types";
import type {
  BackendActionResult,
  DryRunResult,
  MaintenanceActionResult,
  ToolkitAdvice,
  ToolkitCell,
  ToolkitParam,
  ToolkitQuery,
  ToolkitRisk,
  ToolkitRunResult,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirm, type ConfirmOptions } from "@/lib/hooks/useConfirm";
import { OpBlockedHint, OpStopButton, useOpControl, type OpControl } from "@/lib/hooks/use-op-control";
import { cn } from "@/lib/utils";
import { useI18n, useT } from "@/lib/i18n";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Recycle,
  ChartColumn,
  Database,
  Settings2,
  ListOrdered,
  HardDrive,
  Save,
  Users,
  Lock,
  Clock,
  Activity,
};

const PRE = "rounded-md bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap break-words";

/** Long mutations (VACUUM/REINDEX) routinely outlive the default request timeout. */
const LONG_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
/** Cap the SQL preview shown in the batch confirmation so a big selection stays fast. */
const BATCH_PREVIEW_LIMIT = 10;

type AdviceBatchStatus = "pending" | "running" | "ok" | "failed" | "stopped";

interface AdviceBatchRow {
  key: string;
  label: string;
  status: AdviceBatchStatus;
  detail: string;
}

type AdviceResult = DryRunResult | MaintenanceActionResult | BackendActionResult;

/** Route one advice + resolved body to the guarded backend endpoint. */
function runAdviceRequest(
  advice: ToolkitAdvice,
  body: Record<string, unknown>,
  options: { timeout?: number; skipToast?: boolean; opId?: string; signal?: AbortSignal } = {}
): Promise<AdviceResult> {
  switch (advice.action) {
    case "vacuum":
      return api.post<AdviceResult>("/maintenance/vacuum", body, options);
    case "analyze":
      return api.post<AdviceResult>("/maintenance/analyze", body, options);
    case "reindex":
      return api.post<AdviceResult>("/maintenance/reindex", body, options);
    case "cancel":
      return api.post<AdviceResult>(`/queries/${body.pid}/cancel`, { confirm: true }, options);
    case "terminate":
      return api.post<AdviceResult>(
        `/queries/${body.pid}/terminate`,
        { confirm: true, confirm_name: String(body.pid) },
        options
      );
    case "drop_index":
      return api.post<AdviceResult>(
        "/maintenance/drop-index",
        { ...body, confirm_name: String(body.index_name) },
        options
      );
    default:
      throw new Error("unsupported action");
  }
}

/** Human label for a batch target row (prefers schema.table when present). */
function rowLabel(row: ResultRow, columns: string[]): string {
  const schema = columns.indexOf("schemaname");
  const table = columns.indexOf("tablo");
  if (table >= 0) {
    const prefix = schema >= 0 && row.values[schema] ? `${row.values[schema]}.` : "";
    return `${prefix}${row.values[table]}`;
  }
  const parts = columns
    .slice(0, 2)
    .map((_, i) => row.values[i])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
  return parts.join(" · ") || `#${row.index + 1}`;
}

/** Default values for a query's declared parameters (used before any edit). */
function defaultParamValues(query: ToolkitQuery): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of query.params) values[param.name] = String(param.default);
  return values;
}

/** Substitute `{name}` tokens so the operator sees the statement that will run. */
function renderParamTokens(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, name: string) => values[name] ?? match);
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ToolkitParam;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-medium text-foreground">
        {param.label}
        {param.unit ? <span className="text-muted-foreground"> ({param.unit})</span> : null}
      </span>
      {param.kind === "int" ? (
        <Input
          type="number"
          inputMode="numeric"
          min={param.minimum ?? undefined}
          max={param.maximum ?? undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={param.label}
          className="h-8 text-xs"
        />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs" aria-label={param.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {param.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {param.description && (
        <span className="block text-[10px] text-muted-foreground">{param.description}</span>
      )}
    </div>
  );
}

interface ResultRow {
  index: number;
  values: ToolkitCell[];
}

function adviceRiskLevel(risk: ToolkitRisk): RiskLevel {
  return risk === "READ" ? "INFO" : risk;
}

function renderCell(value: ToolkitCell) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }
  if (typeof value === "boolean") {
    return <span className={value ? "text-success" : "text-muted-foreground"}>{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="font-mono tabular-nums">{value}</span>;
  }
  const text = String(value);
  const long = text.length > 60;
  return (
    <span
      className={cn("block max-w-[380px] truncate font-mono text-[11px]", long && "cursor-help")}
      title={long ? text : undefined}
    >
      {text}
    </span>
  );
}

/** Advice SQL placeholders ({schema}/{table}/{index}/{pid}) mapped to result columns. */
function adviceColumns(advice: ToolkitAdvice): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, column] of Object.entries(advice.target_fields)) {
    map[field.replace(/_name$/, "")] = column;
  }
  return map;
}

function fillAdviceSql(
  advice: ToolkitAdvice,
  row: ResultRow | null,
  columns: string[]
): string {
  const map = adviceColumns(advice);
  return advice.sql_preview.replace(/\{(\w+)\}/g, (match, key: string) => {
    const column = map[key];
    if (!column || !row) return match;
    const idx = columns.indexOf(column);
    if (idx < 0) return match;
    const value = row.values[idx];
    return value === null || value === undefined ? match : String(value);
  });
}

interface ResolvedBody {
  body?: Record<string, unknown>;
  missing?: string;
}

function resolveAdviceBody(
  advice: ToolkitAdvice,
  row: ResultRow | null,
  columns: string[]
): ResolvedBody {
  const body: Record<string, unknown> = { confirm: true, ...advice.static_body };
  for (const [field, column] of Object.entries(advice.target_fields)) {
    const idx = columns.indexOf(column);
    const value = idx >= 0 && row ? row.values[idx] : null;
    if (value === null || value === undefined || value === "") {
      return { missing: field };
    }
    body[field] = value;
  }
  return { body };
}

function describeTarget(body: Record<string, unknown>): string {
  if (body.index_name) return `${body.schema_name}.${body.index_name}`;
  if (body.table_name) return `${body.schema_name}.${body.table_name}`;
  if (body.pid !== undefined) return `PID ${body.pid}`;
  return "";
}

function toCsv(columns: string[], rows: ToolkitCell[][]): string {
  const escape = (value: ToolkitCell) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return `\ufeff${lines.join("\r\n")}`;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type PageSize = 10 | 25 | 50;

function ResultTable({
  result,
  loading,
  selected,
  onToggle,
  onToggleAll,
}: {
  result: ToolkitRunResult | null;
  loading: boolean;
  /** Ordered row indices currently selected for batch advice. */
  selected: number[];
  onToggle: (index: number) => void;
  onToggleAll: (indices: number[], select: boolean) => void;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const rows = useMemo<ResultRow[]>(
    () => (result?.rows ?? []).map((values, index) => ({ index, values })),
    [result]
  );

  const columns = useMemo<ColumnDef<ResultRow>[]>(() => {
    const selectColumn: ColumnDef<ResultRow> = {
      id: "__select",
      header: () => null,
      enableSorting: false,
      enableGlobalFilter: false,
      size: 32,
      cell: ({ row }) => (
        <Checkbox
          aria-label={t("toolkit.selectRow")}
          checked={selectedSet.has(row.original.index)}
          onCheckedChange={() => onToggle(row.original.index)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
    };
    const dataColumns: ColumnDef<ResultRow>[] = (result?.columns ?? []).map((name, i) => ({
      id: `c${i}`,
      accessorFn: (row: ResultRow) => row.values[i],
      header: () => name,
      cell: ({ getValue }) => renderCell(getValue() as ToolkitCell),
    }));
    return [selectColumn, ...dataColumns];
  }, [result, selectedSet, onToggle, t]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    // A column whose first row is null must stay searchable.
    getColumnCanGlobalFilter: () => true,
    autoResetPageIndex: false,
    state: { sorting, globalFilter },
    initialState: { pagination: { pageSize: 25 } },
  });

  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const filteredCount = table.getFilteredRowModel().rows.length;
  const filteredIndices = table.getFilteredRowModel().rows.map((row) => row.original.index);
  const allFilteredSelected =
    filteredIndices.length > 0 && filteredIndices.every((index) => selectedSet.has(index));
  const someFilteredSelected = filteredIndices.some((index) => selectedSet.has(index));

  if (loading) {
    return (
      <div className="space-y-1.5 rounded-md border border-border p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border px-3 py-6 text-center">
        <p className="text-xs font-medium text-foreground">{t("toolkit.emptyTitle")}</p>
        <p className="text-[11px] text-muted-foreground">{t("toolkit.emptyDesc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={globalFilter}
          onChange={(event) => {
            setGlobalFilter(event.target.value);
            table.setPageIndex(0);
          }}
          placeholder={t("table.search")}
          aria-label={t("table.search")}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  if (header.column.id === "__select") {
                    return (
                      <TableHead
                        key={header.id}
                        className="h-8 w-8 whitespace-nowrap px-2 py-1.5 text-xs font-semibold"
                      >
                        <Checkbox
                          aria-label={t("toolkit.selectAll")}
                          checked={
                            allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false
                          }
                          onCheckedChange={(value) => onToggleAll(filteredIndices, value === true)}
                        />
                      </TableHead>
                    );
                  }
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                      className="h-8 whitespace-nowrap px-2 py-1.5 text-xs font-semibold"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
                          {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const isSelected = selectedSet.has(row.original.index);
              return (
                <TableRow
                  key={row.id}
                  data-state={isSelected ? "selected" : undefined}
                  onClick={() => onToggle(row.original.index)}
                  title={t("toolkit.selectHint")}
                  className={cn(
                    "cursor-pointer",
                    isSelected && "bg-guardian-lime/10 hover:bg-guardian-lime/15"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-2 py-1.5 text-xs">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {t("table.summary", {
              page: pageIndex + 1,
              pages: Math.max(1, pageCount),
              total: formatNumber(filteredCount),
            })}
          </span>
          <span>{t("table.perPage")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value) as PageSize)}
          >
            <SelectTrigger
              className="h-7 w-[64px] rounded-md text-xs"
              aria-label={t("table.perPage")}
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
            {t("table.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-7 px-2 text-xs"
          >
            {t("table.next")}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdviceCard({
  advice,
  columns,
  row,
  selectedCount,
  busy,
  batchBusy,
  control,
  batchControl,
  onApply,
  onApplyBatch,
}: {
  advice: ToolkitAdvice;
  columns: string[];
  row: ResultRow | null;
  /** How many result rows are selected (drives the batch action). */
  selectedCount: number;
  busy: boolean;
  batchBusy: boolean;
  control: OpControl;
  batchControl: OpControl;
  onApply: (advice: ToolkitAdvice) => void;
  onApplyBatch: (advice: ToolkitAdvice) => void;
}) {
  const t = useT();
  const sql = useMemo(() => fillAdviceSql(advice, row, columns), [advice, row, columns]);
  const copyOnly = advice.action === "copy";
  const batch = selectedCount > 1;
  const busyAny = busy || batchBusy;

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      toast.success(t("toolkit.adviceCopied"));
    } catch {
      toast.error(t("toolkit.runFailed"));
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{advice.title}</p>
          <p className="text-[11px] text-muted-foreground">{advice.description}</p>
        </div>
        <RiskBadge riskLevel={adviceRiskLevel(advice.risk)} size="sm" />
      </div>

      <pre className={PRE}>{sql}</pre>

      {advice.requires && (
        <p className="flex items-start gap-1 text-[11px] text-warning">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{advice.requires}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copySql} className="h-7 px-2 text-xs">
          <Copy className="h-3 w-3" />
          {t("toolkit.copyAdvice")}
        </Button>
        {copyOnly ? (
          <Badge variant="outline" size="sm" className="text-muted-foreground">
            {t("toolkit.copyOnly")}
          </Badge>
        ) : (
          <>
            <Button
              variant={batch ? "outline" : "default"}
              size="sm"
              onClick={() => onApply(advice)}
              disabled={busyAny || selectedCount === 0}
              className="h-7 px-2 text-xs"
            >
              {busy ? t("toolkit.applying") : t("toolkit.apply")}
            </Button>
            {batch && (
              <Button
                size="sm"
                onClick={() => onApplyBatch(advice)}
                disabled={busyAny}
                className="h-7 px-2 text-xs"
              >
                {batchBusy ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <ListChecks className="mr-1 h-3 w-3" />
                )}
                {t("toolkit.applyToSelected", { count: selectedCount })}
              </Button>
            )}
            <OpStopButton control={control} className="h-7 px-2 text-xs" />
            <OpStopButton control={batchControl} className="h-7 px-2 text-xs" />
          </>
        )}
      </div>

      <OpBlockedHint control={control} className="mt-2" />
      <OpBlockedHint control={batchControl} className="mt-2" />
    </div>
  );
}

function AdviceBatchStatusBadge({ status }: { status: AdviceBatchStatus }) {
  const t = useT();
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("toolkit.batchStatusOk")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        {t("toolkit.batchStatusFailed")}
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Square className="h-3.5 w-3.5" />
        {t("toolkit.batchStatusStopped")}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("toolkit.batchStatusRunning")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5" />
      {t("toolkit.batchStatusPending")}
    </span>
  );
}

export default function ToolkitPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  // Tracks a running catalog query / advice so it can be stopped.
  const op = useOpControl();
  // The batch run loops over many rows, so it tracks its own operation.
  const batchOp = useOpControl();

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [batchRows, setBatchRows] = useState<AdviceBatchRow[] | null>(null);
  const [result, setResult] = useState<ToolkitRunResult | null>(null);

  const catalogQ = useQuery({
    queryKey: qk.toolkit.catalog(),
    queryFn: () => endpoints.getToolkitCatalog(),
    staleTime: 5 * 60 * 1000,
  });

  const categories = catalogQ.data?.categories ?? [];
  const queries = catalogQ.data?.queries ?? [];

  const filteredQueries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return queries.filter((query) => {
      if (activeCategory && query.category !== activeCategory) return false;
      if (!needle) return true;
      return (
        query.title.toLocaleLowerCase().includes(needle) ||
        query.description.toLocaleLowerCase().includes(needle) ||
        query.id.toLocaleLowerCase().includes(needle)
      );
    });
  }, [queries, activeCategory, search]);

  const activeQuery: ToolkitQuery | null = useMemo(
    () => queries.find((query) => query.id === activeId) ?? null,
    [queries, activeId]
  );

  const renderedSql = useMemo(
    () => (activeQuery ? renderParamTokens(activeQuery.sql, paramValues) : ""),
    [activeQuery, paramValues]
  );

  const currentResult = result && result.id === activeId ? result : null;
  const resultColumns = currentResult?.columns ?? [];
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // The most recently clicked row drives the single-row advice preview.
  const focusedIndex = selected.length > 0 ? selected[selected.length - 1] : null;
  const selectedRow: ResultRow | null = useMemo(() => {
    if (!currentResult || focusedIndex === null) return null;
    const values = currentResult.rows[focusedIndex];
    return values ? { index: focusedIndex, values } : null;
  }, [currentResult, focusedIndex]);
  const allRowIndices = useMemo(
    () => (currentResult?.rows ?? []).map((_, index) => index),
    [currentResult]
  );

  const toggleRow = (index: number) =>
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
    );

  const toggleAllRows = (indices: number[], select: boolean) =>
    setSelected((prev) =>
      select
        ? Array.from(new Set([...prev, ...indices]))
        : prev.filter((item) => !indices.includes(item))
    );

  const { mutate: runQuery, isPending: running } = useMutation({
    mutationFn: ({ query, params }: { query: ToolkitQuery; params: Record<string, string> }) => {
      const handle = op.begin("toolkit");
      return endpoints.runToolkitQuery(query.id, query.max_rows, params, {
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setSelected([]);
    },
    onError: (error) => {
      // 499 is our own client abort ("Durdur"); stay quiet.
      if (error instanceof ApiError && error.status === 499) return;
    },
    onSettled: () => op.end(),
  });

  const { mutate: applyAdvice, isPending: applying, variables } = useMutation({
    mutationFn: ({
      advice,
      body,
    }: {
      advice: ToolkitAdvice;
      body: Record<string, unknown>;
    }): Promise<AdviceResult> => {
      const handle = op.begin("toolkit");
      return runAdviceRequest(advice, body, { opId: handle.opId, signal: handle.signal });
    },
    onSuccess: (_data, { advice, body }) => {
      toast.success(t("toolkit.applied"), {
        description: t("toolkit.appliedDesc", {
          action: advice.title,
          target: describeTarget(body),
        }),
      });
      queryClient.invalidateQueries({ queryKey: qk.toolkit.all() });
      if (activeQuery) runQuery({ query: activeQuery, params: paramValues });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 499) return;
    },
    onSettled: () => op.end(),
  });

  // One request per selected row: the API is single-scope, so progress is
  // reported per row to keep a long run over many tables observable.
  const {
    mutate: applyAdviceBatch,
    isPending: applyingBatch,
    variables: batchVariables,
  } = useMutation({
    mutationFn: async ({
      advice,
      targets,
    }: {
      advice: ToolkitAdvice;
      targets: ResultRow[];
    }) => {
      const patch = (key: string, update: Partial<AdviceBatchRow>) =>
        setBatchRows((prev) =>
          prev ? prev.map((row) => (row.key === key ? { ...row, ...update } : row)) : prev
        );
      const markPendingStopped = () =>
        setBatchRows((prev) =>
          prev
            ? prev.map((row) => (row.status === "pending" ? { ...row, status: "stopped" } : row))
            : prev
        );

      setBatchRows(
        targets.map((row) => ({
          key: String(row.index),
          label: rowLabel(row, resultColumns),
          status: "pending" as AdviceBatchStatus,
          detail: "",
        }))
      );

      // A fresh op id tags every request in the run; aborting it (via "Durdur")
      // releases the in-flight request and ends the loop.
      const handle = batchOp.begin("batch");
      let ok = 0;
      let failed = 0;
      for (const row of targets) {
        if (handle.signal.aborted) {
          markPendingStopped();
          break;
        }
        const key = String(row.index);
        patch(key, { status: "running" });
        const { body, missing } = resolveAdviceBody(advice, row, resultColumns);
        if (!body) {
          failed += 1;
          patch(key, { status: "failed", detail: t("toolkit.targetMissing", { field: missing ?? "" }) });
          continue;
        }
        try {
          const response = await runAdviceRequest(advice, body, {
            timeout: LONG_ACTION_TIMEOUT_MS,
            skipToast: true,
            opId: handle.opId,
            signal: handle.signal,
          });
          ok += 1;
          const status = "command_status" in response ? response.command_status : "";
          patch(key, { status: "ok", detail: status ?? "" });
        } catch (error) {
          // 499 is our own client abort ("Durdur"), not a failure.
          if (error instanceof ApiError && error.status === 499) {
            patch(key, { status: "stopped" });
            markPendingStopped();
            break;
          }
          failed += 1;
          patch(key, {
            status: "failed",
            detail: error instanceof Error ? error.message : "",
          });
        }
      }
      return { ok, failed, stopped: targets.length - ok - failed };
    },
    onSuccess: ({ ok, failed, stopped }) => {
      if (stopped > 0) {
        toast.info(t("toolkit.batchStopped", { ok, failed }));
      } else {
        toast.success(t("toolkit.batchApplied"), {
          description: t("toolkit.batchSummary", { ok, failed }),
        });
      }
      queryClient.invalidateQueries({ queryKey: qk.toolkit.all() });
      if (activeQuery) runQuery({ query: activeQuery, params: paramValues });
    },
    onSettled: () => batchOp.end(),
  });

  const selectQuery = (id: string) => {
    const next = queries.find((query) => query.id === id) ?? null;
    setActiveId(id);
    setParamValues(next ? defaultParamValues(next) : {});
    setResult(null);
    setSelected([]);
    setBatchRows(null);
    setShowSql(false);
    setShowDetails(true);
  };

  const handleApply = async (advice: ToolkitAdvice) => {
    const { body, missing } = resolveAdviceBody(advice, selectedRow, resultColumns);
    if (!body) {
      toast.error(t("toolkit.targetMissing", { field: missing ?? "" }));
      return;
    }

    const sql = fillAdviceSql(advice, selectedRow, resultColumns);
    const options: ConfirmOptions = {
      title: t("toolkit.approvalTitle", { action: advice.title }),
      description: `${advice.description}\n\n${t("toolkit.approvalDesc")}`,
      sql_preview: [sql],
      risk_level: advice.risk === "DANGEROUS" ? "DANGEROUS" : "MAINTENANCE",
      confirm_label: t("toolkit.apply"),
      cancel_label: t("common.cancel"),
    };
    if (advice.action === "terminate") {
      options.confirm_name_required = true;
      options.confirm_name_value = String(body.pid);
      options.confirm_name_placeholder = String(body.pid);
      options.confirm_name_description = t("toolkit.approvalDesc");
    } else if (advice.action === "drop_index") {
      options.confirm_name_required = true;
      options.confirm_name_value = String(body.index_name);
      options.confirm_name_placeholder = String(body.index_name);
      options.confirm_name_description = t("toolkit.dropIndexConfirm");
    }

    if (await confirm(options)) {
      applyAdvice({ advice, body });
    }
  };

  const handleApplyBatch = async (advice: ToolkitAdvice) => {
    if (!currentResult) return;
    const targets = selected
      .map((index) => ({ index, values: currentResult.rows[index] }))
      .filter((item): item is { index: number; values: ToolkitCell[] } => Boolean(item.values))
      .map((item) => ({ index: item.index, values: item.values }));

    if (targets.length === 0) {
      toast.error(t("toolkit.selectRowFirst"));
      return;
    }

    // Show the SQL the API will actually run, bounded so a big selection stays fast.
    const previews = targets
      .slice(0, BATCH_PREVIEW_LIMIT)
      .map((row) => fillAdviceSql(advice, row, resultColumns));
    const extra =
      targets.length > BATCH_PREVIEW_LIMIT
        ? `\n${t("toolkit.andMore", { count: targets.length - BATCH_PREVIEW_LIMIT })}`
        : "";

    const options: ConfirmOptions = {
      title: t("toolkit.batchConfirmTitle", { count: targets.length, action: advice.title }),
      description: `${advice.description}\n\n${t("toolkit.approvalDesc")}${extra}`,
      sql_preview: previews,
      risk_level: advice.risk === "DANGEROUS" ? "DANGEROUS" : "MAINTENANCE",
      confirm_label: t("toolkit.applyToSelected", { count: targets.length }),
      cancel_label: t("common.cancel"),
    };

    // Dangerous batch runs need the target count typed back, mirroring single-row safety.
    if (advice.risk === "DANGEROUS") {
      options.confirm_name_required = true;
      options.confirm_name_value = String(targets.length);
      options.confirm_name_placeholder = String(targets.length);
      options.confirm_name_description = t("toolkit.batchConfirmNameDesc", { count: targets.length });
    }

    if (await confirm(options)) {
      applyAdviceBatch({ advice, targets });
    }
  };

  const copySql = async () => {
    if (!activeQuery) return;
    try {
      await navigator.clipboard.writeText(renderedSql);
      toast.success(t("toolkit.copied"));
    } catch {
      toast.error(t("toolkit.runFailed"));
    }
  };

  const exportResult = (kind: "csv" | "json") => {
    if (!currentResult || !activeQuery) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (kind === "csv") {
      downloadFile(
        `${activeQuery.id}-${stamp}.csv`,
        toCsv(currentResult.columns, currentResult.rows),
        "text/csv;charset=utf-8"
      );
    } else {
      downloadFile(
        `${activeQuery.id}-${stamp}.json`,
        JSON.stringify(
          { id: currentResult.id, columns: currentResult.columns, rows: currentResult.rows },
          null,
          2
        ),
        "application/json"
      );
    }
  };

  const selectedAdviceId = variables?.advice.id ?? null;
  const batchAdviceId = batchVariables?.advice.id ?? null;
  const batchDone = batchRows?.filter((row) => row.status === "ok" || row.status === "failed").length ?? 0;

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Puzzle className="h-4 w-4 text-info" />
            {t("toolkit.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("toolkit.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => catalogQ.refetch()}
          disabled={catalogQ.isFetching}
        >
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", catalogQ.isFetching && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Category + query picker */}
        <aside className="space-y-2 lg:sticky lg:top-3 lg:self-start">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("toolkit.searchQueries")}
              aria-label={t("toolkit.searchQueries")}
              className="h-8 pl-7 text-xs"
            />
          </div>

          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-xs font-medium transition-colors",
                activeCategory === null
                  ? "border-guardian-lime bg-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <ListOrdered className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">{t("toolkit.allCategories")}</span>
              <span className="tabular-nums text-[11px] text-muted-foreground">{queries.length}</span>
            </button>
            {categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.icon] ?? Puzzle;
              const isActive = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(isActive ? null : category.id)}
                  title={category.description}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-xs font-medium transition-colors",
                    isActive
                      ? "border-guardian-lime bg-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{category.title}</span>
                  <span className="tabular-nums text-[11px] text-muted-foreground">
                    {category.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-border pt-2">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("toolkit.queryCount", { count: filteredQueries.length })}
            </p>
            <div className="max-h-[420px] space-y-0.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-26rem)]">
              {catalogQ.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
              ) : filteredQueries.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">{t("table.emptyTitle")}</p>
              ) : (
                filteredQueries.map((query) => (
                  <button
                    key={query.id}
                    type="button"
                    onClick={() => selectQuery(query.id)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                      activeId === query.id
                        ? "bg-guardian-lime/15 text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {query.title}
                      </span>
                      {query.params.length > 0 && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-[10px] text-guardian-lavender"
                          title={t("toolkit.parameters")}
                        >
                          <SlidersHorizontal className="h-3 w-3" />
                          <span className="tabular-nums">{query.params.length}</span>
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {query.description}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Detail + results + advice */}
        <section className="min-w-0 space-y-3">
          {catalogQ.isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="font-medium text-foreground">{t("toolkit.catalogError")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => catalogQ.refetch()}
                className="h-6 px-2 text-xs"
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : !activeQuery ? (
            <div className="rounded-md border border-dashed border-border px-3 py-12 text-center">
              <Table2 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{t("toolkit.selectQuery")}</p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5 rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">{activeQuery.title}</h2>
                    <p className="text-[11px] text-muted-foreground">{activeQuery.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" size="sm">
                      {categories.find((c) => c.id === activeQuery.category)?.title ??
                        activeQuery.category}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDetails((value) => !value)}
                      className="h-6 px-1.5 text-[11px]"
                    >
                      <ChevronDown
                        className={cn(
                          "mr-1 h-3 w-3 transition-transform",
                          !showDetails && "-rotate-90"
                        )}
                      />
                      {showDetails ? t("toolkit.hideDetails") : t("toolkit.details")}
                    </Button>
                  </div>
                </div>

                {showDetails && (
                  <dl className="grid gap-x-6 gap-y-1 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] sm:grid-cols-2">
                    <MetaRow label={t("toolkit.metaId")}>
                      <span className="font-mono">{activeQuery.id}</span>
                    </MetaRow>
                    <MetaRow label={t("toolkit.metaCategory")}>
                      {categories.find((c) => c.id === activeQuery.category)?.title ??
                        activeQuery.category}
                    </MetaRow>
                    <MetaRow label={t("toolkit.metaMaxRows")}>
                      <span className="tabular-nums">{formatNumber(activeQuery.max_rows)}</span>
                    </MetaRow>
                    <MetaRow label={t("toolkit.metaExtension")}>
                      {activeQuery.requires_extension ? (
                        <span className="font-mono">{activeQuery.requires_extension}</span>
                      ) : (
                        <span className="text-muted-foreground">{t("toolkit.none")}</span>
                      )}
                    </MetaRow>
                    <MetaRow label={t("toolkit.metaAdvice")}>
                      <span className="tabular-nums">{formatNumber(activeQuery.advice.length)}</span>
                    </MetaRow>
                    <MetaRow label={t("toolkit.metaParams")}>
                      <span className="tabular-nums">{formatNumber(activeQuery.params.length)}</span>
                    </MetaRow>
                  </dl>
                )}

                {activeQuery.requires_extension && (
                  <p className="flex items-center gap-1 text-[11px] text-warning">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {t("toolkit.requiresExtension", { name: activeQuery.requires_extension })}
                  </p>
                )}
                {activeQuery.notes && (
                  <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{activeQuery.notes}</span>
                  </p>
                )}

                {activeQuery.params.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                        <SlidersHorizontal className="h-3 w-3" />
                        {t("toolkit.parameters")}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setParamValues(defaultParamValues(activeQuery))}
                        className="h-6 px-1.5 text-[11px]"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t("toolkit.resetParams")}
                      </Button>
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {activeQuery.params.map((param) => (
                        <ParamField
                          key={param.name}
                          param={param}
                          value={paramValues[param.name] ?? String(param.default)}
                          onChange={(value) =>
                            setParamValues((prev) => ({ ...prev, [param.name]: value }))
                          }
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("toolkit.parametersHint")}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => runQuery({ query: activeQuery, params: paramValues })}
                    disabled={running}
                    className="h-7 px-2 text-xs"
                  >
                    <Play className="h-3 w-3" />
                    {running ? t("toolkit.running") : t("toolkit.run")}
                  </Button>
                  <OpStopButton control={op} className="h-7 px-2 text-xs" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSql((value) => !value)}
                    className="h-7 px-2 text-xs"
                  >
                    {showSql ? t("toolkit.hideSql") : t("toolkit.showSql")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={copySql} className="h-7 px-2 text-xs">
                    <Copy className="h-3 w-3" />
                    {t("toolkit.copySql")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportResult("csv")}
                    disabled={!currentResult}
                    className="h-7 px-2 text-xs"
                  >
                    <Download className="h-3 w-3" />
                    {t("toolkit.downloadCsv")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportResult("json")}
                    disabled={!currentResult}
                    className="h-7 px-2 text-xs"
                  >
                    <Download className="h-3 w-3" />
                    {t("toolkit.downloadJson")}
                  </Button>

                  {currentResult && (
                    <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span>
                        {t("toolkit.duration")}:{" "}
                        <span className="tabular-nums text-foreground">
                          {formatNumber(currentResult.duration_ms)} ms
                        </span>
                      </span>
                      <span>
                        {t("toolkit.rows")}:{" "}
                        <span className="tabular-nums text-foreground">
                          {formatNumber(currentResult.row_count)}
                        </span>
                      </span>
                      <RiskBadge riskLevel="INFO" size="sm" showIcon={false}>
                        READ
                      </RiskBadge>
                    </div>
                  )}
                </div>

                {showSql && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("toolkit.renderedSql")}
                    </p>
                    <pre className={PRE}>{renderedSql}</pre>
                  </div>
                )}

                {currentResult?.truncated && (
                  <p className="text-[11px] text-warning">
                    {t("toolkit.truncated", { max: activeQuery.max_rows })}
                  </p>
                )}
              </div>

              {(currentResult || running) && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">{t("toolkit.results")}</p>
                    {currentResult && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular-nums text-[11px] text-muted-foreground">
                          {t("toolkit.selectedCount", { count: selected.length })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={() => toggleAllRows(allRowIndices, true)}
                          disabled={allRowIndices.length === 0}
                        >
                          {t("toolkit.selectAll")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={() => setSelected([])}
                          disabled={selected.length === 0}
                        >
                          {t("toolkit.clearSelection")}
                        </Button>
                      </div>
                    )}
                  </div>
                  <ResultTable
                    key={currentResult?.id ?? activeQuery.id}
                    result={currentResult}
                    loading={running}
                    selected={selected}
                    onToggle={toggleRow}
                    onToggleAll={toggleAllRows}
                  />
                </div>
              )}

              {batchRows && batchRows.length > 0 && (
                <div className="overflow-hidden rounded-md border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <ListChecks className="h-3.5 w-3.5 text-success" />
                        {t("toolkit.batchResultsTitle")}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {t("toolkit.batchResultsHint")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" size="sm" className="font-mono tabular-nums">
                        {applyingBatch
                          ? t("toolkit.batchRunning", { done: batchDone, total: batchRows.length })
                          : t("toolkit.batchProgress", { done: batchDone, total: batchRows.length })}
                      </Badge>
                      <OpStopButton control={batchOp} className="h-6 px-1.5 text-[11px]" />
                      {!applyingBatch && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={() => setBatchRows(null)}
                        >
                          <X className="mr-1 h-3 w-3" />
                          {t("toolkit.batchClear")}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-44 overflow-auto">
                    <Table className="text-xs">
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-7 px-2 py-1 text-xs font-semibold">
                            {t("toolkit.batchStatus")}
                          </TableHead>
                          <TableHead className="h-7 px-2 py-1 text-xs font-semibold">
                            {t("toolkit.batchTarget")}
                          </TableHead>
                          <TableHead className="h-7 px-2 py-1 text-xs font-semibold">
                            {t("toolkit.batchDetail")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {batchRows.map((row) => (
                          <TableRow key={row.key}>
                            <TableCell className="px-2 py-1">
                              <AdviceBatchStatusBadge status={row.status} />
                            </TableCell>
                            <TableCell className="px-2 py-1 font-mono">{row.label}</TableCell>
                            <TableCell className="px-2 py-1 font-mono text-muted-foreground">
                              {row.detail || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{t("toolkit.recommendations")}</p>
                  {activeQuery.advice.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {selected.length > 0
                        ? t("toolkit.selectedCount", { count: selected.length })
                        : t("toolkit.recommendationsHint")}
                    </p>
                  )}
                </div>

                {activeQuery.advice.length === 0 ? (
                  <p className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                    {t("toolkit.noRecommendations")}
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {activeQuery.advice.map((advice) => (
                      <AdviceCard
                        key={advice.id}
                        advice={advice}
                        columns={resultColumns}
                        row={selectedRow}
                        selectedCount={selected.length}
                        busy={applying && selectedAdviceId === advice.id}
                        batchBusy={applyingBatch && batchAdviceId === advice.id}
                        control={op}
                        batchControl={batchOp}
                        onApply={handleApply}
                        onApplyBatch={handleApplyBatch}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
