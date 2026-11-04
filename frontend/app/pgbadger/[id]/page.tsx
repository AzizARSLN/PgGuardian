"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Download, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IfWriter } from "@/components/role-guard";
import { CodeBlock } from "@/components/statements/code-block";
import { ApiError } from "@/lib/api/client";
import {
  pgbadgerApi,
  type ExportSection,
  type Finding,
  type FindingTask,
  type ReportDetail,
  type Role,
  type Severity,
  type TaskStatus,
} from "@/lib/api/pgbadger";
import { useRole } from "@/lib/hooks/use-role";
import { OpStopButton, useOpControl } from "@/lib/hooks/use-op-control";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useProfileStore } from "@/store/useProfileStore";

const ROLES: Role[] = ["backend", "ui", "db"];
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const STATUSES: TaskStatus[] = ["todo", "doing", "done"];
const SECTIONS: ExportSection[] = ["all", "summary", "findings", "backend", "ui", "db"];

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

const LOAD_COLOR: Record<string, string> = {
  application: "bg-primary",
  backup: "bg-warning",
  test: "bg-destructive",
  job: "bg-info",
  tool: "bg-success",
  unknown: "bg-muted-foreground",
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", SEVERITY_STYLE[severity])}>
      {t(`pgbadger.severity.${severity}`)}
    </span>
  );
}

function TaskRow({
  task,
  onChange,
  canEdit,
}: {
  task: FindingTask;
  onChange: (status: TaskStatus) => void;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  return (
    <li className="flex items-start gap-2 py-1.5">
      <select
        value={task.status}
        disabled={!canEdit}
        aria-label={t("pgbadger.tasks")}
        onChange={(event) => onChange(event.target.value as TaskStatus)}
        className={cn(
          "h-6 shrink-0 rounded border border-input bg-card px-1 text-[11px]",
          task.status === "done" && "text-success",
          task.status === "doing" && "text-warning"
        )}
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(`pgbadger.task.${status}`)}
          </option>
        ))}
      </select>
      <div className="min-w-0 text-xs leading-relaxed">
        <p className={cn("break-words", task.status === "done" && "text-muted-foreground line-through")}>
          {task.text}
        </p>
        {task.updated_by && (
          <p className="text-[10px] text-muted-foreground">{task.updated_by}</p>
        )}
      </div>
    </li>
  );
}

function FindingCard({
  finding,
  roles,
  onTask,
  canEdit,
  open,
}: {
  finding: Finding;
  roles: Role[];
  onTask: (taskId: string, status: TaskStatus) => void;
  canEdit: boolean;
  open?: boolean;
}) {
  const { t } = useI18n();
  const [showSql, setShowSql] = React.useState(false);
  const hasDetails = Boolean(finding.sql || finding.messages.length);
  return (
    <article className={cn("rounded-md border border-border bg-card p-3", finding.severity === "critical" && "border-destructive/60")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <h3 className="min-w-0 break-words text-[13px] font-semibold">{finding.title}</h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{finding.problem}</p>
      {finding.traits.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {finding.traits.map((trait) => (
            <span key={trait.code} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {trait.label}
            </span>
          ))}
        </div>
      )}
      {hasDetails && (
        <button
          type="button"
          onClick={() => setShowSql((v) => !v)}
          aria-expanded={showSql || open}
          className="mt-1.5 text-[11px] text-info hover:underline"
        >
          {finding.sql ? t("pgbadger.showSql") : t("pgbadger.messages")}
        </button>
      )}
      {(showSql || open) && finding.sql && <CodeBlock code={finding.sql} label="SQL" className="mt-1.5" />}
      {(showSql || open) && finding.messages.length > 0 && (
        <CodeBlock code={finding.messages.join("\n")} label={t("pgbadger.messages")} className="mt-1.5" />
      )}
      {roles.map((role) =>
        finding.tasks[role].length === 0 ? null : (
          <div key={role} className="mt-2">
            {roles.length > 1 && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`pgbadger.tabs.${role}`)}
              </p>
            )}
            <ul className="divide-y divide-border/60">
              {finding.tasks[role].map((task) => (
                <TaskRow key={task.id} task={task} canEdit={canEdit} onChange={(status) => onTask(task.id, status)} />
              ))}
            </ul>
          </div>
        )
      )}
    </article>
  );
}

