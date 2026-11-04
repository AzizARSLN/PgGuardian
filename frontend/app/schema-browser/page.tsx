'use client';

import * as React from 'react';
import Link from 'next/link';
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
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Database,
  RotateCcw,
  Table2,
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
import { useI18n, useT } from '@/lib/i18n';
import { cn, formatBytes } from '@/lib/utils';

const TABLE_LIMIT = 5000;

function tableHref(schema: string, table: string): string {
  return `/schema-browser/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
}

export default function SchemaBrowserPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const router = useRouter();
  const [selectedSchema, setSelectedSchema] = React.useState<string | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'table_name', desc: false }]);

  const schemasQuery = useQuery({
    queryKey: qk.schemas.all(),
    queryFn: endpoints.listSchemas,
  });

  const tablesQuery = useQuery({
    queryKey: qk.schemas.tables(selectedSchema ?? '__none__', TABLE_LIMIT),
    queryFn: () =>
      selectedSchema
        ? endpoints.listTables(encodeURIComponent(selectedSchema), TABLE_LIMIT)
        : Promise.resolve([]),
    enabled: !!selectedSchema,
  });

  // Also re-picks when the selected schema is gone, e.g. after a profile switch.
  React.useEffect(() => {
    const schemas = schemasQuery.data;
    if (!schemas || schemas.length === 0) return;
    if (selectedSchema && schemas.some((s) => s.name === selectedSchema)) return;
    const nonSystem = schemas.find((s) => !s.is_system);
    setSelectedSchema(nonSystem?.name ?? schemas[0].name);
  }, [schemasQuery.data, selectedSchema]);

  const userSchemas = React.useMemo(
    () => (schemasQuery.data ?? []).filter((s) => !s.is_system),
    [schemasQuery.data]
  );
  const systemSchemas = React.useMemo(
    () => (schemasQuery.data ?? []).filter((s) => s.is_system),
    [schemasQuery.data]
  );

  const totals = React.useMemo(() => {
    const rows = tablesQuery.data ?? [];
    return {
      size: rows.reduce((sum, r) => sum + (r.total_size_bytes ?? 0), 0),
      live: rows.reduce((sum, r) => sum + (r.live_tuples ?? 0), 0),
      dead: rows.reduce((sum, r) => sum + (r.dead_tuples ?? 0), 0),
    };
  }, [tablesQuery.data]);

  const columns = React.useMemo<ColumnDef<TableSummary>[]>(
    () => [
      {
        accessorKey: 'table_name',
        header: t('schemaBrowser.columns.table'),
        cell: ({ row }) => (
          <Link
            href={tableHref(row.original.schema_name, row.original.table_name)}
            onClick={(e) => e.stopPropagation()}
            className="font-mono font-medium text-foreground hover:underline"
          >
            {row.original.table_name}
          </Link>
        ),
      },
      {
        accessorKey: 'owner',
        header: t('schemaBrowser.columns.owner'),
        size: 140,
        cell: ({ getValue }) => (
          <span className="block truncate font-mono text-muted-foreground">
            {getValue<string | null | undefined>() ?? '-'}
          </span>
        ),
      },
      {
        accessorKey: 'total_size_bytes',
        header: t('schemaBrowser.columns.size'),
        size: 110,
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground">{formatBytes(getValue<number>() ?? 0)}</span>
        ),
      },
      {
        accessorKey: 'live_tuples',
        header: t('schemaBrowser.columns.liveRows'),
        size: 110,
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground">{formatNumber(getValue<number>() ?? 0)}</span>
        ),
      },
      {
        accessorKey: 'dead_tuple_percent',
        header: t('schemaBrowser.columns.deadPercent'),
        size: 110,
        cell: ({ getValue }) => {
          const v = getValue<number>() ?? 0;
          return (
            <span
              className={cn(
                'font-mono',
                v >= 20 ? 'text-destructive' : v >= 10 ? 'text-warning' : 'text-success'
              )}
            >
              {formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 32,
        enableSorting: false,
        cell: () => <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />,
      },
    ],
    [t, formatNumber]
  );

  const table = useReactTable({
    data: tablesQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize: 25 } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-5rem)]">
      <div className="shrink-0">
        <h1 className="text-lg font-semibold text-foreground">{t('schemaBrowser.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('schemaBrowser.subtitle')}</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        <Card className="col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-3">
          <CardHeader className="shrink-0 border-b border-border !px-3 !py-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-3.5 w-3.5 text-info" />
              {t('schemaBrowser.schemas.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('schemaBrowser.schemas.counts', {
                user: formatNumber(userSchemas.length),
                system: formatNumber(systemSchemas.length),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !p-1.5">
            {schemasQuery.isLoading && (
              <div className="p-2 text-xs text-muted-foreground">{t('common.loading')}</div>
            )}
            {schemasQuery.isError && (
              <InlineError error={schemasQuery.error} onRetry={() => schemasQuery.refetch()} />
            )}
            {schemasQuery.data?.length === 0 && (
              <div className="p-2 text-xs text-muted-foreground">{t('common.noData')}</div>
            )}
            {userSchemas.length > 0 && (
              <div className="space-y-px">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('schemaBrowser.schemas.user')}
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
              <div className="space-y-px">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('schemaBrowser.schemas.system')}
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

        <div className="col-span-12 flex min-h-0 flex-col gap-3 lg:col-span-9">
          <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label={t('schemaBrowser.stats.tables')}
              value={formatNumber(tablesQuery.data?.length ?? 0)}
            />
            <Stat label={t('schemaBrowser.stats.size')} value={formatBytes(totals.size)} />
            <Stat label={t('schemaBrowser.stats.liveRows')} value={formatNumber(totals.live)} />
            <Stat label={t('schemaBrowser.stats.deadRows')} value={formatNumber(totals.dead)} />
          </div>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-b border-border !px-3 !py-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Table2 className="h-3.5 w-3.5 text-info" />
                  {selectedSchema && <span className="font-mono">{selectedSchema}</span>}
                  <span>{t('schemaBrowser.tables.title')}</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  {tablesQuery.data?.length === TABLE_LIMIT
                    ? t('schemaBrowser.tables.limitReached', { limit: formatNumber(TABLE_LIMIT) })
                    : t('schemaBrowser.tables.hint')}
                </CardDescription>
              </div>
              {tablesQuery.isFetching && (
                <Badge variant="outline" className="text-xs">
                  {t('common.loading')}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden !p-0">
              {tablesQuery.isError ? (
                <div className="shrink-0 p-2">
                  <InlineError error={tablesQuery.error} onRetry={() => tablesQuery.refetch()} />
                </div>
              ) : (
                <div className="min-h-0 flex-1 [&>div]:h-full">
                  <UITable>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      {table.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id}>
                          {hg.headers.map((h) => {
                            const sorted = h.column.getIsSorted();
                            return (
                              <TableHead
                                key={h.id}
                                style={{ width: h.getSize() }}
                                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                                className="h-7 whitespace-nowrap px-2 text-xs font-semibold"
                              >
                                {h.column.getCanSort() ? (
                                  <button
                                    type="button"
                                    onClick={h.column.getToggleSortingHandler()}
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                  >
                                    {flexRender(h.column.columnDef.header, h.getContext())}
                                    {sorted === 'asc' && <ArrowUp className="h-3 w-3" />}
                                    {sorted === 'desc' && <ArrowDown className="h-3 w-3" />}
                                  </button>
                                ) : (
                                  flexRender(h.column.columnDef.header, h.getContext())
                                )}
                              </TableHead>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow
                          key={r.id}
                          onClick={() => router.push(tableHref(r.original.schema_name, r.original.table_name))}
                          className="cursor-pointer hover:bg-muted"
                        >
                          {r.getVisibleCells().map((c) => (
                            <TableCell
                              key={c.id}
                              style={{ width: c.column.getSize() }}
                              className="px-2 py-1.5 text-xs"
                            >
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={columns.length} className="py-6 text-center text-xs text-muted-foreground">
                            {tablesQuery.isLoading
                              ? t('common.loading')
                              : selectedSchema
                                ? t('schemaBrowser.tables.empty')
                                : t('schemaBrowser.tables.selectSchema')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </UITable>
                </div>
              )}
              {table.getPageCount() > 1 && (
                <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5">
                  <div className="font-mono text-xs text-muted-foreground">
                    {t('schemaBrowser.pagination.page', {
                      page: formatNumber(table.getState().pagination.pageIndex + 1),
                      total: formatNumber(table.getPageCount()),
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                    >
                      {t('schemaBrowser.pagination.previous')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                    >
                      {t('schemaBrowser.pagination.next')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function InlineError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-destructive">{t('common.loadFailed')}</span>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onRetry}>
          <RotateCcw className="h-3 w-3" />
          {t('common.retry')}
        </Button>
      </div>
      {error instanceof Error && error.message && (
        <p className="mt-1 break-words font-mono text-muted-foreground">{error.message}</p>
      )}
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
      aria-pressed={selected}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left transition-colors',
        selected ? 'border-info/30 bg-info/10' : 'border-transparent hover:bg-muted'
      )}
    >
      <ChevronRight
        className={cn('h-3.5 w-3.5 shrink-0 transition-transform', selected && 'rotate-90 text-success')}
      />
      <Database
        className={cn('h-3.5 w-3.5 shrink-0', !muted && selected ? 'text-info' : 'text-muted-foreground')}
      />
      <span
        className={cn(
          'flex-1 truncate font-mono text-xs font-medium',
          selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
        )}
      >
        {schema.name}
      </span>
      {schema.owner && !muted && (
        <span className="max-w-[80px] truncate font-mono text-[10px] text-muted-foreground">
          {schema.owner}
        </span>
      )}
    </button>
  );
}
