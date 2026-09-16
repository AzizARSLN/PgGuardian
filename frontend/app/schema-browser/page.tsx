'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  Database,
  Table2,
  ArrowRight,
  ChevronRight,
  HardDrive,
  User,
  Bug,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { endpoints, type SchemaInfo, type TableSummary } from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { cn, formatBytes, formatNumber } from '@/lib/utils';

export default function SchemaBrowserPage() {
  const router = useRouter();
  const [selectedSchema, setSelectedSchema] = React.useState<string | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'table_name', desc: false },
  ]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const schemasQuery = useQuery({
    queryKey: qk.schemas.all(),
    queryFn: endpoints.listSchemas,
  });

  const tablesQuery = useQuery({
    queryKey: qk.schemas.tables(selectedSchema ?? '__none__', 1000),
    queryFn: () =>
      selectedSchema ? endpoints.listTables(selectedSchema, 1000) : Promise.resolve([]),
    enabled: !!selectedSchema,
  });

  React.useEffect(() => {
    if (!selectedSchema && schemasQuery.data && schemasQuery.data.length > 0) {
      const nonSystem = schemasQuery.data.find((s) => !s.is_system);
      setSelectedSchema(nonSystem?.name ?? schemasQuery.data[0].name);
    }
  }, [schemasQuery.data, selectedSchema]);

  const userSchemas = React.useMemo(
    () => (schemasQuery.data ?? []).filter((s) => !s.is_system),
    [schemasQuery.data]
  );
  const systemSchemas = React.useMemo(
    () => (schemasQuery.data ?? []).filter((s) => s.is_system),
    [schemasQuery.data]
  );

  const columns = React.useMemo<ColumnDef<TableSummary>[]>(
    () => [
      {
        accessorKey: 'table_name',
        header: 'Tablo Adı',
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500/20 to-emerald-500/20 border border-indigo-500/20 flex items-center justify-center shrink-0">
              <Table2 className="h-4 w-4 text-gradient" />
            </div>
            <span className="font-semibold text-white">{getValue<string>()}</span>
          </div>
        ),
      },
      {
        accessorKey: 'owner',
        header: 'Sahip',
        size: 140,
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-violet-400 shrink-0" />
            <span className="text-sm text-zinc-300 truncate">
              {getValue<string | null | undefined>() ?? '-'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'total_size_bytes',
        header: 'Boyut',
        size: 130,
        sortingFn: (a, b) =>
          (a.original.total_size_bytes ?? 0) - (b.original.total_size_bytes ?? 0),
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="font-mono text-sm text-zinc-300">
              {formatBytes(getValue<number>() ?? 0)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'live_tuples',
        header: 'Canlı Satır',
        size: 140,
        sortingFn: (a, b) =>
          (a.original.live_tuples ?? 0) - (b.original.live_tuples ?? 0),
        cell: ({ getValue }) => (
          <span className="font-mono text-sm text-zinc-300">
            {formatNumber(getValue<number>() ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: 'dead_tuple_percent',
        header: 'Bloat %',
        size: 130,
        sortingFn: (a, b) =>
          (a.original.dead_tuple_percent ?? 0) - (b.original.dead_tuple_percent ?? 0),
        cell: ({ getValue }) => {
          const v = getValue<number>() ?? 0;
          const critical = v >= 20;
          const warn = v >= 10 && v < 20;
          return (
            <Badge
              variant="outline"
              className={cn(
                'font-mono',
                critical
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : warn
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              )}
            >
              <Bug className="h-3 w-3 mr-1" />
              {v.toFixed(1)}%
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 90,
        enableSorting: false,
        cell: () => (
          <div className="flex justify-end">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: tablesQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    state: { sorting, rowSelection },
    initialState: {
      pagination: { pageSize: 25 },
    },
  });

  function goToDetail(row: TableSummary) {
    router.push(`/schema-browser/${encodeURIComponent(row.schema_name)}/${encodeURIComponent(row.table_name)}`);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Şema Tarayıcı</h1>
        <p className="text-muted-foreground mt-1">
          Şemalar · Tablolar · Bloat · Boyut analizleri
        </p>
      </div>

      <div className="grid grid-cols-12 gap-6" style={{ minHeight: 720 }}>
        <Card className="col-span-12 lg:col-span-3 overflow-hidden flex flex-col">
          <CardHeader className="!p-5 border-b border-white/10">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5 text-gradient" />
              Şemalar
            </CardTitle>
            <CardDescription>
              {userSchemas.length} kullanıcı · {systemSchemas.length} sistem
            </CardDescription>
          </CardHeader>
          <CardContent className="!p-3 flex-1 overflow-y-auto space-y-3">
            {schemasQuery.isLoading && (
              <div className="text-sm text-muted-foreground p-3">
                Şemalar yükleniyor...
              </div>
            )}
            {schemasQuery.error && (
              <div className="text-sm text-red-400 p-3">
                Şemalar yüklenemedi
              </div>
            )}
            {userSchemas.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Kullanıcı Şemaları
                </div>
                {userSchemas.map((s) => (
                  <SchemaItem
                    key={s.name}
                    schema={s}
                    selected={selectedSchema === s.name}
                    onClick={() => setSelectedSchema(s.name)}
                  />
                ))}
              </div>
            )}
            {systemSchemas.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sistem Şemaları
                </div>
                {systemSchemas.map((s) => (
                  <SchemaItem
                    key={s.name}
                    schema={s}
                    selected={selectedSchema === s.name}
                    onClick={() => setSelectedSchema(s.name)}
                    muted
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-9 overflow-hidden flex flex-col">
          <CardHeader className="!p-5 border-b border-white/10 flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-3">
                <Table2 className="h-5 w-5 text-gradient" />
                {selectedSchema ? `${selectedSchema} · Tablolar` : 'Tablolar'}
              </CardTitle>
              <CardDescription>
                {(tablesQuery.data?.length ?? 0)} tablo · Detay için satıra tıkla
              </CardDescription>
            </div>
            <div className="text-xs">
              {tablesQuery.isFetching && (
                <Badge variant="outline" className="bg-black/30">
                  Yükleniyor...
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="!p-0 flex-1 flex flex-col overflow-hidden">
            <div className="overflow-x-auto flex-1">
              <UITable>
                <TableHeader className="sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id}>
                      {hg.headers.map((h) => (
                        <TableHead
                          key={h.id}
                          style={{ width: h.getSize() }}
                          className="text-xs font-semibold whitespace-nowrap"
                        >
                          {h.isPlaceholder
                            ? null
                            : flexRender(
                                h.column.columnDef.header,
                                h.getContext()
                              )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((r) => (
                    <TableRow
                      key={r.id}
                      data-state={r.getIsSelected() && 'selected'}
                      onClick={() => goToDetail(r.original)}
                      className="cursor-pointer hover:bg-white/10"
                    >
                      {r.getVisibleCells().map((c) => (
                        <TableCell
                          key={c.id}
                          style={{ width: c.column.getSize() }}
                          className="py-3.5"
                        >
                          {flexRender(
                            c.column.columnDef.cell,
                            c.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {table.getRowModel().rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="text-center py-16 text-muted-foreground"
                      >
                        {tablesQuery.isLoading
                          ? 'Tablolar yükleniyor...'
                          : selectedSchema
                            ? 'Şemada tablo bulunamadı'
                            : 'Lütfen bir şema seçin'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </UITable>
            </div>
            {table.getPageCount() > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                <div className="text-xs text-muted-foreground">
                  Sayfa {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    Önceki
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SchemaItem({
  schema,
  selected,
  onClick,
  muted,
}: {
  schema: SchemaInfo;
  selected: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors group',
        selected
          ? 'bg-gradient-to-r from-indigo-500/20 to-emerald-500/10 border border-indigo-500/30'
          : 'hover:bg-white/5 border border-transparent'
      )}
    >
      <ChevronRight
        className={cn(
          'h-4 w-4 shrink-0 transition-transform',
          selected && 'rotate-90 text-emerald-400'
        )}
      />
      <Database
        className={cn(
          'h-4 w-4 shrink-0',
          muted ? 'text-zinc-500' : selected ? 'text-indigo-400' : 'text-zinc-400'
        )}
      />
      <span
        className={cn(
          'text-sm font-medium truncate flex-1',
          selected
            ? 'text-white'
            : muted
              ? 'text-zinc-500'
              : 'text-zinc-300 group-hover:text-white'
        )}
      >
        {schema.name}
      </span>
      {schema.owner && !muted && (
        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[80px]">
          {schema.owner}
        </span>
      )}
    </button>
  );
}
