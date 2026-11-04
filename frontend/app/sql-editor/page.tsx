'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import CodeMirror, { EditorView, Prec } from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useTheme } from 'next-themes';
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
  RotateCcw,
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
import { IfWriter } from '@/components/role-guard';
import { ApiError } from '@/lib/api/client';
import { endpoints, type SqlResult, type DryRunResult } from '@/lib/api/types';
import { qk } from '@/lib/api/queryKeys';
import { useI18n, useT } from '@/lib/i18n';
import { useRole } from '@/lib/hooks/use-role';
import { OpBlockedHint, OpStopButton, useOpControl } from '@/lib/hooks/use-op-control';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/hooks/useConfirm';

const HISTORY_KEY = 'pgguardian_sql_history';
const MAX_HISTORY = 50;
const TREE_LIMIT = 500;

interface HistoryItem {
  query: string;
  timestamp: string;
  duration_ms: number;
}

type ResultRow = unknown[];
type GroupId = 'tables' | 'views' | 'sequences' | 'functions';

const GROUPS: {
  id: GroupId;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'tables', labelKey: 'sqlEditor.tree.tables', icon: Table },
  { id: 'views', labelKey: 'sqlEditor.tree.views', icon: Eye },
  { id: 'sequences', labelKey: 'sqlEditor.tree.sequences', icon: Hash },
  { id: 'functions', labelKey: 'sqlEditor.tree.functions', icon: FunctionSquare },
];

/** Names only: the raw list keys are shared with other pages, so these get a suffix. */
function groupQuery(schema: string, group: GroupId) {
  const encoded = encodeURIComponent(schema);
  switch (group) {
    case 'tables':
      return {
        queryKey: [...qk.schemas.tables(schema, TREE_LIMIT), 'names'],
        queryFn: async () =>
          (await endpoints.listTables(encoded, TREE_LIMIT)).map((x) => x.table_name),
      };
    case 'views':
      return {
        queryKey: [...qk.schemas.views(schema), 'names'],
        queryFn: async () => (await endpoints.listViews(encoded)).map((x) => x.view_name),
      };
    case 'sequences':
      return {
        queryKey: [...qk.schemas.sequences(schema), 'names'],
        queryFn: async () =>
          (await endpoints.listSequencesInSchema(encoded)).map((x) => x.sequence_name),
      };
    case 'functions':
      return {
        queryKey: [...qk.schemas.functions(schema), 'names'],
        queryFn: async () =>
          (await endpoints.listFunctions(encoded)).map((x) => x.function_name),
      };
  }
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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {
    // History is a convenience; a full or blocked store must not break the editor.
  }
}

function csvValue(value: unknown): unknown {
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
}

