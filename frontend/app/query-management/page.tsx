'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, ArrowUp, Power, RefreshCw, Skull } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RiskBadge } from '@/components/ui/risk-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { IfWriter } from '@/components/role-guard';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  endpoints,
  type BackendActionResult,
  type DryRunResult,
  type QueryInfo,
  type QueryReport,
} from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useI18n, useT, type TFunction } from '@/lib/i18n';
import { useUIPrefsStore } from '@/store/useUIPrefsStore';

interface EnrichedQuery extends QueryInfo {
  from_long_running?: boolean;
}

const LONG_RUNNING_MIN_SECONDS = 60;
const DANGEROUS_SECONDS = 300;
const METRIC = 'font-mono tabular-nums';

function formatSeconds(seconds: number, t: TFunction): string {
  if (!Number.isFinite(seconds) || seconds < 1) return t('liveQueries.units.second', { n: '<1' });
  const s = Math.floor(seconds);
  const values = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
  const labels = [
    t('liveQueries.units.day', { n: values[0] }),
    t('liveQueries.units.hour', { n: values[1] }),
    t('liveQueries.units.minute', { n: values[2] }),
    t('liveQueries.units.second', { n: values[3] }),
  ];
  const first = values.findIndex((v) => v > 0);
  return labels.slice(first, first + 2).join(' ');
}

function mergeQueries(active?: QueryReport, longRunning?: QueryReport): EnrichedQuery[] {
  const map = new Map<number, EnrichedQuery>();
  for (const q of active?.queries ?? []) {
    if (q.pid) map.set(q.pid, { ...q });
  }
  for (const q of longRunning?.queries ?? []) {
    if (q.pid) map.set(q.pid, { ...map.get(q.pid), ...q, from_long_running: true });
  }
  return Array.from(map.values());
}

function stateVariant(state: string): 'OK' | 'WARNING' | 'INFO' {
  const s = state.toLowerCase();
  if (s === 'idle in transaction' || s.includes('aborted')) return 'WARNING';
  if (s.includes('active')) return 'OK';
  return 'INFO';
}

function isActionResult(data: DryRunResult | BackendActionResult): data is BackendActionResult {
  return 'signal_sent' in data;
}

