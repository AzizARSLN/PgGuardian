'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ListFilter,
  Power,
  RefreshCw,
  Search,
  Skull,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  QueryInsightDialog,
  type QueryInsightTarget,
} from '@/components/query-insight/query-insight-dialog';
import { RiskBadge } from '@/components/ui/risk-badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  type SessionInfo,
  type SessionStateCount,
} from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useI18n, useT, type TFunction } from '@/lib/i18n';
import { useUIPrefsStore } from '@/store/useUIPrefsStore';

type StateGroup = 'active' | 'idleInTx' | 'idle' | 'none';

// Most urgent first: this is also the order of the buttons and the table sections.
const STATE_GROUPS: StateGroup[] = ['active', 'idleInTx', 'idle', 'none'];

const GROUP_TONE: Record<StateGroup, string> = {
  active: 'text-success',
  idleInTx: 'text-warning',
  idle: 'text-info',
  none: 'text-muted-foreground',
};

function stateGroup(state: string | null): StateGroup {
  if (state === 'active' || state === 'fastpath function call') return 'active';
  if (state?.startsWith('idle in transaction')) return 'idleInTx';
  if (state === 'idle') return 'idle';
  return 'none';
}

type GroupKey = 'state' | 'client' | 'application' | 'user';

// The dimension a section header is built from; "state" keeps the historic layout.
const GROUP_OPTIONS: { id: GroupKey; labelKey: string }[] = [
  { id: 'state', labelKey: 'liveQueries.groupByState' },
  { id: 'client', labelKey: 'liveQueries.groupByClient' },
  { id: 'application', labelKey: 'liveQueries.groupByApplication' },
  { id: 'user', labelKey: 'liveQueries.groupByUser' },
];

const GROUP_FIELD: Record<Exclude<GroupKey, 'state'>, keyof SessionInfo> = {
  client: 'client_addr',
  application: 'application_name',
  user: 'username',
};

type SessionRow = Row<SessionInfo>;

type GroupSection =
  | { kind: 'state'; key: StateGroup; rows: SessionRow[] }
  | { kind: 'dimension'; key: string; rows: SessionRow[] };

const LONG_RUNNING_MIN_SECONDS = 60;
const DANGEROUS_SECONDS = 300;
const METRIC = 'font-mono tabular-nums';
const NO_SESSIONS: SessionInfo[] = [];
const EMPTY_STATE_COUNTS: SessionStateCount[] = [];

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

function stateVariant(state: string): 'OK' | 'WARNING' | 'INFO' {
  const s = state.toLowerCase();
  if (s === 'idle in transaction' || s.includes('aborted')) return 'WARNING';
  if (s.includes('active')) return 'OK';
  return 'INFO';
}

function isActionResult(data: DryRunResult | BackendActionResult): data is BackendActionResult {
  return 'signal_sent' in data;
}

/** An idle connection sitting for hours is normal; only work in progress is a risk. */
function isDangerous(row: SessionInfo): boolean {
  return stateGroup(row.state) !== 'idle' && stateGroup(row.state) !== 'none'
    ? (row.state_seconds ?? 0) >= DANGEROUS_SECONDS
    : false;
}

