"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

type PageSize = 10 | 25 | 50;

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDesc?: string;
  defaultPageSize?: PageSize;
  globalFilter?: string;
  setGlobalFilter?: (v: string) => void;
  searchPlaceholder?: string;
  mobilePrimaryColumnIds?: string[];
  mobileSecondaryColumnIds?: string[];
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  emptyTitle = "Veri yok",
  emptyDesc = "Görüntülenecek kayıt bulunamadı.",
  defaultPageSize = 25,
  globalFilter: externalGlobalFilter,
  setGlobalFilter: externalSetGlobalFilter,
  searchPlaceholder = "Ara...",
  mobilePrimaryColumnIds,
  mobileSecondaryColumnIds,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [internalGF, setInternalGF] = React.useState("");
  const [pageSize, setPageSize] = React.useState<PageSize>(defaultPageSize);
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  const isMobile = !useMediaQuery("(min-width: 768px)");

  const globalFilter =
    externalGlobalFilter !== undefined ? externalGlobalFilter : internalGF;
  const setGlobalFilter = externalSetGlobalFilter ?? setInternalGF;

  const primaryIds = mobilePrimaryColumnIds ?? columns.slice(0, 2).map((c) => c.id as string);
  const secondaryIds = mobileSecondaryColumnIds ?? columns.slice(2).map((c) => c.id as string);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
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

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const colById = (id: string) => columns.find((c) => c.id === id);
  const allCols = columns;
  const desktopCols = allCols;
  const getCellByColId = (row: ReturnType<typeof table.getRowModel>["rows"][number], id: string) =>
    row.getAllCells().find((c) => c.column.id === id) ||
    row.getVisibleCells().find((c) => c.column.id === id);

  return (
    <div className={cn("space-y-5", className)}>
      <div className="relative w-full md:max-w-md">
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

      {isMobile ? (
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="h-4 w-1/3 bg-white/5 rounded animate-pulse" />
                  <div className="h-5 w-2/3 bg-white/5 rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-white/5 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <Card className="overflow-hidden">
              <CardContent className="p-12 text-center">
                <p className="font-semibold">{emptyTitle}</p>
                <p className="text-sm text-muted-foreground mt-1">{emptyDesc}</p>
              </CardContent>
            </Card>
          ) : (
            table.getRowModel().rows.map((row) => {
              const expanded = expandedRows.has(row.id);
              return (
                <Card key={row.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <button
                      onClick={() => toggleRow(row.id)}
                      className="w-full text-left p-4 flex items-start gap-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {primaryIds.map((pid) => {
                          const cell = getCellByColId(row, pid);
                          const col = colById(pid);
                          return (
                            <div key={pid} className="space-y-0.5">
                              {col?.header && typeof col.header === "string" && (
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                  {col.header}
                                </p>
                              )}
                              {cell && (
                                <div>
                                  {flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext()
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-5 w-5 shrink-0 mt-1 text-muted-foreground transition-transform",
                          expanded && "rotate-90"
                        )}
                      />
                    </button>
                    {expanded && secondaryIds.length > 0 && (
                      <div className="border-t border-white/5 p-4 space-y-3 bg-white/[0.02]">
                        {secondaryIds.map((sid) => {
                          const cell = getCellByColId(row, sid);
                          const col = colById(sid);
                          return (
                            <div key={sid} className="space-y-1">
                              {col?.header && typeof col.header === "string" && (
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                  {col.header}
                                </p>
                              )}
                              {cell && (
                                <div className="pl-1">
                                  {flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext()
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <div className="rounded-3xl overflow-hidden">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 select-none"
                        >
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext()
                          )}
                          <span className="opacity-70">
                            {h.column.getIsSorted() === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : h.column.getIsSorted() === "desc" ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 opacity-40" />
                            )}
                          </span>
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={desktopCols.length} className="p-6">
                    <div className="space-y-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-14 w-full bg-white/5 rounded animate-pulse" />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={desktopCols.length} className="p-16 text-center">
                    <p className="font-semibold">{emptyTitle}</p>
                    <p className="text-sm text-muted-foreground mt-1">{emptyDesc}</p>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <p className="text-muted-foreground">
              Sayfa{" "}
              <span className="font-semibold text-foreground">
                {currentPage + 1}
              </span>{" "}
              / {Math.max(1, pageCount)} · Toplam{" "}
              <span className="font-semibold text-foreground">{data.length}</span>{" "}
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
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
