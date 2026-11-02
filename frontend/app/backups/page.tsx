"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  Download,
  HardDriveUpload,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskBadge } from "@/components/ui/risk-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IfWriter } from "@/components/role-guard";

import { api, API_BASE_URL } from "@/lib/api/client";
import { endpoints, BackupJob, BackupRequest, BackupSchema, RestoreRequest } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import useConfirm from "@/lib/hooks/useConfirm";
import { useI18n, useT } from "@/lib/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { useAuthStore } from "@/store/useAuthStore";
import { getSelectedProfileFromStore, useProfileStore } from "@/store/useProfileStore";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";

type BackupStatus = "queued" | "running" | "done" | "failed";

/** The API also returns the owning profile; the shared type does not list it yet. */
type Job = BackupJob & {
  profile?: string | null;
  directory?: string | null;
  schemas?: string[];
};

/** Options the backups API accepts beyond the shared request type. */
type StartBackupBody = BackupRequest & {
  compression?: number;
  schema_names?: string[];
  directory?: string;
  table_name?: string;
  filename?: string;
};

const RUNNING_POLL_MS = 3000;
const CELL = "px-2 py-1.5 text-xs";
const HEAD = "h-8 px-2 text-xs";
const FIELD = "h-8 text-xs";
const EMPTY_FORM = {
  format: "custom",
  compression: "6",
  directory: "",
  table: "",
  filename: "",
  database: "",
};

const NO_SCHEMAS: BackupSchema[] = [];

interface DatabaseChoice {
  name: string;
  allow_connections: boolean;
}

function SectionTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted font-mono text-[10px]">
        {step}
      </span>
      {children}
    </p>
  );
}

function getStatusMeta(status: string): {
  level: BackupStatus;
  labelKey: string | null;
  icon: React.ComponentType<{ className?: string }>;
} {
  const s = (status || "").toLowerCase();
  if (s.includes("queue")) return { level: "queued", labelKey: "backups.status.queued", icon: Clock };
  if (s.includes("run") || s.includes("progress"))
    return { level: "running", labelKey: "backups.status.running", icon: Loader2 };
  if (s.includes("done") || s.includes("success") || s.includes("complete"))
    return { level: "done", labelKey: "backups.status.done", icon: CheckCircle2 };
  if (s.includes("fail") || s.includes("error"))
    return { level: "failed", labelKey: "backups.status.failed", icon: XCircle };
  return { level: "queued", labelKey: null, icon: AlertCircle };
}

function isUnfinished(job: BackupJob): boolean {
  const { level } = getStatusMeta(job.status);
  return level === "queued" || level === "running";
}

function isRestorable(job: BackupJob): boolean {
  return job.kind === "backup" && getStatusMeta(job.status).level === "done";
}

function isDirectoryBackup(job: BackupJob): boolean {
  return (job.file ?? "").toLowerCase().endsWith(".dir");
}

function isPlainBackup(job: BackupJob): boolean {
  return (job.file ?? "").toLowerCase().endsWith(".sql");
}

