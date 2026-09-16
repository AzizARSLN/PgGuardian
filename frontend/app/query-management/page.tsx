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
import {
  Activity,
  Clock,
  Users,
  AlertTriangle,
  Power,
  Skull,
  RefreshCw,
  User,
  Server,
  CircleDot,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RiskBadge } from '@/components/ui/risk-badge';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { endpoints, type QueryInfo, type QueryReport, type DryRunResult, type BackendActionResult } from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { cn, formatInterval, formatDate, formatDuration } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';

interface EnrichedQuery extends QueryInfo {
  from_long_running?: boolean;
}

const POLL_INTERVAL = 5000;
const LONG_RUNNING_THRESHOLD_SEC = 300; // 5 dakika

function mergeQueries(active?: QueryReport, longRunning?: QueryReport): EnrichedQuery[] {
  const map = new Map<number, EnrichedQuery>();
  if (active?.queries) {
    for (const q of active.queries) {
      if (q.pid) map.set(q.pid, { ...q });
    }
  }
  if (longRunning?.queries) {
    for (const q of longRunning.queries) {
      const existing = map.get(q.pid);
      if (existing) {
        map.set(q.pid, { ...existing, ...q, from_long_running: true });
      } else if (q.pid) {
        map.set(q.pid, { ...q, from_long_running: true });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const aDur = a.duration_seconds ?? 0;
    const bDur = b.duration_seconds ?? 0;
    return bDur - aDur;
  });
}

function stateVariant(state?: string | null) {
  const s = (state ?? '').toLowerCase();
  if (s.includes('active')) return 'OK';
  if (s.includes('idle')) return 'INFO';
  if (s.includes('wait') || s.includes('block')) return 'WARNING';
  return 'INFO';
}

export default function QueryManagementPage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'duration_seconds', desc: true },
  ]);

  const activeQuery = useQuery({
    queryKey: qk.diagnostics.queries.active(100),
    queryFn: () => endpoints.getActiveQueries(100),
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });

  const longRunningQuery = useQuery({
    queryKey: qk.diagnostics.queries.longRunning(60, 100),
    queryFn: () => endpoints.getLongRunningQueries(60, 100),
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });

  const rows = React.useMemo(
    () => mergeQueries(activeQuery.data, longRunningQuery.data),
    [activeQuery.data, longRunningQuery.data]
  );

  const counts = React.useMemo(() => {
    const total = rows.length;
    const longRunningCount = rows.filter(
      (r) => (r.duration_seconds ?? 0) >= LONG_RUNNING_THRESHOLD_SEC
    ).length;
    const activeCount = rows.filter((r) =>
      (r.state ?? '').toLowerCase().includes('active')
    ).length;
    return { total, longRunningCount, activeCount };
  }, [rows]);

  const cancelMutation = useMutation({
    mutationFn: (pid: number) =>
      endpoints.cancelBackend(pid, { confirm: true }),
    onSuccess: (data, pid) => {
      queryClient.invalidateQueries({ queryKey: ['diagnostics', 'queries'] as unknown[] });
      if (data && 'signal_sent' in data) {
        const r = data as BackendActionResult;
        toast.success(r.signal_sent ? 'Cancel sinyali gönderildi' : 'Cancel başarılı', {
          description: `PID ${r.pid}`,
        });
      } else if (data && 'risk' in data) {
        const d = data as DryRunResult;
        toast.info(`Dry Run: ${d.risk}`, { description: d.note });
      }
    },
  });

  const terminateMutation = useMutation({
    mutationFn: (pid: number) =>
      endpoints.terminateBackend(pid, { confirm: true }),
    onSuccess: (data, pid) => {
      queryClient.invalidateQueries({ queryKey: ['diagnostics', 'queries'] as unknown[] });
      if (data && 'signal_sent' in data) {
        const r = data as BackendActionResult;
        toast.success(r.signal_sent ? 'Terminate sinyali gönderildi' : 'Terminate başarılı', {
          description: `PID ${r.pid}`,
        });
      } else if (data && 'risk' in data) {
        const d = data as DryRunResult;
        toast.info(`Dry Run: ${d.risk}`, { description: d.note });
      }
    },
  });

  const handleCancel = React.useCallback(async function handleCancel(row: EnrichedQuery) {
    const ok = await confirm({
      title: `Sorgu iptal edilsin mi? PID ${row.pid}`,
      description: `SIGINT gönderilecektir. İşlem: "${(row.query ?? '').slice(0, 140)}${(row.query ?? '').length > 140 ? '...' : ''}"`,
      risk_level: 'MAINTENANCE',
      confirm_label: 'Cancel Gönder',
      cancel_label: 'Vazgeç',
    });
    if (ok) cancelMutation.mutate(row.pid);
  }, [confirm, cancelMutation]);

  const handleTerminate = React.useCallback(async function handleTerminate(row: EnrichedQuery) {
    const ok = await confirm({
      title: `Sorgu sonlandırılsın mı? PID ${row.pid}`,
      description: `SIGTERM gönderilecektir. Bu işlem bağlantıyı keser ve aktif transaction'ı rollback eder. Geri alınamaz.`,
      risk_level: 'DANGEROUS',
      confirm_name_required: true,
      confirm_name_value: String(row.pid),
      confirm_label: 'Terminate Et',
      cancel_label: 'Vazgeç',
    });
    if (ok) terminateMutation.mutate(row.pid);
  }, [confirm, terminateMutation]);

  const columns = React.useMemo<ColumnDef<EnrichedQuery>[]>(
    () => [
      {
        accessorKey: 'pid',
        header: 'PID',
        size: 90,
        cell: ({ getValue }) => (
          <span className="font-mono font-semibold text-white">
            {String(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: 'query',
        header: 'Sorgu',
        cell: ({ getValue, row }) => {
          const q = getValue<string | null | undefined>() ?? '';
          const dangerous =
            (row.original.duration_seconds ?? 0) >= LONG_RUNNING_THRESHOLD_SEC;
          return (
            <div className="flex items-start gap-2 max-w-[440px]">
              {dangerous && (
                <RiskBadge riskLevel="DANGEROUS" size="sm" className="shrink-0 mt-0.5">
                  5dk+
                </RiskBadge>
              )}
              <code className="text-xs font-mono text-zinc-300 whitespace-pre-wrap line-clamp-2 hover:line-clamp-none transition-all">
                {q || '<boş sorgu>'}
              </code>
            </div>
          );
        },
      },
      {
        accessorKey: 'duration_seconds',
        header: 'Süre',
        size: 120,
        sortingFn: (a, b) =>
          (a.original.duration_seconds ?? 0) - (b.original.duration_seconds ?? 0),
        cell: ({ row }) => {
          const s = row.original.duration_seconds ?? 0;
          const dangerous = s >= LONG_RUNNING_THRESHOLD_SEC;
          return (
            <Badge
              variant="outline"
              className={cn(
                'font-mono',
                dangerous
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : s >= 60
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              )}
            >
              <Clock className="h-3 w-3 mr-1" />
              {formatInterval(s)}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'state',
        header: 'Durum',
        size: 130,
        cell: ({ getValue }) => {
          const s = getValue<string | null | undefined>() ?? 'unknown';
          return (
            <div className="flex items-center gap-2">
              <CircleDot
                className={cn(
                  'h-3 w-3 shrink-0',
                  s.toLowerCase().includes('active')
                    ? 'text-emerald-400 animate-pulse'
                    : s.toLowerCase().includes('wait')
                      ? 'text-amber-400'
                      : 'text-zinc-500'
                )}
              />
              <RiskBadge riskLevel={stateVariant(s) as any} size="sm" showIcon={false}>
                {s}
              </RiskBadge>
            </div>
          );
        },
      },
      {
        accessorKey: 'client_address',
        header: 'İstemci',
        size: 140,
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-mono text-xs text-zinc-300">
              {getValue<string | null | undefined>() ?? '-'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'user',
        header: 'Kullanıcı',
        size: 130,
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-sm text-zinc-300 truncate">
              {getValue<string | null | undefined>() ?? '-'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'query_start',
        header: 'Başlangıç',
        size: 150,
        cell: () => {
          // query_start QueryInfo tipinde yok, duration'dan hesapla
          return null;
        },
      },
      {
        id: 'actions',
        header: 'İşlemler',
        size: 170,
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCancel(r)}
                disabled={cancelMutation.isPending}
                className="h-9 px-3 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              >
                <Power className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleTerminate(r)}
                disabled={terminateMutation.isPending}
                className="h-9 px-3 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                <Skull className="h-3.5 w-3.5 mr-1" />
                Terminate
              </Button>
            </div>
          );
        },
      },
    ],
    [handleCancel, handleTerminate, cancelMutation.isPending, terminateMutation.isPending]
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="space-y-8">
      <ConfirmDialog />
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Canlı Sorgu Yönetimi</h1>
          <p className="text-muted-foreground mt-1">
            Aktif sorgular · 5sn poll · Cancel / Terminate işlemleri
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="px-4 py-2 text-sm bg-black/30 gap-2"
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5',
                activeQuery.isFetching || longRunningQuery.isFetching
                  ? 'animate-spin text-emerald-400'
                  : 'text-muted-foreground'
              )}
            />
            5sn polling
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="h-1.5 w-20 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 mb-4" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Toplam</p>
                <p className="text-3xl font-bold text-white">{counts.total}</p>
              </div>
              <Activity className="h-8 w-8 text-indigo-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="h-1.5 w-20 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 mb-4" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Aktif</p>
                <p className="text-3xl font-bold text-white">{counts.activeCount}</p>
              </div>
              <Users className="h-8 w-8 text-emerald-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="h-1.5 w-20 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 mb-4" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Uzun Çalışan (1dk+)
                </p>
                <p className="text-3xl font-bold text-white">
                  {longRunningQuery.data?.queries?.length ?? 0}
                </p>
              </div>
              <Clock className="h-8 w-8 text-amber-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="h-1.5 w-20 rounded-full bg-gradient-to-r from-red-500 to-rose-500 mb-4" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  DANGEROUS (5dk+)
                </p>
                <p className="text-3xl font-bold text-white">
                  {counts.longRunningCount}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-3">
              <Activity className="h-6 w-6 text-gradient" />
              pg_stat_activity
            </CardTitle>
            <CardDescription>
              En uzun süreden kısa süreyiye sıralı · Aktif bağlantılar
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              activeQuery.refetch();
              longRunningQuery.refetch();
            }}
          >
            <RefreshCw
              className={cn(
                'h-4 w-4 mr-1.5',
                activeQuery.isFetching && 'animate-spin'
              )}
            />
            Yenile
          </Button>
        </CardHeader>
        <CardContent className="!p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
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
                {table.getRowModel().rows.map((r) => {
                  const isDangerous =
                    (r.original.duration_seconds ?? 0) >= LONG_RUNNING_THRESHOLD_SEC;
                  return (
                    <TableRow
                      key={r.id}
                      className={cn(
                        isDangerous &&
                          'border-l-4 border-l-red-500/60 bg-red-500/5'
                      )}
                    >
                      {r.getVisibleCells().map((c) => (
                        <TableCell
                          key={c.id}
                          style={{ width: c.column.getSize() }}
                          className="py-4"
                        >
                          {flexRender(
                            c.column.columnDef.cell,
                            c.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {table.getRowModel().rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-center py-16 text-muted-foreground"
                    >
                      {activeQuery.isLoading || longRunningQuery.isLoading
                        ? 'Yükleniyor...'
                        : 'Aktif sorgu bulunamadı'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </UITable>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
