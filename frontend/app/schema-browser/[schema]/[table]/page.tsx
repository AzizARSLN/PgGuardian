'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Header,
  type SortingState,
} from '@tanstack/react-table';
import Papa from 'papaparse';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle as AlertIcon,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns3,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  GitBranch,
  Hash,
  KeyRound,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RiskBadge } from '@/components/ui/risk-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IfWriter } from '@/components/role-guard';
import {
  endpoints,
  type SqlResult,
  type TableColumnProfile,
  type DryRunResult,
  type TableImportResult,
} from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { useI18n, useT } from '@/lib/i18n';
import { cn, formatBytes } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';

/** Hard cap enforced by GET /tables/{schema}/{table}/export. */
const EXPORT_LIMIT = 10000;
const PREVIEW_LIMIT = 5000;

type ResultRow = unknown[];

/** What /profile really returns; the shared type lists names the backend does not send. */
interface ProfileRow {
  column: string;
  dataType: string;
  nullable: boolean;
  total: number | null;
  nulls: number | null;
  distinct: number | null;
  avgWidth: number | null;
  unavailable: boolean;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeProfile(row: TableColumnProfile): ProfileRow {
  return {
    column: String(row.column ?? row.column_name ?? ''),
    dataType: String(row.data_type ?? ''),
    nullable: row.nullable === true,
    total: toNumber(row.total),
    nulls: toNumber(row.nulls ?? row.null_count),
    distinct: toNumber(row.distinct ?? row.distinct_count),
    avgWidth: toNumber(row.avg_width ?? row.avg_width_bytes),
    unavailable: row.error !== undefined,
  };
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvValue(value: unknown): unknown {
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
}

/** Always quoted: mixed case and reserved words break when left bare. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isSqlResult(data: SqlResult | DryRunResult | undefined): data is SqlResult {
  return !!data && 'row_count' in data;
}

function isDryRun(data: unknown): data is DryRunResult {
  return !!data && typeof data === 'object' && 'risk' in data;
}

function parseCsvPreview(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, unknown>>(file, {
      preview: 10,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.slice(0, 10)),
      error: () => resolve([]),
    });
  });
}

export default function SchemaTableDetailPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const params = useParams<{ schema: string; table: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const schema = React.useMemo(() => safeDecode(params.schema ?? ''), [params.schema]);
  const tableName = React.useMemo(() => safeDecode(params.table ?? ''), [params.table]);
  const identifier = `${schema}.${tableName}`;
  const schemaPath = encodeURIComponent(schema);
  const tablePath = encodeURIComponent(tableName);
  const previewPrefix = ['table_io', 'export', schema, tableName];

  const [activeTab, setActiveTab] = React.useState('columns');
  const [previewSorting, setPreviewSorting] = React.useState<SortingState>([]);
  const [profileSorting, setProfileSorting] = React.useState<SortingState>([]);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = React.useState(0);
  const [dryRunData, setDryRunData] = React.useState<{
    result: DryRunResult;
    previewRecords: Record<string, unknown>[];
  } | null>(null);

  const describeQuery = useQuery({
    queryKey: qk.schemas.table(schema, tableName),
    queryFn: () => endpoints.describeTable(schemaPath, tablePath),
    enabled: !!schema && !!tableName,
  });

  const previewQuery = useQuery({
    queryKey: [...previewPrefix, PREVIEW_LIMIT, 'preview'],
    queryFn: () =>
      endpoints.executeSql({
        sql: `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(tableName)} LIMIT ${PREVIEW_LIMIT}`,
        readonly: true,
      }),
    enabled: !!schema && !!tableName,
  });

  // Profiling scans up to the row cap per column, so it waits until the tab is opened.
  const profileQuery = useQuery({
    queryKey: qk.table_io.profile(schema, tableName),
    queryFn: () => endpoints.profileTable(schemaPath, tablePath),
    enabled: !!schema && !!tableName && activeTab === 'profile',
  });

  function resetImport() {
    setImportFile(null);
    setDryRunData(null);
    // A file input cannot be cleared through state, so it is remounted.
    setFileInputKey((k) => k + 1);
  }

  function invalidateTable() {
    queryClient.invalidateQueries({ queryKey: qk.schemas.all() });
    queryClient.invalidateQueries({ queryKey: previewPrefix });
    queryClient.invalidateQueries({ queryKey: qk.table_io.profile(schema, tableName) });
  }

  const dryRunMutation = useMutation({
    mutationFn: async (file: File) => {
      const result = await endpoints.importTable(schemaPath, tablePath, file, false, true);
      // Papa parses File objects asynchronously, so this has to be awaited.
      const previewRecords = await parseCsvPreview(file);
      return { result, previewRecords };
    },
    onSuccess: ({ result, previewRecords }) => {
      if (isDryRun(result)) {
        setDryRunData({ result, previewRecords });
        toast.info(t('tableDetail.import.dryRunDone'), { description: result.note });
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => endpoints.importTable(schemaPath, tablePath, file, true, false),
    onSuccess: (data) => {
      invalidateTable();
      if (data && 'imported' in data) {
        const r = data as TableImportResult;
        toast.success(t('tableDetail.import.success'), {
          description: `${r.imported} · ${formatBytes(r.bytes)}`,
        });
      }
      resetImport();
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => endpoints.exportTable(schemaPath, tablePath, EXPORT_LIMIT, 'csv'),
    onSuccess: (csv) => {
      downloadText(csv, `${schema}_${tableName}_${Date.now()}.csv`);
      const capped = (describeQuery.data?.live_tuples ?? 0) > EXPORT_LIMIT;
      const description = t('tableDetail.export.capped', { limit: formatNumber(EXPORT_LIMIT) });
      if (capped) {
        toast.warning(t('tableDetail.export.done'), { description });
      } else {
        toast.success(t('tableDetail.export.done'));
      }
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const plan = await endpoints.analyzeTable(schemaPath, tablePath, false, true);
      const ok = await confirm({
        title: t('tableDetail.analyze.confirmTitle', { table: identifier }),
        description: t('tableDetail.analyze.confirmDescription'),
        risk_level: 'MAINTENANCE',
        sql_preview: isDryRun(plan) ? plan.sql : [`ANALYZE ${identifier}`],
        confirm_label: 'ANALYZE',
        cancel_label: t('common.cancel'),
      });
      if (!ok) return false;
      await endpoints.analyzeTable(schemaPath, tablePath, true, false);
      return true;
    },
    onSuccess: (ran) => {
      if (!ran) return;
      invalidateTable();
      toast.success(t('tableDetail.analyze.done', { table: identifier }));
    },
  });

  function handlePreviewExport() {
    const result = previewQuery.data;
    if (!isSqlResult(result) || result.rows.length === 0) {
      toast.warning(t('tableDetail.export.noData'));
      return;
    }
    // Fields plus row arrays, so duplicate column names keep their own values.
    const csv = Papa.unparse({
      fields: result.columns,
      data: result.rows.map((row) => row.map(csvValue)),
    });
    downloadText(csv, `${schema}_${tableName}_preview_${Date.now()}.csv`);
    toast.success(t('tableDetail.export.done'), {
      description: t('tableDetail.rowCount', { count: formatNumber(result.rows.length) }),
    });
  }

  function handleDryRun(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) {
      toast.warning(t('tableDetail.import.selectFile'));
      return;
    }
    setDryRunData(null);
    dryRunMutation.mutate(importFile);
  }

  async function handleConfirmImport() {
    if (!importFile || !dryRunData) return;
    const dr = dryRunData.result;
    const ok = await confirm({
      title: t('tableDetail.import.confirmTitle', { table: identifier }),
      description: t('tableDetail.import.confirmDescription', { risk: dr.risk, note: dr.note }),
      risk_level: dr.risk === 'DANGEROUS' ? 'DANGEROUS' : 'MAINTENANCE',
      sql_preview: dr.sql ?? [],
      confirm_label: t('tableDetail.import.confirmLabel'),
      cancel_label: t('common.cancel'),
    });
    if (ok) importMutation.mutate(importFile);
  }

  const previewResult = isSqlResult(previewQuery.data) ? previewQuery.data : undefined;

  // Columns are addressed by position because names can repeat, and a name
  // containing a dot would be read as a nested path by accessorKey.
  const previewColumns = React.useMemo<ColumnDef<ResultRow>[]>(() => {
    if (!previewResult) return [];
    return previewResult.columns.map<ColumnDef<ResultRow>>((col, index) => ({
      id: `col_${index}`,
      accessorFn: (row) => row[index],
      header: col,
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === null || v === undefined) {
          return <span className="italic text-muted-foreground">NULL</span>;
        }
        if (typeof v === 'object') {
          return <code className="text-muted-foreground">{JSON.stringify(v)}</code>;
        }
        return String(v);
      },
    }));
  }, [previewResult]);

  const previewTable = useReactTable({
    data: previewResult?.rows ?? [],
    columns: previewColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setPreviewSorting,
    state: { sorting: previewSorting },
    initialState: { pagination: { pageSize: 25 } },
  });

  const profileRows = React.useMemo(
    () => (profileQuery.data ?? []).map(normalizeProfile),
    [profileQuery.data]
  );

  const profileColumns = React.useMemo<ColumnDef<ProfileRow>[]>(() => {
    const numberCell = (value: number | null) => (
      <span className="font-mono text-muted-foreground">
        {value === null ? '-' : formatNumber(value)}
      </span>
    );
    return [
      {
        accessorKey: 'column',
        header: t('tableDetail.profile.column'),
        cell: ({ getValue }) => (
          <span className="font-mono font-medium text-foreground">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'dataType',
        header: t('tableDetail.profile.type'),
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'total',
        header: t('tableDetail.profile.sampled'),
        cell: ({ row }) =>
          row.original.unavailable ? (
            <span className="text-warning">{t('tableDetail.profile.unavailable')}</span>
          ) : (
            numberCell(row.original.total)
          ),
      },
      {
        accessorKey: 'nulls',
        header: 'NULL',
        // Share of the sampled rows; nulls + distinct is not a row count.
        cell: ({ row }) => {
          const { nulls, total } = row.original;
          return (
            <div className="flex items-center gap-2">
              {numberCell(nulls)}
              {nulls !== null && !!total && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatNumber(nulls / total, { style: 'percent', maximumFractionDigits: 1 })}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'distinct',
        header: 'Distinct',
        cell: ({ row }) => numberCell(row.original.distinct),
      },
      {
        accessorKey: 'avgWidth',
        header: t('tableDetail.profile.avgWidth'),
        cell: ({ row }) => numberCell(row.original.avgWidth),
      },
    ];
  }, [t, formatNumber]);

  const profileTable = useReactTable({
    data: profileRows,
    columns: profileColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setProfileSorting,
    state: { sorting: profileSorting },
  });

  const detail = describeQuery.data;
  const describeError = describeQuery.isError ? (
    <InlineError error={describeQuery.error} onRetry={() => describeQuery.refetch()} />
  ) : null;
  const dryRisk = dryRunData?.result.risk;

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/schema-browser')}
            className="-ml-2 h-6 px-2 text-xs"
          >
            <ArrowLeft className="h-3 w-3" />
            {t('tableDetail.back')}
          </Button>
          <h1 className="break-all font-mono text-lg font-semibold text-foreground">{identifier}</h1>
          <p className="text-xs text-muted-foreground">{t('tableDetail.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreviewExport}
            disabled={!previewResult || previewResult.rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {t('tableDetail.export.preview')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {exportMutation.isPending ? t('common.loading') : t('tableDetail.export.action')}
          </Button>
          <IfWriter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
            >
              <Activity className="h-3.5 w-3.5" />
              ANALYZE
            </Button>
          </IfWriter>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t('tableDetail.stats.size')} value={detail ? formatBytes(detail.total_size_bytes) : '-'} />
        <Stat label={t('tableDetail.stats.liveRows')} value={detail ? formatNumber(detail.live_tuples) : '-'} />
        <Stat label={t('tableDetail.stats.deadRows')} value={detail ? formatNumber(detail.dead_tuples) : '-'} />
        <Stat label={t('tableDetail.tabs.columns')} value={detail ? formatNumber(detail.columns.length) : '-'} />
        <Stat label={t('tableDetail.tabs.indexes')} value={detail ? formatNumber(detail.indexes.length) : '-'} />
        <Stat label={t('tableDetail.stats.owner')} value={detail?.owner ?? '-'} />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="!p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="p-3">
            <TabsList className="mb-2 h-auto flex-wrap gap-0.5 !py-1">
              <TabsTrigger value="columns" className="h-6 text-xs">
                <Columns3 className="mr-1 h-3 w-3" />
                {t('tableDetail.tabs.columns')}
                <span className="ml-1.5 font-mono opacity-75">{formatNumber(detail?.columns.length ?? 0)}</span>
              </TabsTrigger>
              <TabsTrigger value="indexes" className="h-6 text-xs">
                <KeyRound className="mr-1 h-3 w-3" />
                {t('tableDetail.tabs.indexes')}
                <span className="ml-1.5 font-mono opacity-75">{formatNumber(detail?.indexes.length ?? 0)}</span>
              </TabsTrigger>
              <TabsTrigger value="constraints" className="h-6 text-xs">
                <GitBranch className="mr-1 h-3 w-3" />
                {t('tableDetail.tabs.constraints')}
                <span className="ml-1.5 font-mono opacity-75">{formatNumber(detail?.constraints.length ?? 0)}</span>
              </TabsTrigger>
              <TabsTrigger value="preview" className="h-6 text-xs">
                <Eye className="mr-1 h-3 w-3" />
                {t('tableDetail.tabs.preview', { limit: PREVIEW_LIMIT })}
              </TabsTrigger>
              <TabsTrigger value="profile" className="h-6 text-xs">
                <BarChart3 className="mr-1 h-3 w-3" />
                {t('tableDetail.tabs.profile')}
              </TabsTrigger>
              <IfWriter>
                <TabsTrigger value="import" className="h-6 text-xs">
                  <Upload className="mr-1 h-3 w-3" />
                  {t('tableDetail.tabs.import')}
                </TabsTrigger>
              </IfWriter>
            </TabsList>

            <TabsContent value="columns" className="space-y-2">
              {describeQuery.isLoading && <Placeholder text={t('common.loading')} />}
              {describeError}
              {detail && detail.columns.length === 0 && <Placeholder text={t('tableDetail.columns.empty')} />}
              {detail && detail.columns.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <UITable>
                    <TableHeader className="bg-card">
                      <TableRow>
                        <TableHead className="h-7 w-10 px-2 text-xs font-semibold">#</TableHead>
                        <TableHead className="h-7 px-2 text-xs font-semibold">{t('tableDetail.columns.name')}</TableHead>
                        <TableHead className="h-7 px-2 text-xs font-semibold">{t('tableDetail.columns.type')}</TableHead>
                        <TableHead className="h-7 px-2 text-xs font-semibold">{t('tableDetail.columns.nullable')}</TableHead>
                        <TableHead className="h-7 px-2 text-xs font-semibold">{t('tableDetail.columns.default')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.columns.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                            {formatNumber(i + 1)}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 font-mono text-xs font-medium text-foreground">
                            {c.name}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                            {c.data_type}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-xs">
                            <RiskBadge riskLevel={c.nullable ? 'INFO' : 'WARNING'} size="sm" showIcon={false}>
                              {c.nullable ? 'NULLABLE' : 'NOT NULL'}
                            </RiskBadge>
                          </TableCell>
                          <TableCell className="max-w-[320px] truncate px-2 py-1.5 font-mono text-xs text-muted-foreground">
                            {c.default ?? '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </UITable>
                </div>
              )}
            </TabsContent>

            <TabsContent value="indexes" className="space-y-2">
              {describeQuery.isLoading && <Placeholder text={t('common.loading')} />}
              {describeError}
              {detail && detail.indexes.length === 0 && <Placeholder text={t('tableDetail.indexes.empty')} />}
              {detail && detail.indexes.length > 0 && (
                <div className="divide-y divide-border rounded-md border border-border">
                  {detail.indexes.map((idx, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted">
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-success" />
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">{idx}</pre>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="constraints" className="space-y-2">
              {describeQuery.isLoading && <Placeholder text={t('common.loading')} />}
              {describeError}
              {detail && detail.constraints.length === 0 && <Placeholder text={t('tableDetail.constraints.empty')} />}
              {detail && detail.constraints.length > 0 && (
                <div className="divide-y divide-border rounded-md border border-border">
                  {detail.constraints.map((cst, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-info" />
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">{cst}</pre>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="preview" className="space-y-2">
              {previewQuery.isLoading && <Placeholder text={t('common.loading')} />}
              {previewQuery.isError && (
                <InlineError error={previewQuery.error} onRetry={() => previewQuery.refetch()} />
              )}
              {previewResult && (
                <>
                  <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                    <span>
                      {t('tableDetail.preview.summary', {
                        rows: formatNumber(previewResult.row_count),
                        columns: formatNumber(previewResult.columns.length),
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileJson className="h-3 w-3" />
                      {previewResult.command} · {previewResult.kind}
                    </span>
                  </div>
                  <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
                    <UITable>
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        {previewTable.getHeaderGroups().map((hg) => (
                          <TableRow key={hg.id}>
                            {hg.headers.map((h) => (
                              <SortableHead key={h.id} header={h} mono />
                            ))}
                          </TableRow>
                        ))}
                      </TableHeader>
                      <TableBody>
                        {previewTable.getRowModel().rows.map((r) => (
                          <TableRow key={r.id}>
                            {r.getVisibleCells().map((c) => (
                              <TableCell key={c.id} className="px-2 py-1.5 font-mono text-xs">
                                {flexRender(c.column.columnDef.cell, c.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                        {previewTable.getRowModel().rows.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={Math.max(previewColumns.length, 1)}
                              className="py-6 text-center text-xs text-muted-foreground"
                            >
                              {t('common.noData')}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </UITable>
                  </div>
                  {previewTable.getPageCount() > 1 && (
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs text-muted-foreground">
                        {t('tableDetail.pagination.page', {
                          page: formatNumber(previewTable.getState().pagination.pageIndex + 1),
                          total: formatNumber(previewTable.getPageCount()),
                        })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => previewTable.previousPage()}
                          disabled={!previewTable.getCanPreviousPage()}
                        >
                          <ChevronUp className="h-3 w-3" />
                          {t('tableDetail.pagination.previous')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => previewTable.nextPage()}
                          disabled={!previewTable.getCanNextPage()}
                        >
                          {t('tableDetail.pagination.next')}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="profile" className="space-y-2">
              {profileQuery.isLoading && <Placeholder text={t('common.loading')} />}
              {profileQuery.isError && (
                <InlineError error={profileQuery.error} onRetry={() => profileQuery.refetch()} />
              )}
              {profileQuery.data?.length === 0 && <Placeholder text={t('common.noData')} />}
              {profileRows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <UITable>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      {profileTable.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id}>
                          {hg.headers.map((h) => (
                            <SortableHead key={h.id} header={h} />
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {profileTable.getRowModel().rows.map((r) => (
                        <TableRow key={r.id}>
                          {r.getVisibleCells().map((c) => (
                            <TableCell key={c.id} className="px-2 py-1.5 text-xs">
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </UITable>
                </div>
              )}
            </TabsContent>

            <IfWriter>
              <TabsContent value="import" className="space-y-3">
                <form onSubmit={handleDryRun} className="space-y-1.5">
                  <Label htmlFor="csv-import-file" className="text-xs font-semibold">
                    {t('tableDetail.import.fileLabel')}
                  </Label>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                    <Input
                      key={fileInputKey}
                      id="csv-import-file"
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => {
                        setImportFile(e.target.files?.[0] ?? null);
                        setDryRunData(null);
                      }}
                      className="h-8 cursor-pointer text-xs"
                    />
                    <Button type="submit" variant="outline" size="sm" disabled={!importFile || dryRunMutation.isPending}>
                      <Sparkles className="h-3.5 w-3.5" />
                      {dryRunMutation.isPending ? t('tableDetail.import.dryRunning') : t('tableDetail.import.dryRun')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('tableDetail.import.help')}</p>
                </form>

                {dryRunData && (
                  <div className="space-y-2">
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-md border px-3 py-2',
                        dryRisk === 'DANGEROUS'
                          ? 'border-destructive/40 bg-destructive/5'
                          : dryRisk === 'MAINTENANCE'
                            ? 'border-warning/40 bg-warning/5'
                            : 'border-success/40 bg-success/5'
                      )}
                    >
                      {dryRisk === 'DANGEROUS' ? (
                        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <CheckCircle2
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            dryRisk === 'MAINTENANCE' ? 'text-warning' : 'text-success'
                          )}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {t('tableDetail.import.dryRunResult')}
                          </span>
                          <RiskBadge
                            riskLevel={
                              dryRisk === 'DANGEROUS' || dryRisk === 'MAINTENANCE' ? dryRisk : 'OK'
                            }
                            size="sm"
                          >
                            {dryRisk}
                          </RiskBadge>
                        </div>
                        <p className="text-xs text-muted-foreground">{dryRunData.result.note}</p>
                        {dryRunData.result.target && (
                          <p className="font-mono text-xs text-muted-foreground">
                            {t('tableDetail.import.target', { target: dryRunData.result.target })}
                          </p>
                        )}
                      </div>
                    </div>

                    {dryRunData.result.sql && dryRunData.result.sql.length > 0 && (
                      <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <Hash className="h-3 w-3" />
                          {t('tableDetail.import.sqlPreview')}
                        </div>
                        {dryRunData.result.sql.map((s, i) => (
                          <pre key={i} className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                            {s}
                          </pre>
                        ))}
                      </div>
                    )}

                    {dryRunData.previewRecords.length > 0 && (
                      <div className="overflow-hidden rounded-md border border-border">
                        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <Eye className="h-3 w-3" />
                          {t('tableDetail.import.firstRows', {
                            count: formatNumber(dryRunData.previewRecords.length),
                          })}
                        </div>
                        <div className="max-h-64 overflow-auto">
                          <UITable>
                            <TableHeader className="sticky top-0 bg-card">
                              <TableRow>
                                {Object.keys(dryRunData.previewRecords[0]).map((k) => (
                                  <TableHead key={k} className="h-7 whitespace-nowrap px-2 font-mono text-xs font-semibold">
                                    {k}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {dryRunData.previewRecords.map((r, i) => (
                                <TableRow key={i}>
                                  {Object.values(r).map((v, j) => (
                                    <TableCell key={j} className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                                      {v === null || v === undefined ? 'NULL' : String(v)}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </UITable>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={resetImport}>
                        {t('tableDetail.import.clear')}
                      </Button>
                      <Button
                        size="sm"
                        variant={dryRisk === 'DANGEROUS' ? 'destructive' : 'default'}
                        onClick={handleConfirmImport}
                        disabled={importMutation.isPending}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {importMutation.isPending
                          ? t('tableDetail.import.importing')
                          : t('tableDetail.import.confirmAndImport')}
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>
            </IfWriter>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function SortableHead<T>({ header, mono }: { header: Header<T, unknown>; mono?: boolean }) {
  const sorted = header.column.getIsSorted();
  return (
    <TableHead
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      className={cn('h-7 whitespace-nowrap px-2 text-xs font-semibold', mono && 'font-mono')}
    >
      <button
        type="button"
        onClick={header.column.getToggleSortingHandler()}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {flexRender(header.column.columnDef.header, header.getContext())}
        {sorted === 'asc' && <ArrowUp className="h-3 w-3" />}
        {sorted === 'desc' && <ArrowDown className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-3 py-2">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-sm font-semibold text-foreground">{value}</div>
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

function Placeholder({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