export default function QueryManagementPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const refetchInterval = autoRefresh ? pollInterval : false;
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'duration_seconds', desc: true },
  ]);

  const activeQuery = useQuery({
    queryKey: qk.diagnostics.queries.active(100),
    queryFn: () => endpoints.getActiveQueries(100),
    refetchInterval,
    refetchOnWindowFocus: true,
  });

  const longRunningQuery = useQuery({
    queryKey: qk.diagnostics.queries.longRunning(LONG_RUNNING_MIN_SECONDS, 100),
    queryFn: () => endpoints.getLongRunningQueries(LONG_RUNNING_MIN_SECONDS, 100),
    refetchInterval,
    refetchOnWindowFocus: true,
  });

  const rows = React.useMemo(
    () => mergeQueries(activeQuery.data, longRunningQuery.data),
    [activeQuery.data, longRunningQuery.data]
  );

  const counts = React.useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((r) => (r.state ?? '').toLowerCase() === 'active').length,
      longRunning: rows.filter((r) => (r.duration_seconds ?? 0) >= LONG_RUNNING_MIN_SECONDS).length,
      dangerous: rows.filter((r) => (r.duration_seconds ?? 0) >= DANGEROUS_SECONDS).length,
    }),
    [rows]
  );

  const notifyResult = (
    data: DryRunResult | BackendActionResult,
    pid: number,
    sentKey: string
  ) => {
    queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() });
    if (isActionResult(data) && !data.signal_sent) {
      toast.warning(t('liveQueries.toast.notSent', { pid }));
    } else if (isActionResult(data)) {
      toast.success(t(sentKey), { description: `PID ${pid}` });
    } else {
      toast.info(t('liveQueries.toast.dryRun', { risk: data.risk }), { description: data.note });
    }
  };

  // Failures are toasted by the API client.
  const { mutate: cancelBackend, isPending: cancelling } = useMutation({
    mutationFn: (pid: number) => endpoints.cancelBackend(pid, { confirm: true }),
    onSuccess: (data, pid) => notifyResult(data, pid, 'liveQueries.toast.cancelSent'),
  });

  // The backend rejects terminate unless confirm_name equals the PID.
  const { mutate: terminateBackend, isPending: terminating } = useMutation({
    mutationFn: (pid: number) =>
      endpoints.terminateBackend(pid, { confirm: true, confirm_name: String(pid) }),
    onSuccess: (data, pid) => notifyResult(data, pid, 'liveQueries.toast.terminateSent'),
  });

  const handleCancel = React.useCallback(
    async (row: EnrichedQuery) => {
      const sql = row.query ?? '';
      const ok = await confirm({
        title: t('liveQueries.confirm.cancelTitle', { pid: row.pid }),
        description: t('liveQueries.confirm.cancelDesc', {
          query: sql.length > 140 ? `${sql.slice(0, 140)}...` : sql,
        }),
        risk_level: 'MAINTENANCE',
        confirm_label: t('liveQueries.actions.cancel'),
        cancel_label: t('common.cancel'),
        sql_preview: [`SELECT pg_cancel_backend(${row.pid});`],
      });
      if (ok) cancelBackend(row.pid);
    },
    [confirm, cancelBackend, t]
  );

  const handleTerminate = React.useCallback(
    async (row: EnrichedQuery) => {
      const ok = await confirm({
        title: t('liveQueries.confirm.terminateTitle', { pid: row.pid }),
        description: t('liveQueries.confirm.terminateDesc'),
        risk_level: 'DANGEROUS',
        confirm_name_required: true,
        confirm_name_value: String(row.pid),
        confirm_name_placeholder: t('liveQueries.confirm.typePid', { pid: row.pid }),
        confirm_label: t('liveQueries.actions.terminate'),
        cancel_label: t('common.cancel'),
        sql_preview: [`SELECT pg_terminate_backend(${row.pid});`],
      });
      if (ok) terminateBackend(row.pid);
    },
    [confirm, terminateBackend, t]
  );

  const columns = React.useMemo<ColumnDef<EnrichedQuery>[]>(
    () => [
      {
        accessorKey: 'pid',
        header: () => 'PID',
        size: 70,
        cell: ({ row }) => (
          <span className={`${METRIC} font-semibold text-foreground`}>{row.original.pid}</span>
        ),
      },
      {
        accessorKey: 'query',
        header: () => t('liveQueries.columns.query'),
        cell: ({ row }) => {
          const dangerous = (row.original.duration_seconds ?? 0) >= DANGEROUS_SECONDS;
          return (
            <div className="flex max-w-[560px] items-start gap-1.5">
              {dangerous && (
                <RiskBadge riskLevel="DANGEROUS" size="sm" showIcon={false} className="mt-0.5 shrink-0">
                  {t('liveQueries.dangerousBadge')}
                </RiskBadge>
              )}
              <code className="line-clamp-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground hover:line-clamp-none">
                {row.original.query || t('liveQueries.emptyQuery')}
              </code>
            </div>
          );
        },
      },
      {
        accessorKey: 'duration_seconds',
        header: () => t('liveQueries.columns.duration'),
        size: 90,
        sortingFn: (a, b) =>
          (a.original.duration_seconds ?? 0) - (b.original.duration_seconds ?? 0),
        cell: ({ row }) => {
          const s = row.original.duration_seconds ?? 0;
          return (
            <Badge
              variant="outline"
              className={cn(
                `${METRIC} px-1.5 py-0 text-[11px]`,
                s >= DANGEROUS_SECONDS
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : s >= LONG_RUNNING_MIN_SECONDS
                    ? 'border-warning/40 bg-warning/10 text-warning'
                    : 'border-success/30 bg-success/10 text-success'
              )}
            >
              {formatSeconds(s, t)}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'state',
        header: () => t('liveQueries.columns.state'),
        size: 120,
        cell: ({ row }) => {
          const state = row.original.state ?? 'unknown';
          return (
            <RiskBadge riskLevel={stateVariant(state)} size="sm" showIcon={false}>
              {state}
            </RiskBadge>
          );
        },
      },
      {
        accessorKey: 'database',
        header: () => t('liveQueries.columns.database'),
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">{row.original.database ?? '-'}</span>
        ),
      },
      {
        accessorKey: 'user',
        header: () => t('liveQueries.columns.user'),
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">{row.original.user ?? '-'}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <IfWriter>{t('liveQueries.columns.actions')}</IfWriter>,
        size: 170,
        enableSorting: false,
        cell: ({ row }) => (
          <IfWriter>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCancel(row.original)}
                disabled={cancelling}
                className="h-6 border-warning/40 px-1.5 text-[11px] text-warning hover:bg-warning/10"
              >
                <Power className="mr-1 h-3 w-3" />
                {t('liveQueries.actions.cancel')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleTerminate(row.original)}
                disabled={terminating}
                className="h-6 border-destructive/40 px-1.5 text-[11px] text-destructive hover:bg-destructive/10"
              >
                <Skull className="mr-1 h-3 w-3" />
                {t('liveQueries.actions.terminate')}
              </Button>
            </div>
          </IfWriter>
        ),
      },
    ],
    [handleCancel, handleTerminate, cancelling, terminating, t]
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const isFetching = activeQuery.isFetching || longRunningQuery.isFetching;
  const isLoading = activeQuery.isLoading || longRunningQuery.isLoading;
  const failed = activeQuery.isError ? activeQuery : longRunningQuery.isError ? longRunningQuery : null;
  const refetchAll = () => {
    activeQuery.refetch();
    longRunningQuery.refetch();
  };
  const failedMessage = failed?.error instanceof Error ? failed.error.message : '';

  const tiles = [
    { label: t('liveQueries.tiles.total'), value: counts.total, tone: 'text-foreground' },
    { label: t('liveQueries.tiles.active'), value: counts.active, tone: 'text-success' },
    { label: t('liveQueries.tiles.longRunning'), value: counts.longRunning, tone: 'text-warning' },
    { label: t('liveQueries.tiles.dangerous'), value: counts.dangerous, tone: 'text-destructive' },
  ];

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('liveQueries.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('liveQueries.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${METRIC} text-[11px] text-muted-foreground`}>
            {autoRefresh
              ? t('liveQueries.polling', { seconds: formatNumber(pollInterval / 1000) })
              : t('liveQueries.pollingOff')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refetchAll}
            disabled={isFetching}
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', isFetching && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-md border border-border bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            {isLoading ? (
              <Skeleton className="mt-1 h-5 w-12" />
            ) : (
              <p className={cn(METRIC, 'text-base font-semibold', failed ? 'text-muted-foreground' : tile.tone)}>
                {failed ? '-' : formatNumber(tile.value)}
              </p>
            )}
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2">
          <h2 className="font-mono text-xs font-semibold text-foreground">pg_stat_activity</h2>
          <p className="text-[11px] text-muted-foreground">{t('liveQueries.tableHint')}</p>
        </header>
        {failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="font-medium text-foreground">{t('common.loadFailed')}</span>
            {failedMessage && (
              <span className="min-w-0 truncate text-muted-foreground">{failedMessage}</span>
            )}
            <Button variant="outline" size="sm" onClick={refetchAll} className="h-6 px-2 text-xs">
              {t('common.retry')}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-1.5 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('liveQueries.empty')}</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <UITable className="text-xs">
              <TableHeader className="sticky top-0 z-10 bg-card">
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
                          style={{ width: h.getSize() }}
                          aria-sort={
                            sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
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
                              {sorted === 'asc' && <ArrowUp className="h-3 w-3" />}
                              {sorted === 'desc' && <ArrowDown className="h-3 w-3" />}
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
                {table.getRowModel().rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn(
                      (r.original.duration_seconds ?? 0) >= DANGEROUS_SECONDS &&
                        'border-l-2 border-l-destructive/60 bg-destructive/5'
                    )}
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
              </TableBody>
            </UITable>
          </div>
        )}
      </section>
    </div>
  );
}