/** Fields plus row arrays, so duplicate column names keep their own values. */
function downloadCSV(columns: string[], rows: ResultRow[], filename: string) {
  const csv = Papa.unparse({ fields: columns, data: rows.map((row) => row.map(csvValue)) });
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

function isSqlResult(data: SqlResult | DryRunResult): data is SqlResult {
  return 'row_count' in data;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function InlineError({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
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
      {detail && <p className="mt-1 break-words font-mono text-muted-foreground">{detail}</p>}
    </div>
  );
}

function SchemaGroup({
  schema,
  group,
  labelKey,
  icon: Icon,
  onInsert,
}: {
  schema: string;
  group: GroupId;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  onInsert: (schema: string, name: string) => void;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  const [open, setOpen] = React.useState(false);
  const query = useQuery({ ...groupQuery(schema, group), enabled: open });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-muted"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-success" />
        <span className="text-xs">{t(labelKey)}</span>
        {query.data && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {formatNumber(query.data.length)}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-5 max-h-56 space-y-px overflow-y-auto py-0.5">
          {query.isLoading && (
            <div className="px-2 py-1 text-xs text-muted-foreground">{t('common.loading')}</div>
          )}
          {query.isError && (
            <InlineError detail={errorText(query.error, '')} onRetry={() => query.refetch()} />
          )}
          {query.data?.length === 0 && (
            <div className="px-2 py-1 text-xs italic text-muted-foreground">
              {t('sqlEditor.tree.empty')}
            </div>
          )}
          {query.data?.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onInsert(schema, name)}
              className="block w-full truncate rounded px-2 py-0.5 text-left font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t('sqlEditor.tree.insert')}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SqlEditorPage() {
  const t = useT();
  const { formatNumber, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const { hasRole } = useRole();
  const { resolvedTheme } = useTheme();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const canWrite = hasRole(['Admin', 'DBA']);
  // Tracks the running statement so it can be stopped (client abort + backend cancel).
  const op = useOpControl();

  const [sqlText, setSqlText] = React.useState<string>(
    () => `-- ${t('sqlEditor.editor.starterComment')}\nSELECT * FROM information_schema.tables LIMIT 50;`
  );
  const [resultTab, setResultTab] = React.useState<string>('results');
  const [sqlResult, setSqlResult] = React.useState<SqlResult | null>(null);
  const [runError, setRunError] = React.useState<{ message: string; retry: () => void } | null>(null);
  const [messages, setMessages] = React.useState<string[]>([]);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [expandedSchemas, setExpandedSchemas] = React.useState<Record<string, boolean>>({});

  // Read after mount: localStorage is absent during SSR, so reading it in the
  // initial state made the tab count differ from the server render.
  React.useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const schemasQuery = useQuery({
    queryKey: qk.schemas.all(),
    queryFn: endpoints.listSchemas,
  });

  const editorTheme = React.useMemo(
    () =>
      Prec.highest(
        EditorView.theme({
          '&': {
            backgroundColor: 'hsl(var(--card))',
            color: 'hsl(var(--foreground))',
          },
          '.cm-gutters': {
            backgroundColor: 'hsl(var(--muted))',
            color: 'hsl(var(--muted-foreground))',
            borderColor: 'hsl(var(--border))',
          },
          '.cm-activeLine, .cm-activeLineGutter': {
            backgroundColor: 'hsl(var(--muted) / 0.5)',
          },
        })
      ),
    []
  );
  const editorExtensions = React.useMemo(() => [sql(), editorTheme], [editorTheme]);

  function duration(ms: number): string {
    if (ms < 1000) return `${formatNumber(ms, { maximumFractionDigits: 1 })} ms`;
    return `${formatNumber(ms / 1000, { maximumFractionDigits: 2 })} s`;
  }

  function log(text: string) {
    setMessages((m) => [`[${formatDate(new Date())}] ${text}`, ...m]);
  }

  const executeMutation = useMutation({
    // The dry run classifies the statement on the server, so reads run directly
    // and anything that changes data goes through the confirm dialog first.
    mutationFn: async (text: string): Promise<SqlResult | null> => {
      let result: SqlResult | DryRunResult;
      if (!canWrite) {
        const handle = op.begin('sql');
        result = await endpoints.executeSql(
          { sql: text, readonly: true },
          { opId: handle.opId, signal: handle.signal }
        );
      } else {
        const plan = await endpoints.executeSql({ sql: text, dry_run: true, readonly: false });
        if (isSqlResult(plan)) return plan;
        if (plan.risk === 'READ') {
          const handle = op.begin('sql');
          result = await endpoints.executeSql(
            { sql: text, readonly: true },
            { opId: handle.opId, signal: handle.signal }
          );
        } else {
          const ok = await confirm({
            title: t('sqlEditor.confirm.title'),
            description: t('sqlEditor.confirm.description', { risk: plan.risk }),
            risk_level: plan.risk,
            sql_preview: plan.sql,
            confirm_label: t('sqlEditor.confirm.run'),
            cancel_label: t('common.cancel'),
          });
          if (!ok) return null;
          const handle = op.begin('sql');
          result = await endpoints.executeSql(
            { sql: text, confirm: true, readonly: false },
            { opId: handle.opId, signal: handle.signal }
          );
        }
      }
      return isSqlResult(result) ? result : null;
    },
    onMutate: () => {
      setRunError(null);
      log(t('sqlEditor.messages.running'));
    },
    onSuccess: (result, text) => {
      if (!result) {
        log(t('sqlEditor.messages.cancelled'));
        return;
      }
      setSqlResult(result);
      setResultTab('results');
      setHistory((prev) => {
        const next = [
          { query: text, timestamp: new Date().toISOString(), duration_ms: result.duration_ms },
          ...prev,
        ].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
      const summary = t('sqlEditor.messages.summary', {
        rows: formatNumber(result.row_count),
        duration: duration(result.duration_ms),
      });
      log(t('sqlEditor.messages.success', { command: result.command, summary }));
      toast.success(t('sqlEditor.toast.executed'), { description: summary });
      // DDL and writes can change the object tree and table statistics.
      if (result.kind !== 'READ') {
        queryClient.invalidateQueries({ queryKey: qk.schemas.all() });
      }
    },
    onError: (err, text) => {
      // 499 is our own client abort ("Durdur"); stay quiet.
      if (err instanceof ApiError && err.status === 499) {
        log(t('sqlEditor.messages.cancelled'));
        return;
      }
      const message = errorText(err, t('sqlEditor.unknownError'));
      log(t('sqlEditor.messages.failed', { message }));
      setRunError({ message, retry: () => executeMutation.mutate(text) });
      setResultTab('results');
    },
    onSettled: () => op.end(),
  });

  const explainMutation = useMutation({
    mutationFn: (body: { sql: string; analyze: boolean }) => {
      const handle = op.begin('explain');
      return endpoints.explainSql(body, { opId: handle.opId, signal: handle.signal });
    },
    onMutate: (vars) => {
      setRunError(null);
      log(t('sqlEditor.messages.explaining', { command: vars.analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN' }));
    },
    onSuccess: (data, vars) => {
      const command = vars.analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN';
      setSqlResult({
        kind: 'READ',
        columns: ['Plan'],
        rows: [[JSON.stringify(data.plan, null, 2)]],
        row_count: 1,
        truncated: false,
        duration_ms: 0,
        command,
      });
      setResultTab('results');
      toast.success(t('sqlEditor.toast.explained', { command }));
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.status === 499) {
        log(t('sqlEditor.messages.cancelled'));
        return;
      }
      const message = errorText(err, t('sqlEditor.unknownError'));
      log(t('sqlEditor.messages.failed', { message }));
      setRunError({ message, retry: () => explainMutation.mutate(vars) });
      setResultTab('results');
    },
    onSettled: () => op.end(),
  });

  const formatMutation = useMutation({
    mutationFn: (body: { sql: string }) => endpoints.formatSql(body),
    onSuccess: (data) => {
      setSqlText(data.formatted);
      toast.success(t('sqlEditor.toast.formatted'));
    },
    onError: (err) => {
      log(t('sqlEditor.messages.failed', { message: errorText(err, t('sqlEditor.unknownError')) }));
    },
  });

  const busy = executeMutation.isPending || explainMutation.isPending;

  function currentSql(): string | null {
    const trimmed = sqlText.trim();
    if (!trimmed) {
      toast.warning(t('sqlEditor.toast.empty'));
      return null;
    }
    return trimmed;
  }

  function handleExecute() {
    if (busy) return;
    const text = currentSql();
    if (text) executeMutation.mutate(text);
  }

  function handleExplain(analyze: boolean) {
    if (busy) return;
    const text = currentSql();
    if (text) explainMutation.mutate({ sql: text, analyze });
  }

  function handleFormat() {
    const text = currentSql();
    if (text) formatMutation.mutate({ sql: text });
  }

  function handleClear() {
    setSqlText('');
    setSqlResult(null);
    setRunError(null);
    setMessages([]);
  }

  function insertObjectName(schema: string, name: string) {
    // Always quoted: mixed case and reserved words break when left bare.
    setSqlText((prev) => `${prev}\n${quoteIdent(schema)}.${quoteIdent(name)}\n`);
  }

  // The button advertises F5, which previously just reloaded the page.
  const executeRef = React.useRef(handleExecute);
  React.useEffect(() => {
    executeRef.current = handleExecute;
  });
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'F5') return;
      e.preventDefault();
      executeRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Columns are addressed by position because names can repeat, and a name
  // containing a dot would be read as a nested path by accessorKey.
  const resultColumns = React.useMemo<ColumnDef<ResultRow>[]>(() => {
    if (!sqlResult) return [];
    return sqlResult.columns.map<ColumnDef<ResultRow>>((col, index) => ({
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
        const text = String(v);
        return text.includes('\n') ? <pre className="whitespace-pre">{text}</pre> : text;
      },
    }));
  }, [sqlResult]);

  const resultTable = useReactTable({
    data: sqlResult?.rows ?? [],
    columns: resultColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('sqlEditor.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('sqlEditor.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <IfWriter
            fallback={
              <Badge variant="outline" className="text-xs">
                {t('sqlEditor.readOnlyMode')}
              </Badge>
            }
          >
            <Badge variant="outline" className="border-warning/40 text-xs text-warning">
              {t('sqlEditor.writeMode')}
            </Badge>
          </IfWriter>
          <Badge variant="outline" className="text-xs">
            <TerminalSquare className="mr-1 h-3 w-3" />
            PostgreSQL
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-3">
          <CardContent className="flex flex-1 flex-col !p-0">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Database className="h-3.5 w-3.5 text-success" />
              <span className="text-xs font-semibold">{t('sqlEditor.tree.title')}</span>
            </div>
            <div className="max-h-[720px] flex-1 space-y-px overflow-y-auto p-1.5">
              {schemasQuery.isLoading && (
                <div className="p-2 text-xs text-muted-foreground">{t('common.loading')}</div>
              )}
              {schemasQuery.isError && (
                <InlineError
                  detail={errorText(schemasQuery.error, '')}
                  onRetry={() => schemasQuery.refetch()}
                />
              )}
              {schemasQuery.data?.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">{t('common.noData')}</div>
              )}
              {schemasQuery.data?.map((sch) => {
                const open = !!expandedSchemas[sch.name];
                return (
                  <div key={sch.name}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSchemas((prev) => ({ ...prev, [sch.name]: !prev[sch.name] }))
                      }
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <Database
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          sch.is_system ? 'text-muted-foreground' : 'text-info'
                        )}
                      />
                      <span className="truncate font-mono text-xs font-medium">{sch.name}</span>
                      {sch.is_system && (
                        <Badge variant="outline" className="ml-auto h-auto px-1.5 py-0 text-[10px]">
                          {t('sqlEditor.tree.system')}
                        </Badge>
                      )}
                    </button>
                    {open && (
                      <div className="ml-4 space-y-px">
                        {GROUPS.map((g) => (
                          <SchemaGroup
                            key={g.id}
                            schema={sch.name}
                            group={g.id}
                            labelKey={g.labelKey}
                            icon={g.icon}
                            onInsert={insertObjectName}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="col-span-12 flex flex-col gap-3 lg:col-span-9">
          <Card className="flex flex-col overflow-hidden">
            <CardContent className="flex flex-1 flex-col !p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 font-mono">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs text-muted-foreground">query.sql</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-success/20 bg-success/10 px-1.5 text-success">
                    pgsql
                  </span>
                  <span>UTF-8</span>
                </div>
              </div>
              <CodeMirror
                value={sqlText}
                height="240px"
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                extensions={editorExtensions}
                onChange={(v: string) => setSqlText(v)}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  foldGutter: true,
                }}
                style={{ fontSize: 13 }}
              />

              <OpBlockedHint control={op} className="mx-3 mt-1.5" />

              <div className="flex flex-wrap items-center gap-1.5 border-y border-border bg-muted/40 px-3 py-1.5">
                <Button size="sm" onClick={handleExecute} disabled={busy}>
                  <Play className="h-3.5 w-3.5" />
                  {executeMutation.isPending ? t('sqlEditor.actions.running') : t('sqlEditor.actions.execute')}
                </Button>
                <OpStopButton control={op} />
                <Button variant="outline" size="sm" onClick={() => handleExplain(false)} disabled={busy}>
                  <Info className="h-3.5 w-3.5" />
                  EXPLAIN
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExplain(true)}
                  disabled={busy}
                  className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  EXPLAIN ANALYZE
                </Button>
                <Button variant="secondary" size="sm" onClick={handleFormat} disabled={formatMutation.isPending}>
                  <Wand2 className="h-3.5 w-3.5" />
                  {t('sqlEditor.actions.format')}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleClear}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('sqlEditor.actions.clear')}
                </Button>
              </div>

              <Tabs value={resultTab} onValueChange={setResultTab} className="p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <TabsList className="h-8">
                    <TabsTrigger value="results" className="h-6 text-xs">
                      {t('sqlEditor.tabs.results')}
                      {sqlResult && (
                        <span className="ml-1.5 font-mono opacity-75">
                          {formatNumber(sqlResult.row_count)}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="messages" className="h-6 text-xs">
                      {t('sqlEditor.tabs.messages')}
                      <span className="ml-1.5 font-mono opacity-75">{formatNumber(messages.length)}</span>
                    </TabsTrigger>
                    <TabsTrigger value="history" className="h-6 text-xs">
                      <History className="mr-1 h-3 w-3" />
                      {t('sqlEditor.tabs.history')}
                      <span className="ml-1.5 font-mono opacity-75">{formatNumber(history.length)}</span>
                    </TabsTrigger>
                  </TabsList>
                  {resultTab === 'results' && sqlResult && sqlResult.rows.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadCSV(sqlResult.columns, sqlResult.rows, `query_result_${Date.now()}.csv`)
                      }
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('sqlEditor.actions.downloadCsv')}
                    </Button>
                  )}
                </div>

                <TabsContent value="results" className="space-y-2">
                  {runError && <InlineError detail={runError.message} onRetry={runError.retry} />}
                  {busy && (
                    <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                      {t('sqlEditor.actions.running')}
                    </div>
                  )}
                  {!sqlResult && !runError && !busy && (
                    <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                      <FileJson className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">{t('sqlEditor.results.empty')}</p>
                    </div>
                  )}
                  {sqlResult && (
                    <>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{sqlResult.command}</span>
                        <span>
                          {t(sqlResult.kind === 'READ' ? 'sqlEditor.results.rows' : 'sqlEditor.results.affected', {
                            count: formatNumber(sqlResult.row_count),
                          })}
                        </span>
                        <span className="text-success">{duration(sqlResult.duration_ms)}</span>
                        {sqlResult.truncated && (
                          <Badge variant="outline" className="h-auto border-warning/40 px-1.5 py-0 text-[11px] text-warning">
                            {t('sqlEditor.results.truncated')}
                          </Badge>
                        )}
                      </div>
                      {sqlResult.columns.length > 0 && (
                        <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                          <UITable>
                            <TableHeader className="sticky top-0 z-10 bg-card">
                              {resultTable.getHeaderGroups().map((hg) => (
                                <TableRow key={hg.id}>
                                  {hg.headers.map((h) => (
                                    <TableHead key={h.id} className="h-7 whitespace-nowrap px-2 font-mono text-xs font-semibold">
                                      {h.isPlaceholder
                                        ? null
                                        : flexRender(h.column.columnDef.header, h.getContext())}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              ))}
                            </TableHeader>
                            <TableBody>
                              {resultTable.getRowModel().rows.map((r) => (
                                <TableRow key={r.id}>
                                  {r.getVisibleCells().map((c) => (
                                    <TableCell key={c.id} className="px-2 py-1.5 font-mono text-xs">
                                      {flexRender(c.column.columnDef.cell, c.getContext())}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                              {resultTable.getRowModel().rows.length === 0 && (
                                <TableRow>
                                  <TableCell
                                    colSpan={resultColumns.length}
                                    className="py-4 text-center text-xs text-muted-foreground"
                                  >
                                    {t('sqlEditor.results.noRows')}
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </UITable>
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="messages">
                  <div className="max-h-[420px] space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
                    {messages.length === 0 && (
                      <div className="py-4 text-center text-muted-foreground">
                        {t('sqlEditor.messages.empty')}
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <div key={i} className="border-l-2 border-success/30 pl-2 text-muted-foreground">
                        {msg}
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="history">
                  <div className="overflow-hidden rounded-md border border-border">
                    {history.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        {t('sqlEditor.history.empty')}
                      </div>
                    ) : (
                      <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                        {history.map((h, i) => (
                          <button
                            key={i}
                            type="button"
                            className="group block w-full px-3 py-1.5 text-left transition-colors hover:bg-muted"
                            onClick={() => setSqlText(h.query)}
                          >
                            <div className="mb-0.5 flex items-center gap-2">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatDate(h.timestamp)}
                              </span>
                              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                                {duration(h.duration_ms)}
                              </span>
                            </div>
                            <pre className="line-clamp-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground group-hover:text-foreground">
                              {h.query}
                            </pre>
                          </button>
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