async function fetchBackupBlob(jobId: string): Promise<Blob> {
  const send = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const profile = getSelectedProfileFromStore();
    if (profile) headers["X-Profile-Name"] = encodeURIComponent(profile);
    return fetch(`${API_BASE_URL}/backups/${encodeURIComponent(jobId)}/download`, {
      headers,
      credentials: "include",
    });
  };

  const auth = useAuthStore.getState();
  let response = await send(auth.access_token);
  if (response.status === 401) {
    const refreshed = await auth.refreshAccessToken().catch(() => null);
    if (refreshed) response = await send(refreshed);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`);
  }
  return response.blob();
}

function StatusCell({ job }: { job: Job }) {
  const t = useT();
  const { level, labelKey, icon: Icon } = getStatusMeta(job.status);
  // The server reports orphaned jobs in English with a fixed prefix.
  const error = job.error?.startsWith("interrupted") ? t("backups.interrupted") : job.error;
  return (
    <div className="max-w-md space-y-1">
      <RiskBadge
        riskLevel={
          level === "done"
            ? "OK"
            : level === "failed"
              ? "DANGEROUS"
              : level === "running"
                ? "WARNING"
                : "INFO"
        }
        size="sm"
        showIcon={false}
      >
        <span className="flex items-center gap-1">
          <Icon className={cn("h-3 w-3", level === "running" && "animate-spin")} />
          {labelKey ? t(labelKey) : job.status || "-"}
        </span>
      </RiskBadge>
      {error && (
        <p
          className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-destructive"
          title={error}
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default function BackupsPage() {
  const t = useT();
  const { formatDate } = useI18n();
  const qc = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const selectedProfile = useProfileStore((s) => s.selectedProfileName);
  const refMs = autoRefresh ? pollInterval : false;

  const [createOpen, setCreateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState<Job | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [restoreDb, setRestoreDb] = useState("");
  const [restoreClean, setRestoreClean] = useState(false);

  // Unticked rather than ticked: every schema is included until taken out.
  const [unticked, setUnticked] = useState<string[]>([]);

  const optionsQuery = useQuery({
    queryKey: qk.backups.options(selectedProfile),
    queryFn: () => endpoints.getBackupOptions(),
    enabled: createOpen,
  });
  const databasesQuery = useQuery({
    queryKey: [...qk.databases.all(), selectedProfile],
    queryFn: () => api.get<DatabaseChoice[]>("/databases"),
    enabled: createOpen,
  });
  const chosenDatabase = form.database || optionsQuery.data?.default_database || "";
  const schemasQuery = useQuery({
    queryKey: qk.backups.schemas(selectedProfile, chosenDatabase),
    queryFn: () => endpoints.getBackupSchemas(chosenDatabase),
    enabled: createOpen && Boolean(chosenDatabase),
  });
  const schemas = schemasQuery.data ?? NO_SCHEMAS;
  const chosenSchemas = useMemo(
    () => schemas.map((schema) => schema.name).filter((name) => !unticked.includes(name)),
    [schemas, unticked]
  );
  const databaseChoices = useMemo(() => {
    const names = (databasesQuery.data ?? [])
      .filter((database) => database.allow_connections)
      .map((database) => database.name);
    return chosenDatabase && !names.includes(chosenDatabase) ? [chosenDatabase, ...names] : names;
  }, [databasesQuery.data, chosenDatabase]);

  const backupsQuery = useQuery({
    queryKey: qk.backups.all(),
    queryFn: () => endpoints.listBackups() as Promise<Job[]>,
    // Follow a running job even with auto-refresh off, and stop polling (and
    // repeating the error toast) once a request has failed.
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      if (query.state.data?.some(isUnfinished)) {
        return refMs ? Math.min(refMs, RUNNING_POLL_MS) : RUNNING_POLL_MS;
      }
      return refMs;
    },
  });
  const backups = backupsQuery.data;

  const sortedBackups = useMemo(() => {
    return [...(backups ?? [])].sort((a, b) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
      return tb - ta;
    });
  }, [backups]);

  const stats = useMemo(() => {
    const done = sortedBackups.filter(isRestorable);
    return {
      total: sortedBackups.length,
      size: done.reduce((acc, job) => acc + (job.size_bytes ?? 0), 0),
      lastAt: done[0]?.started_at ?? null,
      success: done.length,
      failed: sortedBackups.filter((job) => getStatusMeta(job.status).level === "failed").length,
    };
  }, [sortedBackups]);

  const formatWhen = (value?: string | null) => (value ? formatDate(value) : "-");

  const createBackupMutation = useMutation({
    mutationFn: (body: StartBackupBody) => endpoints.startBackup(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.backups.all() });
      toast.success(t("backups.toast.backupQueued"));
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setUnticked([]);
    },
    // The API client already shows why, for example an unwritable directory.
    onError: () => undefined,
  });

  const restoreMutation = useMutation({
    mutationFn: (body: RestoreRequest) => endpoints.startRestore(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.backups.all() });
      toast.success(t("backups.toast.restoreQueued"));
      setRestoreOpen(null);
      setRestoreDb("");
      setRestoreClean(false);
    },
    onError: () => toast.error(t("backups.toast.restoreFailed")),
  });

  const isPlainForm = form.format === "plain";
  const allSchemas = schemas.length > 0 && chosenSchemas.length === schemas.length;
  const canStart =
    schemasQuery.isSuccess && chosenSchemas.length > 0 && !createBackupMutation.isPending;

  const handleCreate = async () => {
    const directory = form.directory.trim() || optionsQuery.data?.default_directory || "";
    const ok = await confirm({
      title: t("backups.create"),
      description: t("backups.confirm.summary", {
        database: chosenDatabase,
        schemas: allSchemas ? t("backups.createDialog.allSchemas") : chosenSchemas.join(", "),
        directory,
        format: form.format.toUpperCase(),
      }),
      risk_level: "MAINTENANCE",
      confirm_label: t("backups.start"),
      cancel_label: t("common.cancel"),
    });
    if (!ok) return;

    createBackupMutation.mutate({
      confirm: true,
      format: form.format,
      database: chosenDatabase,
      directory: form.directory.trim() || undefined,
      // Everything ticked means the whole database, including objects outside schemas.
      schema_names: allSchemas && !form.table.trim() ? undefined : chosenSchemas,
      // pg_dump would gzip a plain .sql, which psql could not restore.
      compression: isPlainForm ? undefined : Number(form.compression),
      table_name: form.table.trim() || undefined,
      filename: form.filename.trim() || undefined,
    });
  };

  const openRestore = (job: Job) => {
    setRestoreOpen(job);
    setRestoreDb(job.database || "");
    setRestoreClean(false);
  };

  const handleRestore = async (job: Job) => {
    const dbName = restoreDb.trim();
    if (!dbName) {
      toast.error(t("backups.restore.databaseRequired"));
      return;
    }
    const clean = restoreClean && !isPlainBackup(job);
    const ok = await confirm({
      title: t("backups.restore.title"),
      description: t(clean ? "backups.confirm.restoreClean" : "backups.confirm.restore", {
        id: job.id,
        database: dbName,
      }),
      risk_level: "DANGEROUS",
      confirm_name_required: true,
      confirm_name_value: dbName,
      confirm_label: t("backups.restore.action"),
      cancel_label: t("common.cancel"),
    });
    if (!ok) return;

    restoreMutation.mutate({
      confirm: true,
      confirm_name: dbName,
      backup_id: job.id,
      database: dbName,
      clean,
    });
  };

  const handleDownload = async (job: Job) => {
    const toastId = `download-${job.id}`;
    try {
      toast.loading(t("backups.toast.downloadPreparing"), { id: toastId });
      const blob = await fetchBackupBlob(job.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = job.file || `backup-${job.id}.dump`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t("backups.toast.downloadStarted"), { id: toastId });
    } catch (error) {
      toast.error(t("backups.toast.downloadFailed"), {
        id: toastId,
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const columns: ColumnDef<Job>[] = [
    {
      accessorKey: "id",
      header: t("backups.columns.id"),
      cell: ({ row }) => <span className="font-mono">{row.original.id}</span>,
    },
    {
      accessorKey: "kind",
      header: t("backups.columns.kind"),
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.kind === "restore" ? "pg_restore" : "pg_dump"}
        </Badge>
      ),
    },
    {
      accessorKey: "profile",
      header: t("backups.columns.profile"),
      cell: ({ row }) => <span className="font-mono">{row.original.profile || "-"}</span>,
    },
    {
      accessorKey: "database",
      header: t("backups.columns.database"),
      cell: ({ row }) => <span className="font-mono">{row.original.database || "-"}</span>,
    },
    {
      accessorKey: "file",
      header: t("backups.columns.file"),
      cell: ({ row }) => (
        <div className="max-w-xs space-y-0.5">
          <p className="break-all font-mono">{row.original.file || "-"}</p>
          {row.original.directory && (
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {row.original.directory}
            </p>
          )}
          {row.original.schemas && row.original.schemas.length > 0 && (
            <p className="break-all font-mono text-[11px] text-info">
              {row.original.schemas.join(", ")}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: t("backups.columns.status"),
      cell: ({ row }) => <StatusCell job={row.original} />,
    },
    {
      accessorKey: "size_bytes",
      header: t("backups.columns.size"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono">
          {formatBytes(row.original.size_bytes ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "started_at",
      header: t("backups.columns.started"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-muted-foreground">
          {formatWhen(row.original.started_at)}
        </span>
      ),
    },
    {
      accessorKey: "finished_at",
      header: t("backups.columns.finished"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-muted-foreground">
          {formatWhen(row.original.finished_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("backups.columns.actions"),
      cell: ({ row }) => {
        const job = row.original;
        if (job.kind !== "backup") return null;
        const ready = isRestorable(job);
        const directory = isDirectoryBackup(job);
        return (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!ready || directory}
              title={directory ? t("backups.directoryDownloadHint") : undefined}
              onClick={() => handleDownload(job)}
            >
              <Download className="mr-1 h-3 w-3" />
              {t("backups.download")}
            </Button>
            <IfWriter>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!ready}
                onClick={() => openRestore(job)}
              >
                <HardDriveUpload className="mr-1 h-3 w-3" />
                {t("backups.restore.action")}
              </Button>
            </IfWriter>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: sortedBackups,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const pollLabel = refMs
    ? t("backups.pollEvery", { seconds: refMs / 1000 })
    : t("backups.pollManual");
  const restoreProfileMismatch = Boolean(
    restoreOpen?.profile && restoreOpen.profile !== selectedProfile
  );

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <DatabaseBackup className="h-4 w-4 text-info" />
            {t("backups.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("backups.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => backupsQuery.refetch()}
          >
            <RefreshCw
              className={cn("mr-1.5 h-3.5 w-3.5", backupsQuery.isFetching && "animate-spin")}
            />
            {t("common.refresh")}
          </Button>
          <IfWriter>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 text-xs">
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  {t("backups.create")}
                </Button>
              </DialogTrigger>
              <DialogContent className="md:max-w-xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <DatabaseBackup className="h-4 w-4 text-info" />
                    {t("backups.createDialog.title")}
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {t("backups.createDialog.description")}
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[65vh] space-y-4 overflow-y-auto py-1 pr-1">
                  <section className="space-y-1.5">
                    <SectionTitle step={1}>{t("backups.createDialog.locationStep")}</SectionTitle>
                    <Input
                      value={form.directory}
                      onChange={(e) => setForm({ ...form, directory: e.target.value })}
                      placeholder={optionsQuery.data?.default_directory}
                      aria-label={t("backups.createDialog.locationStep")}
                      className={cn(FIELD, "font-mono")}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {t("backups.createDialog.locationHint")}
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("backups.createDialog.filename")}</Label>
                      <Input
                        value={form.filename}
                        onChange={(e) => setForm({ ...form, filename: e.target.value })}
                        placeholder="nightly"
                        className={cn(FIELD, "font-mono")}
                      />
                    </div>
                  </section>

                  <section className="space-y-1.5">
                    <SectionTitle step={2}>{t("backups.createDialog.format")}</SectionTitle>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select
                        value={form.format}
                        onValueChange={(format) => setForm({ ...form, format })}
                      >
                        <SelectTrigger className={FIELD} aria-label={t("backups.createDialog.format")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["custom", "plain", "directory"].map((format) => (
                            <SelectItem key={format} value={format}>
                              {t(`backups.createDialog.formats.${format}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={form.compression}
                        disabled={isPlainForm}
                        onValueChange={(compression) => setForm({ ...form, compression })}
                      >
                        <SelectTrigger
                          className={FIELD}
                          aria-label={t("backups.createDialog.compression")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["0", "1", "3", "6", "9"].map((level) => (
                            <SelectItem key={level} value={level}>
                              {t(
                                level === "0"
                                  ? "backups.createDialog.levelNone"
                                  : level === "9"
                                    ? "backups.createDialog.levelMax"
                                    : "backups.createDialog.level",
                                { level }
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </section>

                  <section className="space-y-1.5">
                    <SectionTitle step={3}>{t("backups.createDialog.database")}</SectionTitle>
                    <Select
                      value={chosenDatabase}
                      onValueChange={(database) => {
                        setForm({ ...form, database, table: "" });
                        setUnticked([]);
                      }}
                    >
                      <SelectTrigger
                        className={cn(FIELD, "font-mono")}
                        aria-label={t("backups.createDialog.database")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {databaseChoices.map((name) => (
                          <SelectItem key={name} value={name} className="font-mono">
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </section>

                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <SectionTitle step={4}>{t("backups.createDialog.schemas")}</SectionTitle>
                      {schemas.length > 1 && (
                        <span className="flex gap-2 text-[11px]">
                          <button
                            type="button"
                            className="text-info hover:underline"
                            onClick={() => setUnticked([])}
                          >
                            {t("backups.createDialog.selectAll")}
                          </button>
                          <button
                            type="button"
                            className="text-info hover:underline"
                            onClick={() => setUnticked(schemas.map((schema) => schema.name))}
                          >
                            {t("backups.createDialog.selectNone")}
                          </button>
                        </span>
                      )}
                    </div>
                    {schemasQuery.isLoading || optionsQuery.isLoading ? (
                      <Skeleton className="h-16 w-full" />
                    ) : schemasQuery.isError || optionsQuery.isError ? (
                      <div className="rounded-md border border-destructive/40 px-2.5 py-2 text-xs" role="alert">
                        <p>{t("backups.createDialog.schemasFailed")}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1.5 h-6 px-2 text-[11px]"
                          onClick={() => {
                            optionsQuery.refetch();
                            schemasQuery.refetch();
                          }}
                        >
                          {t("common.retry")}
                        </Button>
                      </div>
                    ) : (
                      <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
                        {schemas.map((schema) => (
                          <li key={schema.name}>
                            <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50">
                              <Checkbox
                                checked={!unticked.includes(schema.name)}
                                onCheckedChange={(value) =>
                                  setUnticked((current) =>
                                    value === true
                                      ? current.filter((name) => name !== schema.name)
                                      : [...current, schema.name]
                                  )
                                }
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                {schema.name}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {t("backups.createDialog.schemaTables", { count: schema.tables })}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {chosenSchemas.length === 0 && schemasQuery.isSuccess
                        ? t("backups.createDialog.pickOne")
                        : allSchemas
                          ? t("backups.createDialog.wholeDatabase")
                          : t("backups.createDialog.partialHint")}
                    </p>
                    {chosenSchemas.length === 1 && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("backups.createDialog.table")}</Label>
                        <Input
                          value={form.table}
                          onChange={(e) => setForm({ ...form, table: e.target.value })}
                          placeholder="orders"
                          className={cn(FIELD, "font-mono")}
                        />
                      </div>
                    )}
                  </section>

                  <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-xs text-warning">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t("backups.createDialog.warning")}
                  </p>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setCreateOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={handleCreate}
                    disabled={!canStart}
                  >
                    {createBackupMutation.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {t("backups.start")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </IfWriter>
        </div>
      </div>

      {!backupsQuery.isError && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {backupsQuery.isLoading ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[70px] w-full rounded-md" />)
          ) : (
            <>
              <StatTile
                label={t("backups.stats.total")}
                value={String(stats.total)}
                hint={t("backups.stats.totalHint", {
                  success: stats.success,
                  failed: stats.failed,
                })}
              />
              <StatTile
                label={t("backups.stats.success")}
                value={String(stats.success)}
                tone="text-success"
                hint={
                  stats.lastAt
                    ? t("backups.stats.last", { date: formatWhen(stats.lastAt) })
                    : t("backups.stats.none")
                }
              />
              <StatTile
                label={t("backups.stats.size")}
                value={formatBytes(stats.size, 1)}
                hint={t("backups.stats.sizeHint")}
              />
              <StatTile
                label={t("backups.stats.failed")}
                value={String(stats.failed)}
                tone={stats.failed > 0 ? "text-destructive" : "text-foreground"}
                hint={t("backups.stats.failedHint")}
              />
            </>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{t("backups.list.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("backups.list.subtitle", { poll: pollLabel, count: sortedBackups.length })}
          </p>
        </div>
        {backupsQuery.isError ? (
          <div className="flex items-center justify-between gap-2 px-3 py-3" role="alert">
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t("common.loadFailed")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => backupsQuery.refetch()}
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              {t("common.retry")}
            </Button>
          </div>
        ) : backupsQuery.isLoading ? (
          <div className="space-y-1.5 p-3" aria-label={t("common.loading")}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : sortedBackups.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">{t("backups.list.emptyTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("backups.list.emptyHint")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <TableHead key={header.id} className={HEAD}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn(CELL, "align-top")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!restoreOpen} onOpenChange={(open) => !open && setRestoreOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <HardDriveUpload className="h-4 w-4 text-destructive" />
              {t("backups.restore.title")}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {restoreOpen
                ? `#${restoreOpen.id} · ${formatBytes(restoreOpen.size_bytes ?? 0)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="restore-db" className="text-xs">
                {t("backups.restore.database")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="restore-db"
                value={restoreDb}
                onChange={(e) => setRestoreDb(e.target.value)}
                placeholder={t("backups.restore.databasePlaceholder")}
                className={cn(FIELD, "font-mono")}
              />
              <p className="text-xs text-muted-foreground">{t("backups.restore.databaseHint")}</p>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
              <Checkbox
                id="restore-clean"
                className="mt-0.5"
                checked={restoreClean}
                disabled={restoreOpen ? isPlainBackup(restoreOpen) : false}
                onCheckedChange={(value) => setRestoreClean(value === true)}
              />
              <div>
                <Label htmlFor="restore-clean" className="cursor-pointer text-xs">
                  {t("backups.restore.clean")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    restoreOpen && isPlainBackup(restoreOpen)
                      ? "backups.restore.cleanPlainHint"
                      : "backups.restore.cleanHint"
                  )}
                </p>
              </div>
            </div>
            {restoreProfileMismatch && restoreOpen && (
              <p
                className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("backups.restore.profileMismatch", {
                  profile: restoreOpen.profile ?? "",
                })}
              </p>
            )}
            <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("backups.restore.warning")}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setRestoreOpen(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              disabled={!restoreDb.trim() || restoreMutation.isPending || restoreProfileMismatch}
              onClick={() => restoreOpen && handleRestore(restoreOpen)}
            >
              {restoreMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("backups.restore.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-base font-semibold", tone)}>{value}</div>
      <div className="truncate text-xs text-muted-foreground" title={hint}>
        {hint}
      </div>
    </div>
  );
}