export default function QueryManagementPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const setPollInterval = useUIPrefsStore((s) => s.setPollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const refetchInterval = autoRefresh ? pollInterval : false;
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'state_seconds', desc: true },
  ]);

  const [filter, setFilter] = React.useState<StateGroup | 'all'>('all');
  const [groupBy, setGroupBy] = React.useState<GroupKey>('state');
  const [search, setSearch] = React.useState('');
  const [groupSearch, setGroupSearch] = React.useState('');
  // Section ids that are currently collapsed; keyed per grouping so switching
  // the "Group by" dimension does not carry a stale collapsed state over.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [insightTarget, setInsightTarget] = React.useState<QueryInsightTarget | null>(null);
  // Editable refresh interval in seconds. Seeded from the persisted pref (10 s by
  // default) and re-synced if it changes elsewhere, e.g. on the Settings page.
  const [pollSeconds, setPollSeconds] = React.useState(() =>
    String(Math.round(pollInterval / 1000))
  );
  React.useEffect(() => {
    setPollSeconds(String(Math.round(pollInterval / 1000)));
  }, [pollInterval]);

  const sessionsQuery = useQuery({
    queryKey: qk.diagnostics.queries.sessions(),
    queryFn: () => endpoints.getSessions(),
    refetchInterval,
    refetchOnWindowFocus: true,
  });

  const allRows = sessionsQuery.data?.sessions ?? NO_SESSIONS;

  // Prefer the server-side totals: they cover every session in the cluster, so
  // the counters stay exact even when the returned row list is capped.
  const stateCounts = sessionsQuery.data?.state_counts ?? EMPTY_STATE_COUNTS;

  const counts = React.useMemo(() => {
    const result: Record<StateGroup, number> = { active: 0, idleInTx: 0, idle: 0, none: 0 };
    if (stateCounts.length > 0) {
      for (const item of stateCounts) result[stateGroup(item.state)] += item.count;
      return result;
    }
    for (const row of allRows) result[stateGroup(row.state)] += 1;
    return result;
  }, [allRows, stateCounts]);

  const totalSessions = React.useMemo(() => {
    if (sessionsQuery.data?.total !== undefined) return sessionsQuery.data.total;
    const counted = stateCounts.reduce((sum, item) => sum + item.count, 0);
    return counted || allRows.length;
  }, [allRows.length, sessionsQuery.data?.total, stateCounts]);

  const rows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (filter !== 'all' && stateGroup(row.state) !== filter) return false;
      if (!term) return true;
      return [
        row.pid,
        row.username,
        row.database,
        row.application_name,
        row.client_addr,
        row.client_hostname,
        row.backend_type,
        row.query,
      ].some((value) => String(value ?? '').toLowerCase().includes(term));
    });
  }, [allRows, filter, search]);

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
    async (row: SessionInfo) => {
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
    async (row: SessionInfo) => {
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

  const openInsight = React.useCallback((row: SessionInfo) => {
    if (!row.query) return;
    setInsightTarget({
      query: row.query,
      pid: row.pid,
      user: row.username,
      database: row.database,
      state: row.state,
      duration_seconds: row.state_seconds,
      application_name: row.application_name,
      client_addr: row.client_addr,
      client_hostname: row.client_hostname,
      client_port: row.client_port,
      backend_type: row.backend_type,
      state_seconds: row.state_seconds,
      xact_seconds: row.xact_seconds,
      backend_seconds: row.backend_seconds,
      backend_start: row.backend_start,
      xact_start: row.xact_start,
      query_start: row.query_start,
      state_change: row.state_change,
      blocked_by: row.blocked_by,
      wait_event_type: row.wait_event_type,
      wait_event: row.wait_event,
    });
  }, []);

  const columns = React.useMemo<ColumnDef<SessionInfo>[]>(
    () => [
      {
        accessorKey: 'pid',
        header: () => 'PID',
        size: 70,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => openInsight(row.original)}
            disabled={!row.original.query}
            className={`${METRIC} font-semibold text-info underline-offset-2 hover:underline`}
            title={t('queryInsight.openHint')}
          >
            {row.original.pid}
          </button>
        ),
      },
      {
        accessorKey: 'state',
        header: () => t('liveQueries.columns.state'),
        size: 130,
        cell: ({ row }) => {
          const state = row.original.state;
          return (
            <div className="flex flex-col items-start gap-0.5">
              <RiskBadge riskLevel={stateVariant(state ?? '')} size="sm" showIcon={false}>
                {state ?? 'None'}
              </RiskBadge>
              {row.original.blocked_by?.length > 0 && (
                <span className={`${METRIC} text-[10px] text-destructive`}>
                  {t('liveQueries.blockedBy', { pids: row.original.blocked_by.join(', ') })}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'state_seconds',
        header: () => t('liveQueries.columns.duration'),
        size: 90,
        sortingFn: (a, b) => (a.original.state_seconds ?? 0) - (b.original.state_seconds ?? 0),
        cell: ({ row }) => {
          const seconds = row.original.state_seconds;
          if (seconds === null) return <span className="text-muted-foreground">-</span>;
          const group = stateGroup(row.original.state);
          const watch = group === 'active' || group === 'idleInTx';
          return (
            <Badge
              variant="outline"
              className={cn(
                `${METRIC} px-1.5 py-0 text-[11px]`,
                !watch
                  ? 'border-border text-muted-foreground'
                  : seconds >= DANGEROUS_SECONDS
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : seconds >= LONG_RUNNING_MIN_SECONDS
                      ? 'border-warning/40 bg-warning/10 text-warning'
                      : 'border-success/30 bg-success/10 text-success'
              )}
            >
              {formatSeconds(seconds, t)}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'xact_seconds',
        header: () => t('liveQueries.columns.transaction'),
        size: 80,
        sortingFn: (a, b) => (a.original.xact_seconds ?? 0) - (b.original.xact_seconds ?? 0),
        cell: ({ row }) => (
          <span className={`${METRIC} whitespace-nowrap text-muted-foreground`}>
            {row.original.xact_seconds === null ? '-' : formatSeconds(row.original.xact_seconds, t)}
          </span>
        ),
      },
      {
        accessorKey: 'query',
        header: () => t('liveQueries.columns.query'),
        cell: ({ row }) => {
          const { query, wait_event_type: waitType, wait_event: wait, backend_type: type } = row.original;
          return (
            <div className="max-w-[460px] space-y-0.5">
              {isDangerous(row.original) && (
                <RiskBadge riskLevel="DANGEROUS" size="sm" showIcon={false}>
                  {t('liveQueries.dangerousBadge')}
                </RiskBadge>
              )}
              <code className="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] text-foreground hover:line-clamp-none">
                {query || type || t('liveQueries.emptyQuery')}
              </code>
              {waitType && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {waitType}: {wait}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: 'client',
        accessorFn: (row) => row.client_hostname ?? row.client_addr ?? '',
        header: () => t('liveQueries.columns.client'),
        size: 170,
        cell: ({ row }) => {
          const { client_addr: ip, client_hostname: host, client_port: port } = row.original;
          if (!ip && !host) {
            return (
              <span className="text-muted-foreground">
                {port === -1 ? t('liveQueries.localSocket') : '-'}
              </span>
            );
          }
          return (
            <div className="font-mono text-[11px]">
              <p className="truncate text-foreground" title={host ?? t('liveQueries.noHostname')}>
                {host ?? t('liveQueries.noHostnameShort')}
              </p>
              <p className="text-muted-foreground">
                {ip}
                {port ? `:${port}` : ''}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: 'application_name',
        header: () => t('liveQueries.columns.application'),
        size: 120,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.original.application_name || '-'}
          </span>
        ),
      },
      {
        accessorKey: 'database',
        header: () => t('liveQueries.columns.database'),
        size: 100,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">{row.original.database ?? '-'}</span>
        ),
      },
      {
        accessorKey: 'username',
        header: () => t('liveQueries.columns.user'),
        size: 100,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">{row.original.username ?? '-'}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <IfWriter>{t('liveQueries.columns.actions')}</IfWriter>,
        size: 260,
        enableSorting: false,
        cell: ({ row }) => {
          const group = stateGroup(row.original.state);
          // Background processes are not ours to signal, and an idle backend has nothing to cancel.
          if (group === 'none') return null;
          return (
          <IfWriter>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openInsight(row.original)}
                disabled={!row.original.query}
                className="h-6 px-1.5 text-[11px]"
              >
                {t('liveQueries.actions.sessionDetail')}
              </Button>
              {group === 'active' && (
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
              )}
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
          );
        },
      },
    ],
    [handleCancel, handleTerminate, cancelling, terminating, openInsight, t]
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => String(row.pid),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const isFetching = sessionsQuery.isFetching;
  const isLoading = sessionsQuery.isLoading;
  const failed = sessionsQuery.isError && !sessionsQuery.data;
  const refetchAll = () => sessionsQuery.refetch();
  const failedMessage = sessionsQuery.error instanceof Error ? sessionsQuery.error.message : '';

  // Sessions PostgreSQL masks when the role lacks pg_read_all_stats: they are
  // counted in the cluster, but their state arrives as NULL, so they cannot be
  // bucketed and the per-state counters look short.
  const hiddenCount = sessionsQuery.data?.hidden_count ?? 0;
  const grantSql = `GRANT pg_read_all_stats TO "${
    sessionsQuery.data?.db_role ?? 'pgguardian'
  }";`;
  const [grantCopied, setGrantCopied] = React.useState(false);
  const copyGrant = async () => {
    await navigator.clipboard.writeText(grantSql);
    setGrantCopied(true);
    setTimeout(() => setGrantCopied(false), 1500);
  };

  const sortedRows = table.getRowModel().rows;
  const sections: GroupSection[] = (() => {
    if (groupBy === 'state') {
      return (filter === 'all' ? STATE_GROUPS : [filter])
        .map((group) => ({
          kind: 'state' as const,
          key: group,
          rows: sortedRows.filter((r) => stateGroup(r.original.state) === group),
        }))
        .filter((section) => section.rows.length > 0);
    }
    const field = GROUP_FIELD[groupBy];
    const buckets = new Map<string, SessionRow[]>();
    for (const row of sortedRows) {
      const raw = row.original[field];
      const key =
        raw === null || raw === undefined || raw === ''
          ? t('liveQueries.groupUnset')
          : String(raw);
      const list = buckets.get(key);
      if (list) list.push(row);
      else buckets.set(key, [row]);
    }
    return [...buckets.entries()]
      .map(([key, rows]) => ({ kind: 'dimension' as const, key, rows }))
      .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
  })();
  const groupByLabel = t(GROUP_OPTIONS.find((o) => o.id === groupBy)?.labelKey ?? '');

  const sectionLabel = (section: GroupSection) =>
    section.kind === 'state' ? t(`liveQueries.groups.${section.key}`) : section.key;
  const sectionId = (section: GroupSection) => `${groupBy}:${section.key}`;
  const groupTerm = groupSearch.trim().toLowerCase();
  const visibleSections = groupTerm
    ? sections.filter((section) => sectionLabel(section).toLowerCase().includes(groupTerm))
    : sections;
  const visibleIds = visibleSections.map(sectionId);
  const allCollapsed =
    visibleIds.length > 0 && visibleIds.every((id) => collapsed.has(id));

  const toggleSection = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllSections = () =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (allCollapsed) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const filterButtons: { key: StateGroup | 'all'; count: number; tone: string }[] = [
    { key: 'all', count: totalSessions, tone: 'text-foreground' },
    ...STATE_GROUPS.map((key) => ({ key, count: counts[key], tone: GROUP_TONE[key] })),
  ];

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('liveQueries.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('liveQueries.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {autoRefresh ? (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {t('liveQueries.refreshInterval')}
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={pollSeconds}
                onChange={(e) => {
                  setPollSeconds(e.target.value);
                  const seconds = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(seconds) && seconds >= 1) setPollInterval(seconds * 1000);
                }}
                onBlur={() => setPollSeconds(String(Math.round(pollInterval / 1000)))}
                aria-label={t('liveQueries.refreshInterval')}
                className={`${METRIC} h-7 w-[62px] px-1.5 text-center text-[11px]`}
              />
            </label>
          ) : (
            <span className="text-[11px] text-muted-foreground">{t('liveQueries.pollingOff')}</span>
          )}
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

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('liveQueries.columns.state')} className="flex flex-wrap gap-1">
          {filterButtons.map(({ key, count, tone }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors',
                filter === key
                  ? 'border-primary bg-accent text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {t(`liveQueries.groups.${key}`)}
              <span className={cn(METRIC, 'font-semibold', tone)}>
                {isLoading || failed ? '-' : formatNumber(count)}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{t('liveQueries.groupBy')}</span>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupKey)}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_OPTIONS.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-[190px]">
          <ListFilter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            placeholder={t('liveQueries.groupSearchPlaceholder')}
            aria-label={t('liveQueries.groupSearchPlaceholder')}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleAllSections}
          disabled={visibleSections.length === 0}
          className="h-8 px-2 text-xs"
        >
          {allCollapsed ? t('liveQueries.expandAll') : t('liveQueries.collapseAll')}
        </Button>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('liveQueries.searchPlaceholder')}
            aria-label={t('liveQueries.searchPlaceholder')}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {sessionsQuery.data?.limited_visibility && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span className="font-semibold text-foreground">{t('liveQueries.limitedPrivilege')}</span>
          {hiddenCount > 0 && (
            <span className="text-muted-foreground">
              {t('liveQueries.limitedPrivilegeCount', { count: formatNumber(hiddenCount) })}
            </span>
          )}
          <span className="text-muted-foreground">{t('liveQueries.limitedPrivilegeHint')}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {grantSql}
          </code>
          <Button variant="outline" size="sm" onClick={copyGrant} className="h-6 px-2 text-[11px]">
            {grantCopied ? (
              <Check className="mr-1 h-3 w-3 text-success" />
            ) : (
              <Copy className="mr-1 h-3 w-3" />
            )}
            {t(grantCopied ? 'common.copied' : 'common.copy')}
          </Button>
        </div>
      )}

      {sessionsQuery.data?.truncated && (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs">
          {t('liveQueries.truncated', { limit: sessionsQuery.data.limit })}
        </p>
      )}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
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
        ) : visibleSections.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('liveQueries.noGroupMatch')}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
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
                {visibleSections.map((section) => {
                  const id = sectionId(section);
                  const isCollapsed = collapsed.has(id);
                  const sectionRows = section.rows;
                  const showHeader = section.kind === 'dimension' || filter === 'all';
                  const stateCounts =
                    section.kind === 'dimension'
                      ? STATE_GROUPS.map((g) => ({
                          group: g,
                          count: sectionRows.filter((r) => stateGroup(r.original.state) === g).length,
                        })).filter((d) => d.count > 0)
                      : [];
                  // Grouping by host: name the applications running from it.
                  const appNames =
                    groupBy === 'client'
                      ? [
                          ...new Set(
                            sectionRows
                              .map((r) => r.original.application_name)
                              .filter((name): name is string => Boolean(name))
                          ),
                        ].sort((a, b) => a.localeCompare(b))
                      : [];
                  return (
                    <React.Fragment key={section.key}>
                      {showHeader && (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={columns.length} className="px-2 py-0.5 text-[11px] font-semibold">
                            <button
                              type="button"
                              onClick={() => toggleSection(id)}
                              aria-expanded={!isCollapsed}
                              title={isCollapsed ? t('liveQueries.expandGroup') : t('liveQueries.collapseGroup')}
                              className="inline-flex w-full items-center gap-1.5 rounded py-0.5 text-left hover:bg-muted/60"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              {section.kind === 'state' ? (
                                <>
                                  <span className={GROUP_TONE[section.key]}>
                                    {t(`liveQueries.groups.${section.key}`)}
                                  </span>
                                  <span className={`${METRIC} text-muted-foreground`}>
                                    {sectionRows.length}
                                  </span>
                                </>
                              ) : (
                                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-muted-foreground">{groupByLabel}:</span>
                                  <span className="font-mono text-foreground">{section.key}</span>
                                  <span className={`${METRIC} text-muted-foreground`}>
                                    {sectionRows.length}
                                  </span>
                                  {appNames.length > 0 && (
                                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-muted-foreground">
                                        {t('liveQueries.columns.application')}:
                                      </span>
                                      <span className="font-mono text-foreground">
                                        {appNames.join(', ')}
                                      </span>
                                    </span>
                                  )}
                                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                                    {stateCounts.map(({ group, count }) => (
                                      <span key={group} className={cn(GROUP_TONE[group], 'font-mono')}>
                                        {t(`liveQueries.groups.${group}`)} {count}
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              )}
                            </button>
                          </TableCell>
                        </TableRow>
                      )}
                      {!isCollapsed &&
                        sectionRows.map((r) => (
                        <TableRow
                          key={r.id}
                          className={cn(
                            isDangerous(r.original) &&
                              'border-l-2 border-l-destructive/60 bg-destructive/5'
                          )}
                        >
                          {r.getVisibleCells().map((c) => (
                            <TableCell
                              key={c.id}
                              style={{ width: c.column.getSize() }}
                              className="px-2 py-1.5 align-top text-xs"
                            >
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </UITable>
          </div>
        )}
      </section>
      <QueryInsightDialog target={insightTarget} onClose={() => setInsightTarget(null)} />
    </div>
  );
}
