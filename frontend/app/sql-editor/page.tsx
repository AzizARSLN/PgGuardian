'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import Papa from 'papaparse';
import { toast } from 'sonner';
import {
  ChevronRight,
  ChevronDown,
  Database,
  Table,
  Eye,
  Hash,
  FunctionSquare,
  Play,
  Info,
  AlertTriangle,
  Wand2,
  Trash2,
  Download,
  Clock,
  History,
  TerminalSquare,
  FileJson,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { endpoints, type SqlResult, type DryRunResult } from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';

const HISTORY_KEY = 'pgguardian_sql_history';
const MAX_HISTORY = 50;

interface HistoryItem {
  query: string;
  timestamp: string;
  duration_ms: number;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]): void {
  try {
    const trimmed = items.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
  }
}

function downloadCSV(columns: string[], rows: unknown[][], filename: string) {
  const jsonData = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  const csv = Papa.unparse(jsonData);
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

type SchemaNode = {
  name: string;
  tables: string[];
  views: string[];
  sequences: string[];
  functions: string[];
  tablesLoaded: boolean;
};

export default function SqlEditorPage() {
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [sqlText, setSqlText] = React.useState<string>(
    '-- pgGuardian SQL Editor\nSELECT * FROM information_schema.tables LIMIT 50;'
  );
  const [resultTab, setResultTab] = React.useState<string>('results');
  const [sqlResult, setSqlResult] = React.useState<SqlResult | null>(null);
  const [messages, setMessages] = React.useState<string[]>([]);
  const [history, setHistory] = React.useState<HistoryItem[]>(() => loadHistory());

  const [expandedSchemas, setExpandedSchemas] = React.useState<
    Record<string, boolean>
  >({});
  const [expandedGroups, setExpandedGroups] = React.useState<
    Record<string, boolean>
  >({});
  const [schemaData, setSchemaData] = React.useState<Record<string, SchemaNode>>(
    {}
  );

  const schemasQuery = useQuery({
    queryKey: qk.schemas.all(),
    queryFn: endpoints.listSchemas,
  });

  function toggleSchema(schemaName: string) {
    setExpandedSchemas((prev) => {
      const next = { ...prev, [schemaName]: !prev[schemaName] };
      return next;
    });
    if (!schemaData[schemaName]) {
      setSchemaData((prev) => ({
        ...prev,
        [schemaName]: {
          name: schemaName,
          tables: [],
          views: [],
          sequences: [],
          functions: [],
          tablesLoaded: false,
        },
      }));
    }
  }

  function toggleGroup(schemaName: string, group: string) {
    const key = `${schemaName}:${group}`;
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
    const node = schemaData[schemaName];
    if (!node) return;
    if (group === 'tables' && !node.tablesLoaded) {
      loadSchemaObjects(schemaName);
    }
  }

  function loadSchemaObjects(schemaName: string) {
    Promise.all([
      endpoints.listTables(schemaName, 500).catch(() => [] as any[]),
      endpoints.listViews(schemaName).catch(() => [] as any[]),
      endpoints.listSequencesInSchema(schemaName).catch(() => [] as any[]),
      endpoints.listFunctions(schemaName).catch(() => [] as any[]),
    ]).then(([tables, views, sequences, functions]) => {
      setSchemaData((prev) => ({
        ...prev,
        [schemaName]: {
          name: schemaName,
          tables: (tables as any[]).map((t: any) => t.table_name ?? t.name ?? ''),
          views: (views as any[]).map((v: any) => v.view_name ?? v.name ?? ''),
          sequences: (sequences as any[]).map(
            (s: any) => s.sequence_name ?? s.name ?? ''
          ),
          functions: (functions as any[]).map(
            (f: any) => f.function_name ?? f.name ?? ''
          ),
          tablesLoaded: true,
        },
      }));
    });
  }

  const executeMutation = useMutation({
    mutationFn: (body: { sql: string }) =>
      endpoints.executeSql({ sql: body.sql, confirm: true, readonly: false }),
    onMutate: () => {
      setMessages((m) => [
        `[${formatDate(new Date())}] Sorgu çalıştırılıyor...`,
        ...m,
      ]);
    },
    onSuccess: (data, vars) => {
      if (data && 'row_count' in data) {
        const result = data as SqlResult;
        setSqlResult(result);
        setResultTab('results');
        const historyItem: HistoryItem = {
          query: vars.sql,
          timestamp: new Date().toISOString(),
          duration_ms: result.duration_ms,
        };
        const newHistory = [historyItem, ...history].slice(0, MAX_HISTORY);
        setHistory(newHistory);
        saveHistory(newHistory);
        setMessages((m) => [
          `[${formatDate(new Date())}] ${result.command} başarılı: ${result.row_count} satır, ${formatDuration(result.duration_ms)}`,
          ...m,
        ]);
        toast.success('Sorgu çalıştırıldı', {
          description: `${result.row_count} satır · ${formatDuration(result.duration_ms)}`,
        });
      } else if (data && 'risk' in data) {
        const dry = data as DryRunResult;
        toast.warning('Dry Run sonucu', {
          description: `${dry.risk} · ${dry.note}`,
        });
        setMessages((m) => [
          `[${formatDate(new Date())}] Dry Run: ${dry.risk} · ${dry.note}`,
          ...m,
        ]);
      }
    },
    onError: (err: any) => {
      setMessages((m) => [
        `[${formatDate(new Date())}] HATA: ${err?.message ?? 'Bilinmeyen hata'}`,
        ...m,
      ]);
    },
  });

  const explainMutation = useMutation({
    mutationFn: (body: { sql: string; analyze: boolean }) =>
      endpoints.explainSql({ sql: body.sql, analyze: body.analyze }),
    onMutate: (vars) => {
      setMessages((m) => [
        `[${formatDate(new Date())}] EXPLAIN${vars.analyze ? ' ANALYZE' : ''} çalıştırılıyor...`,
        ...m,
      ]);
    },
    onSuccess: (data, vars) => {
      const planText = JSON.stringify(data.plan, null, 2);
      setSqlResult({
        kind: 'READ',
        columns: ['Plan'],
        rows: [[planText]],
        row_count: 1,
        truncated: false,
        duration_ms: 0,
        command: vars.analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN',
      });
      setResultTab('results');
      toast.success(vars.analyze ? 'EXPLAIN ANALYZE tamamlandı' : 'EXPLAIN tamamlandı');
    },
  });

  const formatMutation = useMutation({
    mutationFn: (body: { sql: string }) => endpoints.formatSql(body),
    onSuccess: (data) => {
      setSqlText(data.formatted);
      toast.success('SQL formatlandı');
    },
  });

  function handleExecute() {
    const trimmed = sqlText.trim();
    if (!trimmed) {
      toast.warning('Sorgu boş');
      return;
    }
    executeMutation.mutate({ sql: trimmed });
  }

  function handleExplain(analyze: boolean) {
    const trimmed = sqlText.trim();
    if (!trimmed) {
      toast.warning('Sorgu boş');
      return;
    }
    explainMutation.mutate({ sql: trimmed, analyze });
  }

  function handleFormat() {
    const trimmed = sqlText.trim();
    if (!trimmed) {
      toast.warning('Sorgu boş');
      return;
    }
    formatMutation.mutate({ sql: trimmed });
  }

  function handleClear() {
    setSqlText('');
    setSqlResult(null);
    setMessages([]);
  }

  function insertObjectName(schema: string, name: string) {
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      ? `${schema}.${name}`
      : `"${schema}"."${name}"`;
    setSqlText((prev) => prev + '\n' + ident + '\n');
  }

  const dataRows = React.useMemo(() => {
    if (!sqlResult) return [];
    return sqlResult.rows.map((row, i) => {
      const obj: Record<string, unknown> & { __id: number } = { __id: i };
      sqlResult.columns.forEach((col, ci) => {
        obj[col] = row[ci];
      });
      return obj;
    });
  }, [sqlResult]);

  const resultColumns = React.useMemo<ColumnDef<any>[]>(() => {
    if (!sqlResult) return [];
    return [
      ...sqlResult.columns.map<ColumnDef<any>>((col) => ({
        accessorKey: col,
        header: col,
        cell: ({ getValue }) => {
          const v = getValue();
          if (v === null || v === undefined) return <span className="text-muted-foreground italic">NULL</span>;
          if (typeof v === 'object') return <code className="text-xs text-zinc-300">{JSON.stringify(v)}</code>;
          return String(v);
        },
      })),
    ];
  }, [sqlResult]);

  const resultTable = useReactTable({
    data: dataRows,
    columns: resultColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-6 min-h-[calc(100vh-10rem)]">
      <ConfirmDialog />
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">SQL Editor</h1>
          <p className="text-muted-foreground mt-1">
            Şema gezgini · sorgu yürütme · geçmiş · CSV dışa aktarım
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-4 py-2 text-sm bg-black/30">
            <TerminalSquare className="h-3.5 w-3.5 mr-1.5" />
            PostgreSQL
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1" style={{ minHeight: 720 }}>
        {/* Sol: Şema Ağacı */}
        <Card className="col-span-12 lg:col-span-3 overflow-hidden flex flex-col">
          <CardContent className="p-0 flex flex-col flex-1">
            <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-400" />
              <span className="font-semibold">Şema Ağacı</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
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
              {schemasQuery.data?.map((sch) => {
                const open = !!expandedSchemas[sch.name];
                const node = schemaData[sch.name];
                return (
                  <div key={sch.name}>
                    <button
                      type="button"
                      onClick={() => toggleSchema(sch.name)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/5 text-left transition-colors"
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <Database
                        className={cn(
                          'h-4 w-4 shrink-0',
                          sch.is_system
                            ? 'text-zinc-500'
                            : 'text-indigo-400'
                        )}
                      />
                      <span className="font-medium text-sm truncate">
                        {sch.name}
                      </span>
                      {sch.is_system && (
                        <Badge
                          variant="outline"
                          className="ml-auto text-[10px] px-2 py-0 h-auto"
                        >
                          system
                        </Badge>
                      )}
                    </button>
                    {open && (
                      <div className="ml-6 mt-1 space-y-0.5">
                        {(['tables', 'views', 'sequences', 'functions'] as const).map(
                          (grp) => {
                            const gkey = `${sch.name}:${grp}`;
                            const gopen = !!expandedGroups[gkey];
                            const icons = {
                              tables: Table,
                              views: Eye,
                              sequences: Hash,
                              functions: FunctionSquare,
                            } as const;
                            const Icon = icons[grp];
                            const items: string[] =
                              node && grp === 'tables'
                                ? node.tables
                                : node && grp === 'views'
                                  ? node.views
                                  : node && grp === 'sequences'
                                    ? node.sequences
                                    : node && grp === 'functions'
                                      ? node.functions
                                      : [];
                            return (
                              <div key={grp}>
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(sch.name, grp)}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 text-left transition-colors"
                                >
                                  {gopen ? (
                                    <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                  )}
                                  <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
                                  <span className="text-sm capitalize">
                                    {grp === 'tables'
                                      ? 'Tablolar'
                                      : grp === 'views'
                                        ? 'Görünümler'
                                        : grp === 'sequences'
                                          ? 'Diziler'
                                          : 'Fonksiyonlar'}
                                  </span>
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    {items.length}
                                  </span>
                                </button>
                                {gopen && (
                                  <div className="ml-6 mt-0.5 space-y-0.5 max-h-64 overflow-y-auto">
                                    {items.length === 0 ? (
                                      <div className="px-3 py-1.5 text-xs text-muted-foreground italic">
                                        Boş
                                      </div>
                                    ) : (
                                      items.map((it) => (
                                        <button
                                          key={it}
                                          type="button"
                                          onClick={() =>
                                            insertObjectName(sch.name, it)
                                          }
                                          className="w-full text-left px-3 py-1 rounded-md hover:bg-white/5 text-xs font-mono text-zinc-300 truncate"
                                          title="Sorguya ekle"
                                        >
                                          {it}
                                        </button>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Orta + Sağ: Editör + Sonuçlar */}
        <div className="col-span-12 lg:col-span-9 flex flex-col gap-6">
          <Card className="overflow-hidden flex flex-col">
            <CardContent className="p-0 flex flex-col flex-1">
              <div
                className="rounded-t-2xl border border-white/5 font-mono"
                style={{ background: '#09090b' }}
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <TerminalSquare className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs text-muted-foreground">
                      query.sql
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      pgsql
                    </span>
                    <span>UTF-8</span>
                  </div>
                </div>
                <div style={{ height: 280 }}>
                  <CodeMirror
                    value={sqlText}
                    height="280px"
                    theme={'dark'}
                    extensions={[sql()]}
                    onChange={(v: string) => setSqlText(v)}
                    basicSetup={{
                      lineNumbers: true,
                      highlightActiveLineGutter: true,
                      foldGutter: true,
                    }}
                    style={{
                      fontSize: 13,
                      background: '#09090b',
                    }}
                    className="text-emerald-400"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 p-4 border-b border-white/5 bg-black/20">
                <Button
                  onClick={handleExecute}
                  disabled={executeMutation.isPending}
                  className="bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 text-white font-semibold"
                >
                  <Play className="h-4 w-4" />
                  {executeMutation.isPending ? 'Çalışıyor...' : 'Execute (F5)'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleExplain(false)}
                  disabled={explainMutation.isPending}
                >
                  <Info className="h-4 w-4" />
                  Explain
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleExplain(true)}
                  disabled={explainMutation.isPending}
                  className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Explain Analyze
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleFormat}
                  disabled={formatMutation.isPending}
                >
                  <Wand2 className="h-4 w-4" />
                  Format
                </Button>
                <Button variant="ghost" onClick={handleClear}>
                  <Trash2 className="h-4 w-4" />
                  Temizle
                </Button>
              </div>

              <Tabs
                value={resultTab}
                onValueChange={setResultTab}
                className="p-6 pt-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <TabsList>
                    <TabsTrigger value="results">
                      Sonuçlar
                      {sqlResult && (
                        <span className="ml-2 text-xs opacity-75">
                          ({sqlResult.row_count})
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="messages">
                      Mesajlar ({messages.length})
                    </TabsTrigger>
                    <TabsTrigger value="history">
                      <History className="h-3.5 w-3.5 mr-1.5" />
                      Geçmiş ({history.length})
                    </TabsTrigger>
                  </TabsList>
                  {resultTab === 'results' && sqlResult && sqlResult.row_count > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadCSV(
                          sqlResult.columns,
                          sqlResult.rows,
                          `query_result_${Date.now()}.csv`
                        )
                      }
                    >
                      <Download className="h-4 w-4 mr-1.5" />
                      CSV İndir
                    </Button>
                  )}
                </div>

                <TabsContent value="results">
                  {!sqlResult && (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-16 text-center">
                      <FileJson className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        Henüz sonuç yok. Bir sorgu çalıştırın.
                      </p>
                    </div>
                  )}
                  {sqlResult && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                      {sqlResult.columns.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                          Komut: <strong className="text-white">{sqlResult.command}</strong> · 
                          Süre: <strong className="text-emerald-400">{formatDuration(sqlResult.duration_ms)}</strong>
                        </div>
                      ) : (
                        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                          <UITable>
                            <TableHeader className="sticky top-0 bg-zinc-950/90 backdrop-blur">
                              {resultTable.getHeaderGroups().map((hg) => (
                                <TableRow key={hg.id}>
                                  {hg.headers.map((h) => (
                                    <TableHead key={h.id} className="text-xs font-semibold">
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
                              {resultTable.getRowModel().rows.map((r) => (
                                <TableRow key={r.id}>
                                  {r.getVisibleCells().map((c) => (
                                    <TableCell key={c.id} className="text-xs py-3.5">
                                      {flexRender(
                                        c.column.columnDef.cell,
                                        c.getContext()
                                      )}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                              {resultTable.getRowModel().rows.length === 0 && (
                                <TableRow>
                                  <TableCell
                                    colSpan={resultColumns.length}
                                    className="text-center py-12 text-muted-foreground"
                                  >
                                    0 satır
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </UITable>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="messages">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-2 max-h-[420px] overflow-y-auto font-mono text-xs">
                    {messages.length === 0 && (
                      <div className="text-muted-foreground text-center py-8">
                        Henüz mesaj yok
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className="text-zinc-300 border-l-2 border-emerald-500/30 pl-3 py-1"
                      >
                        {msg}
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="history">
                  <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                    {history.length === 0 ? (
                      <div className="p-12 text-center text-muted-foreground">
                        Henüz sorgu geçmişi yok
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto">
                        {history.map((h, i) => (
                          <div
                            key={i}
                            className="p-4 hover:bg-white/5 cursor-pointer transition-colors group"
                            onClick={() => setSqlText(h.query)}
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                {formatDate(h.timestamp)}
                              </span>
                              <Badge variant="outline" className="ml-auto text-[10px] px-2 py-0.5 h-auto">
                                {formatDuration(h.duration_ms)}
                              </Badge>
                            </div>
                            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap line-clamp-2 group-hover:text-white">
                              {h.query}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