function SummaryTab({ report, onTask, canEdit }: { report: ReportDetail; onTask: (id: string, s: TaskStatus) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const summary = report.summary;
  if (!summary) return null;
  const tiles = [
    [t("pgbadger.summary.queries"), summary.queries],
    [t("pgbadger.summary.duration"), summary.total_duration],
    [t("pgbadger.summary.locks"), summary.lock_wait],
    [t("pgbadger.summary.events"), summary.events],
    [t("pgbadger.summary.topShare"), `%${summary.top10_share}`],
    [t("pgbadger.summary.peak"), summary.peak],
  ];
  const top = report.findings.filter((f) => f.severity === "critical" || f.severity === "high");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-card px-3 py-2">
            <p className="truncate text-[11px] text-muted-foreground">{label}</p>
            <p className="font-mono text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="text-[13px] font-semibold">{t("pgbadger.summary.whereTitle")}</h2>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
          {summary.load.map((row) => (
            <div key={row.kind} title={row.kind} className={LOAD_COLOR[row.kind]} style={{ width: `${row.share}%` }} />
          ))}
        </div>
        <ul className="mt-2 space-y-1">
          {summary.load.map((row) => (
            <li key={row.kind} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className={cn("h-2 w-2 shrink-0 self-center rounded-full", LOAD_COLOR[row.kind])} />
              <span className="w-36 font-medium">{t(`pgbadger.kinds.${row.kind}`)}</span>
              <span className="w-12 text-right font-mono font-semibold">%{row.share}</span>
              <span className="w-24 font-mono text-muted-foreground">{row.duration}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={row.apps.join(", ")}>
                {row.apps.join(", ")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("pgbadger.summary.scope")}</p>
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        {ROLES.map((role) => (
          <div key={role} className="rounded-md border border-border bg-card px-3 py-2">
            <p className="text-xs font-semibold">{t(`pgbadger.tabs.${role}`)}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {t("pgbadger.progress", { done: report.totals[role].done, total: report.totals[role].total })}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold">{t("pgbadger.summary.topTitle")}</h2>
        {top.map((finding) => (
          <FindingCard key={finding.id} finding={finding} roles={ROLES} onTask={onTask} canEdit={canEdit} />
        ))}
      </section>
    </div>
  );
}

function FindingsTab({ report, onTask, canEdit }: { report: ReportDetail; onTask: (id: string, s: TaskStatus) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const [filter, setFilter] = React.useState<Severity | "all">("all");
  const counts = (severity: Severity) => report.findings.filter((f) => f.severity === severity).length;
  const rows = report.findings.filter((f) => filter === "all" || f.severity === filter);
  return (
    <div className="space-y-2">
      <div role="group" className="flex flex-wrap gap-1">
        {(["all", ...SEVERITIES] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
              filter === key ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {key === "all" ? t("pgbadger.filterAll") : t(`pgbadger.severity.${key}`)}
            <span className="font-mono font-semibold">{key === "all" ? report.findings.length : counts(key)}</span>
          </button>
        ))}
      </div>
      {rows.map((finding) => (
        <FindingCard key={finding.id} finding={finding} roles={ROLES} onTask={onTask} canEdit={canEdit} />
      ))}
    </div>
  );
}

function RoleTab({ role, report, onTask, canEdit }: { role: Role; report: ReportDetail; onTask: (id: string, s: TaskStatus) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const rows = report.findings.filter((f) => f.tasks[role].length > 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t(`pgbadger.roleDesc.${role}`)}{" "}
        <span className="font-mono">
          {t("pgbadger.progress", { done: report.totals[role].done, total: report.totals[role].total })}
        </span>
      </p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-center text-xs text-muted-foreground">{t("pgbadger.noTasks")}</p>
      ) : (
        rows.map((finding) => (
          <FindingCard key={finding.id} finding={finding} roles={[role]} onTask={onTask} canEdit={canEdit} />
        ))
      )}
    </div>
  );
}

export default function PgBadgerReportPage() {
  const { t, locale, formatDate } = useI18n();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const profile = useProfileStore((s) => s.selectedProfileName);
  const { isDBA } = useRole();
  // Analyzing a large report is a long server-side job, so it can be stopped.
  const analyzeOp = useOpControl();
  const key = ["pgbadger", profile, id, locale];

  const report = useQuery({ queryKey: key, queryFn: () => pgbadgerApi.detail(id, locale) });

  const analyze = useMutation({
    mutationFn: () => {
      const handle = analyzeOp.begin("pgbadger");
      return pgbadgerApi.analyze(id, locale, { opId: handle.opId, signal: handle.signal });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      queryClient.invalidateQueries({ queryKey: ["pgbadger", profile] });
      toast.success(t("pgbadger.analyzed"));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 499) return;
    },
    onSettled: () => analyzeOp.end(),
  });

  const setTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      pgbadgerApi.setTask(id, taskId, status),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const onTask = (taskId: string, status: TaskStatus) => setTask.mutate({ taskId, status });

  const handleExport = async (section: ExportSection, format: "html" | "md") => {
    const text = await pgbadgerApi.exportText(id, section, format, locale);
    const url = URL.createObjectURL(
      new Blob([text], { type: format === "html" ? "text/html" : "text/markdown" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pgbadger-${id}-${section}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t("pgbadger.exported"));
    queryClient.invalidateQueries({ queryKey: key });
  };

  const data = report.data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <Link href="/pgbadger" aria-label={t("pgbadger.back")}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{data?.filename ?? t("pgbadger.title")}</h1>
            {data && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {data.period_start} - {data.period_end}
                {data.analyzed_at && ` · ${formatDate(data.analyzed_at)}`}
              </p>
            )}
          </div>
        </div>
        {data && (
          <div className="flex items-center gap-2">
            {data.analyzed && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download /> {t("pgbadger.export.button")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {SECTIONS.map((section, index) => (
                    <React.Fragment key={section}>
                      {index > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="py-1 text-xs">
                        {t(`pgbadger.export.sections.${section}`)}
                      </DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => handleExport(section, "html")} className="text-xs">
                        {t("pgbadger.export.html")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport(section, "md")} className="text-xs">
                        {t("pgbadger.export.md")}
                      </DropdownMenuItem>
                    </React.Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <IfWriter>
              <Button size="sm" variant={data.analyzed ? "outline" : "default"} onClick={() => analyze.mutate()} disabled={analyze.isPending}>
                {analyze.isPending ? <Loader2 className="animate-spin" /> : data.analyzed ? <RefreshCw /> : <Play />}
                {t(analyze.isPending ? "pgbadger.analyzing" : data.analyzed ? "pgbadger.again" : "pgbadger.start")}
              </Button>
              <OpStopButton control={analyzeOp} className="h-8" />
            </IfWriter>
          </div>
        )}
      </div>

      {report.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {report.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          {(report.error as Error).message}
          <Button variant="outline" size="sm" className="h-6 px-2" onClick={() => report.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {data && !data.analyzed && (
        <p className="rounded-md border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          {t("pgbadger.notAnalyzed")}
        </p>
      )}

      {data?.analyzed && (
        <Tabs defaultValue="summary">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="summary">{t("pgbadger.tabs.summary")}</TabsTrigger>
            <TabsTrigger value="findings">
              {t("pgbadger.tabs.findings")} ({data.findings.length})
            </TabsTrigger>
            {ROLES.map((role) => (
              <TabsTrigger key={role} value={role}>
                {t(`pgbadger.tabs.${role}`)} ({data.totals[role].total - data.totals[role].done})
              </TabsTrigger>
            ))}
            <TabsTrigger value="activity">{t("pgbadger.tabs.activity")}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <SummaryTab report={data} onTask={onTask} canEdit={isDBA} />
          </TabsContent>
          <TabsContent value="findings">
            <FindingsTab report={data} onTask={onTask} canEdit={isDBA} />
          </TabsContent>
          {ROLES.map((role) => (
            <TabsContent key={role} value={role}>
              <RoleTab role={role} report={data} onTask={onTask} canEdit={isDBA} />
            </TabsContent>
          ))}
          <TabsContent value="activity">
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    {(["at", "actor", "action", "detail"] as const).map((column) => (
                      <th key={column} scope="col" className="px-3 py-2 font-medium">
                        {t(`pgbadger.activity.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.activity.map((entry, index) => (
                    <tr key={index} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">{formatDate(entry.at)}</td>
                      <td className="px-3 py-1.5">{entry.actor ?? "-"}</td>
                      <td className="px-3 py-1.5">{t(`pgbadger.activity.${entry.action}`)}</td>
                      <td className="break-all px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{entry.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
