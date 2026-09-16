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
  type SortingState,
} from '@tanstack/react-table';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import {
  ArrowLeft,
  Columns3,
  KeyRound,
  GitBranch,
  Eye,
  BarChart3,
  Download,
  Upload,
  FileSpreadsheet,
  Database,
  HardDrive,
  Layers,
  CheckCircle2,
  AlertTriangle as AlertIcon,
  Hash,
  Type,
  ToggleLeft,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileJson,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RiskBadge } from '@/components/ui/risk-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
  type TableDetail,
  type SqlResult,
  type TableColumnProfile,
  type DryRunResult,
  type TableImportResult,
} from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { cn, formatBytes, formatNumber, formatPercent } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';

function downloadCSVFromRecords(records: Record<string, unknown>[], filename: string) {
  const csv = Papa.unparse(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type PreviewRow = Record<string, unknown> & { __id: number };

export default function SchemaTableDetailPage() {
  const params = useParams<{ schema: string; table: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const schema = React.useMemo(() => decodeURIComponent(params.schema ?? ''), [params.schema]);
  const tableName = React.useMemo(() => decodeURIComponent(params.table ?? ''), [params.table]);
  const identifier = `${schema}.${tableName}`;

  const [previewSorting, setPreviewSorting] = React.useState<SortingState>([]);
  const [profileSorting, setProfileSorting] = React.useState<SortingState>([]);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [dryRunData, setDryRunData] = React.useState<{
    result: DryRunResult;
    previewRecords: Record<string, unknown>[];
  } | null>(null);

  const describeQuery = useQuery({
    queryKey: qk.schemas.table(schema, tableName),
    queryFn: () => endpoints.describeTable(schema, tableName),
    enabled: !!schema && !!tableName,
  });

  const previewQuery = useQuery({
    queryKey: [...qk.table_io.export(schema, tableName, 100), 'preview'],
    queryFn: () =>
      endpoints.executeSql({
        sql: `SELECT * FROM ${safeIdent(schema)}.${safeIdent(tableName)} LIMIT 100`,
        confirm: true,
        readonly: true,
      }),
    enabled: !!schema && !!tableName,
  });

  const profileQuery = useQuery({
    queryKey: qk.table_io.profile(schema, tableName),
    queryFn: () => endpoints.profileTable(schema, tableName),
    enabled: !!schema && !!tableName,
  });

  const dryRunMutation = useMutation({
    mutationFn: (file: File) =>
      endpoints.importTable(schema, tableName, file, false, true),
    onSuccess: (data, file) => {
      if (data && 'risk' in data) {
        const dr = data as DryRunResult;
        let records: Record<string, unknown>[] = [];
        try {
          Papa.parse(file, {
            preview: 10,
            header: true,
            skipEmptyLines: true,
            complete: (res: Papa.ParseResult<Record<string, unknown>>) => {
              records = (res.data as Record<string, unknown>[]).slice(0, 10);
            },
          });
        } catch {
        }
        setDryRunData({ result: dr, previewRecords: records });
        toast.info('Dry Run tamamlandı', { description: dr.note });
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) =>
      endpoints.importTable(schema, tableName, file, true, false),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: qk.schemas.table(schema, tableName) });
      queryClient.invalidateQueries({ queryKey: qk.table_io.export(schema, tableName) });
      if (data && 'imported' in data) {
        const r = data as TableImportResult;
        toast.success('İçe aktarım başarılı', {
          description: `${r.imported} · ${formatBytes(r.bytes)}`,
        });
      }
      setImportFile(null);
      setDryRunData(null);
      form.reset();
    },
  });

  const form = useForm<{ file?: File }>({
    defaultValues: {},
  });

  function safeIdent(s: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function handleExportCSV() {
    const result = previewQuery.data as SqlResult | undefined;
    if (!result || result.row_count === 0) {
      toast.warning('Dışa aktarılacak veri yok');
      return;
    }
    const records = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => (obj[col] = row[i]));
      return obj;
    });
    downloadCSVFromRecords(records, `${schema}_${tableName}_preview_${Date.now()}.csv`);
    toast.success('CSV dışa aktarıldı', {
      description: `${records.length} satır`,
    });
  }

  async function handleFullExport() {
    try {
      const result = await endpoints.executeSql({
        sql: `SELECT * FROM ${safeIdent(schema)}.${safeIdent(tableName)}`,
        confirm: true,
        readonly: true,
      });
      if (result && 'row_count' in result) {
        const r = result as SqlResult;
        const records = r.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          r.columns.forEach((col, i) => (obj[col] = row[i]));
          return obj;
        });
        downloadCSVFromRecords(records, `${schema}_${tableName}_full_${Date.now()}.csv`);
        toast.success('Tam CSV dışa aktarıldı', {
          description: `${records.length} satır`,
        });
      }
    } catch (e: any) {
      toast.error('Dışa aktarım başarısız', {
        description: e?.message ?? 'Bilinmeyen hata',
      });
    }
  }

  function onFileSubmit(values: { file?: File }) {
    if (!importFile) {
      toast.warning('Lütfen bir CSV dosyası seçin');
      return;
    }
    setDryRunData(null);
    dryRunMutation.mutate(importFile);
  }

  async function handleConfirmImport() {
    if (!importFile || !dryRunData) return;
    const dr = dryRunData.result;
    const ok = await confirm({
      title: `${identifier} tablosuna içe aktarılsın mı?`,
      description: `Risk: ${dr.risk}. ${dr.note}. Veritabanına yazma işlemi geri alınamaz.`,
      risk_level: (dr.risk === 'DANGEROUS' ? 'DANGEROUS' : 'MAINTENANCE') as any,
      sql_preview: dr.sql ?? [],
      confirm_label: 'İçe Aktar',
      cancel_label: 'Vazgeç',
    });
    if (ok) importMutation.mutate(importFile);
  }

  const previewResult = previewQuery.data as SqlResult | undefined;
  const previewRecords: PreviewRow[] = React.useMemo(() => {
    if (!previewResult) return [];
    return previewResult.rows.map((row, i) => {
      const obj: PreviewRow = { __id: i };
      previewResult.columns.forEach((col, ci) => (obj[col] = row[ci]));
      return obj;
    });
  }, [previewResult]);

  const previewColumns = React.useMemo<ColumnDef<PreviewRow>[]>(() => {
    if (!previewResult) return [];
    return previewResult.columns.map<ColumnDef<PreviewRow>>((col) => ({
      accessorKey: col,
      header: col,
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === null || v === undefined)
          return <span className="text-muted-foreground italic">NULL</span>;
        if (typeof v === 'object')
          return <code className="text-xs text-zinc-300">{JSON.stringify(v)}</code>;
        return <span className="text-xs">{String(v)}</span>;
      },
    }));
  }, [previewResult]);

  const previewTable = useReactTable({
    data: previewRecords,
    columns: previewColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setPreviewSorting,
    state: { sorting: previewSorting },
    initialState: { pagination: { pageSize: 25 } },
  });

  const profileColumns = React.useMemo<ColumnDef<TableColumnProfile>[]>(
    () => [
      {
        accessorKey: 'column_name',
        header: 'Kolon',
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <Columns3 className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-mono font-medium text-white text-sm">
              {getValue<string>()}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'null_count',
        header: 'NULL',
        size: 110,
        sortingFn: (a, b) =>
          (a.original.null_count ?? 0) - (b.original.null_count ?? 0),
        cell: ({ getValue, row }) => {
          const nc = getValue<number | undefined>() ?? 0;
          const distinct = row.original.distinct_count ?? 0;
          const total = nc + distinct;
          return (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-zinc-300">{formatNumber(nc)}</span>
              {total > 0 && (
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 to-amber-500"
                    style={{ width: `${Math.min(100, (nc / total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'distinct_count',
        header: 'Distinct',
        size: 120,
        sortingFn: (a, b) =>
          (a.original.distinct_count ?? 0) - (b.original.distinct_count ?? 0),
        cell: ({ getValue, row }) => {
          const dc = getValue<number | undefined>() ?? 0;
          const nc = row.original.null_count ?? 0;
          const total = nc + dc;
          return (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-zinc-300">{formatNumber(dc)}</span>
              {total > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {formatPercent(dc, total)} benzersiz
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'avg_width_bytes',
        header: 'Ort. Boyut',
        size: 110,
        sortingFn: (a, b) =>
          (a.original.avg_width_bytes ?? 0) - (b.original.avg_width_bytes ?? 0),
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-zinc-300">
            {formatBytes(getValue<number | undefined>() ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: 'min_value',
        header: 'Min',
        cell: ({ getValue }) => {
          const v = getValue();
          if (v === null || v === undefined) return null;
          return (
            <code className="text-[11px] font-mono text-zinc-400 truncate max-w-[140px] block">
              {String(v)}
            </code>
          );
        },
      },
      {
        accessorKey: 'max_value',
        header: 'Max',
        cell: ({ getValue }) => {
          const v = getValue();
          if (v === null || v === undefined) return null;
          return (
            <code className="text-[11px] font-mono text-zinc-400 truncate max-w-[140px] block">
              {String(v)}
            </code>
          );
        },
      },
    ],
    []
  );

  const profileTable = useReactTable({
    data: profileQuery.data ?? [],
    columns: profileColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setProfileSorting,
    state: { sorting: profileSorting },
  });

  const detail = describeQuery.data;

  return (
    <div className="space-y-8">
      <ConfirmDialog />
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/schema-browser')}
            className="mb-2 -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Şema Tarayıcıya Dön
          </Button>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Database className="h-8 w-8 text-gradient" />
            {identifier}
          </h1>
          <p className="text-muted-foreground mt-1">
            Kolonlar · İndeksler · Kısıtlar · Önizleme · Profil · CSV
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="px-4 py-2 text-sm bg-black/30 gap-2"
          >
            <HardDrive className="h-3.5 w-3.5 text-amber-400" />
            {detail ? formatBytes(detail.total_size_bytes) : '...'}
          </Badge>
          <Badge
            variant="outline"
            className="px-4 py-2 text-sm bg-black/30 gap-2"
          >
            <Layers className="h-3.5 w-3.5 text-emerald-400" />
            {detail ? formatNumber(detail.live_tuples) : '...'} satır
          </Badge>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!previewResult || previewResult.row_count === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Önizleme CSV
          </Button>
          <Button
            onClick={handleFullExport}
            className="bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 text-white font-semibold"
            size="sm"
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            Tam CSV İndir
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="!p-0">
          <Tabs defaultValue="columns" className="p-6 pt-5">
            <TabsList className="mb-4 flex-wrap h-auto !py-2 gap-1">
              <TabsTrigger value="columns" className="h-9">
                <Columns3 className="h-3.5 w-3.5 mr-1.5" />
                Kolonlar
                <Badge variant="outline" className="ml-2 !py-0 !px-2.5 text-[10px] h-auto">
                  {detail?.columns.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="indexes" className="h-9">
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                İndeksler
                <Badge variant="outline" className="ml-2 !py-0 !px-2.5 text-[10px] h-auto">
                  {detail?.indexes.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="constraints" className="h-9">
                <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                Kısıtlar
                <Badge variant="outline" className="ml-2 !py-0 !px-2.5 text-[10px] h-auto">
                  {detail?.constraints.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="preview" className="h-9">
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                Önizleme (100)
              </TabsTrigger>
              <TabsTrigger value="profile" className="h-9">
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                Profil
              </TabsTrigger>
              <TabsTrigger value="import" className="h-9">
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                CSV Import
              </TabsTrigger>
            </TabsList>

            <TabsContent value="columns">
              <Section title="Kolon Tanımı">
                {describeQuery.isLoading && <LoadingRow />}
                {!describeQuery.isLoading && !detail && (
                  <EmptyRow text="Tablo bilgisi yüklenemedi" />
                )}
                {detail && detail.columns.length === 0 && <EmptyRow text="Kolon bulunamadı" />}
                {detail && detail.columns.length > 0 && (
                  <div className="divide-y divide-white/5">
                    {detail.columns.map((c, i) => (
                      <div
                        key={i}
                        className="p-5 flex items-start gap-4 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex flex-col items-center pt-1 gap-1.5 w-10 shrink-0">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            #{i + 1}
                          </span>
                          <div className="h-8 w-8 rounded-full bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                            <Type className="h-3.5 w-3.5 text-indigo-400" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-mono font-semibold text-white text-base">
                              {c.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="bg-black/30 font-mono text-[11px]"
                            >
                              {c.data_type}
                            </Badge>
                            {!c.nullable && (
                              <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                                NOT NULL
                              </RiskBadge>
                            )}
                            {c.nullable && (
                              <RiskBadge riskLevel="INFO" size="sm" showIcon={false}>
                                NULLABLE
                              </RiskBadge>
                            )}
                          </div>
                          {c.default && (
                            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 inline-block max-w-full overflow-hidden">
                              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                                <Sparkles className="h-3 w-3" /> Default
                              </div>
                              <code className="text-xs font-mono text-zinc-300 block truncate">
                                {c.default}
                              </code>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </TabsContent>

            <TabsContent value="indexes">
              <Section title="İndeksler">
                {describeQuery.isLoading && <LoadingRow />}
                {!describeQuery.isLoading && !detail && <EmptyRow text="Tablo bilgisi yüklenemedi" />}
                {detail && detail.indexes.length === 0 && <EmptyRow text="İndeks tanımı yok" />}
                {detail && detail.indexes.length > 0 && (
                  <div className="space-y-2">
                    {detail.indexes.map((idx, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                            <KeyRound className="h-5 w-5 text-emerald-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono font-semibold text-white truncate">
                              {idx}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1">
                              {i + 1}. indeks
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </TabsContent>

            <TabsContent value="constraints">
              <Section title="Kısıtlar (Constraints)">
                {describeQuery.isLoading && <LoadingRow />}
                {!describeQuery.isLoading && !detail && <EmptyRow text="Tablo bilgisi yüklenemedi" />}
                {detail && detail.constraints.length === 0 && <EmptyRow text="Kısıt tanımı yok" />}
                {detail && detail.constraints.length > 0 && (
                  <div className="space-y-2">
                    {detail.constraints.map((cst, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-white/5 p-5"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
                            <GitBranch className="h-5 w-5 text-violet-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <pre className="font-mono text-sm text-zinc-300 whitespace-pre-wrap break-all">
                              {cst}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </TabsContent>

            <TabsContent value="preview">
              <Section title="SELECT * LIMIT 100">
                {previewQuery.isLoading && <LoadingRow />}
                {previewQuery.error && (
                  <EmptyRow
                    text={
                      "Önizleme yüklenemedi: " +
                      (((previewQuery.error as unknown) as { message?: string })
                        ?.message ?? "")
                    }
                  />
                )}
                {!previewQuery.isLoading && previewResult && (
                  <>
                    <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground px-2">
                      <span>
                        {previewResult.row_count} satır · {previewResult.columns.length} kolon
                      </span>
                      <span className="flex items-center gap-1.5">
                        <FileJson className="h-3 w-3" />
                        {previewResult.command} ·{' '}
                        <code className="font-mono">{previewResult.kind}</code>
                      </span>
                    </div>
                    <div className="overflow-x-auto max-h-[55vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/20">
                      <UITable>
                        <TableHeader className="sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
                          {previewTable.getHeaderGroups().map((hg) => (
                            <TableRow key={hg.id}>
                              {hg.headers.map((h) => (
                                <TableHead
                                  key={h.id}
                                  className="text-[11px] font-semibold whitespace-nowrap px-4 py-3"
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
                          {previewTable.getRowModel().rows.map((r) => (
                            <TableRow key={r.id}>
                              {r.getVisibleCells().map((c) => (
                                <TableCell key={c.id} className="px-4 py-2.5">
                                  {flexRender(
                                    c.column.columnDef.cell,
                                    c.getContext()
                                  )}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                          {previewTable.getRowModel().rows.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={previewColumns.length}
                                className="text-center py-16 text-muted-foreground"
                              >
                                0 satır
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </UITable>
                    </div>
                    {previewTable.getPageCount() > 1 && (
                      <div className="flex items-center justify-between px-2 pt-3">
                        <div className="text-xs text-muted-foreground">
                          Sayfa {previewTable.getState().pagination.pageIndex + 1} /{' '}
                          {previewTable.getPageCount()}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => previewTable.previousPage()}
                            disabled={!previewTable.getCanPreviousPage()}
                          >
                            <ChevronUp className="h-3.5 w-3.5 mr-1" />
                            Önceki
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => previewTable.nextPage()}
                            disabled={!previewTable.getCanNextPage()}
                          >
                            Sonraki
                            <ChevronDown className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Section>
            </TabsContent>

            <TabsContent value="profile">
              <Section title="Kolon Profili (NULL / Distinct / Boyut)">
                {profileQuery.isLoading && <LoadingRow />}
                {profileQuery.error && (
                  <EmptyRow text="Profil yüklenemedi" />
                )}
                {!profileQuery.isLoading && profileQuery.data && profileQuery.data.length > 0 && (
                  <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                    <UITable>
                      <TableHeader className="sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
                        {profileTable.getHeaderGroups().map((hg) => (
                          <TableRow key={hg.id}>
                            {hg.headers.map((h) => (
                              <TableHead
                                key={h.id}
                                style={{ width: h.getSize() }}
                                className="text-[11px] font-semibold whitespace-nowrap px-4 py-3"
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
                        {profileTable.getRowModel().rows.map((r) => (
                          <TableRow key={r.id}>
                            {r.getVisibleCells().map((c) => (
                              <TableCell
                                key={c.id}
                                style={{ width: c.column.getSize() }}
                                className="px-4 py-3"
                              >
                                {flexRender(
                                  c.column.columnDef.cell,
                                  c.getContext()
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </UITable>
                  </div>
                )}
              </Section>
            </TabsContent>

            <TabsContent value="import">
              <div className="space-y-6">
                <Section title="CSV İçe Aktarımı">
                  <form
                      onSubmit={form.handleSubmit(onFileSubmit)}
                      className="space-y-5"
                    >
                      <FormField
                        control={form.control}
                        name="file"
                        render={() => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">
                              CSV Dosyası
                            </FormLabel>
                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                              <FormControl>
                                <div className="relative">
                                  <Input
                                    type="file"
                                    accept=".csv,text/csv"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0] ?? null;
                                      setImportFile(f);
                                      setDryRunData(null);
                                      form.setValue('file', f ?? undefined);
                                    }}
                                    className="file:h-10 file:mr-4 file:rounded-full file:border-0 file:bg-gradient-to-r file:from-indigo-500 file:to-emerald-500 file:text-white file:px-4 file:text-sm file:font-semibold hover:file:opacity-90 cursor-pointer"
                                  />
                                </div>
                              </FormControl>
                              <Button
                                type="submit"
                                variant="outline"
                                disabled={!importFile || dryRunMutation.isPending}
                              >
                                <Sparkles className="h-4 w-4 mr-1.5" />
                                Dry Run Önizle
                              </Button>
                            </div>
                            <FormDescription>
                              Başlık satırı olan standart CSV. İlk önce Dry Run ile SQL önizlemesi alınır, sonra onay ile yazılır.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {dryRunMutation.isPending && (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center text-sm text-muted-foreground">
                          Dry Run çalıştırılıyor...
                        </div>
                      )}
                    </form>

                  {dryRunData && (
                    <div className="space-y-5 mt-6">
                      <div
                        className={cn(
                          'rounded-2xl border p-5 space-y-3',
                          dryRunData.result.risk === 'DANGEROUS'
                            ? 'border-red-500/40 bg-red-500/5'
                            : dryRunData.result.risk === 'MAINTENANCE'
                              ? 'border-amber-500/40 bg-amber-500/5'
                              : 'border-emerald-500/40 bg-emerald-500/5'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'h-10 w-10 rounded-full flex items-center justify-center shrink-0',
                              dryRunData.result.risk === 'DANGEROUS'
                                ? 'bg-red-500/15 text-red-400'
                                : dryRunData.result.risk === 'MAINTENANCE'
                                  ? 'bg-amber-500/15 text-amber-400'
                                  : 'bg-emerald-500/15 text-emerald-400'
                            )}
                          >
                            {dryRunData.result.risk === 'DANGEROUS' ? (
                              <AlertIcon className="h-5 w-5" />
                            ) : (
                              <CheckCircle2 className="h-5 w-5" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-white">
                                Dry Run Sonucu
                              </span>
                              <RiskBadge
                                riskLevel={
                                  dryRunData.result.risk === 'DANGEROUS'
                                    ? 'DANGEROUS'
                                    : dryRunData.result.risk === 'MAINTENANCE'
                                      ? 'MAINTENANCE'
                                      : 'OK'
                                }
                                size="sm"
                              >
                                {dryRunData.result.risk}
                              </RiskBadge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {dryRunData.result.note}
                            </p>
                            {dryRunData.result.target && (
                              <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                                Hedef: {dryRunData.result.target}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {dryRunData.result.sql && dryRunData.result.sql.length > 0 && (
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-3">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Hash className="h-3.5 w-3.5" />
                            SQL Önizlemesi
                          </div>
                          <div className="space-y-2">
                            {dryRunData.result.sql.map((s, i) => (
                              <pre
                                key={i}
                                className="rounded-xl bg-black/40 border border-white/5 p-4 text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all"
                              >
                                {s}
                              </pre>
                            ))}
                          </div>
                        </div>
                      )}

                      {dryRunData.previewRecords.length > 0 && (
                        <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                          <div className="px-5 py-3 border-b border-white/10 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Eye className="h-3.5 w-3.5" />
                            İlk {dryRunData.previewRecords.length} satır önizleme
                          </div>
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <UITable>
                              <TableHeader className="sticky top-0 bg-zinc-950/90 backdrop-blur">
                                <TableRow>
                                  {Object.keys(dryRunData.previewRecords[0]).map(
                                    (k) => (
                                      <TableHead
                                        key={k}
                                        className="text-[11px] font-semibold whitespace-nowrap px-4 py-2.5"
                                      >
                                        {k}
                                      </TableHead>
                                    )
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {dryRunData.previewRecords.map((r, i) => (
                                  <TableRow key={i}>
                                    {Object.values(r).map((v, j) => (
                                      <TableCell
                                        key={j}
                                        className="px-4 py-2 text-[11px] text-zinc-300 font-mono"
                                      >
                                        {v === null || v === undefined
                                          ? 'NULL'
                                          : String(v)}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </UITable>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end gap-3 pt-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setDryRunData(null);
                            setImportFile(null);
                            form.reset();
                          }}
                        >
                          Temizle
                        </Button>
                        <Button
                          onClick={handleConfirmImport}
                          disabled={importMutation.isPending}
                          className={cn(
                            dryRunData.result.risk === 'DANGEROUS'
                              ? 'bg-red-500 hover:bg-red-600 text-white font-bold'
                              : 'bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 text-white font-semibold'
                          )}
                        >
                          <Upload className="h-4 w-4 mr-1.5" />
                          {importMutation.isPending
                            ? 'İçe aktarılıyor...'
                            : 'Onayla ve İçe Aktar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </Section>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div className="h-px flex-1 bg-white/5" />
        <span>{title}</span>
        <div className="h-px flex-1 bg-white/5" />
      </div>
      {children}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-16 text-center text-muted-foreground">
      Yükleniyor...
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-16 text-center text-muted-foreground">
      {text}
    </div>
  );
}
