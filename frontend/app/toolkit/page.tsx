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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  HardDrive,
  Info,
  ListOrdered,
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
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { endpoints } from "@/lib/api/types";
import type {
  AnalyzeRequest,
  BackendActionResult,
  DropIndexRequest,
  DryRunResult,
  MaintenanceActionResult,
  ReindexRequest,
  ToolkitAdvice,
  ToolkitCell,
  ToolkitParam,
  ToolkitQuery,
  ToolkitRisk,
  ToolkitRunResult,
  VacuumRequest,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  selectedIndex,
  onSelect,
}: {
  result: ToolkitRunResult | null;
  loading: boolean;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const rows = useMemo<ResultRow[]>(
    () => (result?.rows ?? []).map((values, index) => ({ index, values })),
    [result]
  );

  const columns = useMemo<ColumnDef<ResultRow>[]>(
    () =>
      (result?.columns ?? []).map((name, i) => ({
        id: `c${i}`,
        accessorFn: (row: ResultRow) => row.values[i],
        header: () => name,
        cell: ({ getValue }) => renderCell(getValue() as ToolkitCell),
      })),
    [result]
  );

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
              const isSelected = selectedIndex === row.original.index;
              return (
                <TableRow
                  key={row.id}
                  onClick={() => onSelect(isSelected ? null : row.original.index)}
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
  busy,
  onApply,
}: {
  advice: ToolkitAdvice;
  columns: string[];
  row: ResultRow | null;
  busy: boolean;
  onApply: (advice: ToolkitAdvice) => void;
}) {
  const t = useT();
  const sql = useMemo(() => fillAdviceSql(advice, row, columns), [advice, row, columns]);
  const copyOnly = advice.action === "copy";

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
          <Button size="sm" onClick={() => onApply(advice)} disabled={busy} className="h-7 px-2 text-xs">
            {busy ? t("toolkit.applying") : t("toolkit.apply")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function ToolkitPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
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
  const selectedRow: ResultRow | null = useMemo(() => {
    if (!currentResult || selectedIndex === null) return null;
    const values = currentResult.rows[selectedIndex];
    return values ? { index: selectedIndex, values } : null;
  }, [currentResult, selectedIndex]);

  const { mutate: runQuery, isPending: running } = useMutation({
    mutationFn: ({ query, params }: { query: ToolkitQuery; params: Record<string, string> }) =>
      endpoints.runToolkitQuery(query.id, query.max_rows, params),
    onSuccess: (data) => {
      setResult(data);
      setSelectedIndex(null);
    },
  });

  const { mutate: applyAdvice, isPending: applying, variables } = useMutation({
    mutationFn: ({
      advice,
      body,
    }: {
      advice: ToolkitAdvice;
      body: Record<string, unknown>;
    }): Promise<DryRunResult | MaintenanceActionResult | BackendActionResult> => {
      switch (advice.action) {
        case "vacuum":
          return endpoints.runVacuum(body as unknown as VacuumRequest);
        case "analyze":
          return endpoints.runAnalyze(body as unknown as AnalyzeRequest);
        case "reindex":
          return endpoints.runReindex(body as unknown as ReindexRequest);
        case "cancel":
          return endpoints.cancelBackend(Number(body.pid), { confirm: true });
        case "terminate":
          return endpoints.terminateBackend(Number(body.pid), {
            confirm: true,
            confirm_name: String(body.pid),
          });
        case "drop_index":
          return endpoints.dropIndex({
            ...(body as unknown as DropIndexRequest),
            confirm_name: String(body.index_name),
          });
        default:
          throw new Error("unsupported action");
      }
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
  });

  const selectQuery = (id: string) => {
    const next = queries.find((query) => query.id === id) ?? null;
    setActiveId(id);
    setParamValues(next ? defaultParamValues(next) : {});
    setResult(null);
    setSelectedIndex(null);
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
                  <p className="text-xs font-semibold text-foreground">{t("toolkit.results")}</p>
                  <ResultTable
                    key={currentResult?.id ?? activeQuery.id}
                    result={currentResult}
                    loading={running}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{t("toolkit.recommendations")}</p>
                  {activeQuery.advice.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {selectedRow
                        ? `${t("toolkit.selectedRow")}: ${
                            resultColumns[0] ? `${resultColumns[0]}=${selectedRow.values[0]}` : "-"
                          }`
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
                        busy={applying && selectedAdviceId === advice.id}
                        onApply={handleApply}
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
