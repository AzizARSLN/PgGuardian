"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileSearch, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IfWriter } from "@/components/role-guard";
import { formatBytes } from "@/components/statements/format";
import { ApiError } from "@/lib/api/client";
import { pgbadgerApi, type ReportListItem } from "@/lib/api/pgbadger";
import useConfirm from "@/lib/hooks/useConfirm";
import { OpStopButton, useOpControl } from "@/lib/hooks/use-op-control";
import { useI18n } from "@/lib/i18n";
import { useProfileStore } from "@/store/useProfileStore";

const NO_REPORTS: ReportListItem[] = [];

export default function PgBadgerPage() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  const profile = useProfileStore((s) => s.selectedProfileName);
  const input = React.useRef<HTMLInputElement>(null);
  // Report parsing happens server-side; the upload can therefore be stopped.
  const uploadOp = useOpControl();
  const key = ["pgbadger", profile];

  const reports = useQuery({ queryKey: key, queryFn: () => pgbadgerApi.list() });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const handle = uploadOp.begin("pgbadger");
      return pgbadgerApi.upload(file, { opId: handle.opId, signal: handle.signal });
    },
    onSuccess: ({ id }) => {
      toast.success(t("pgbadger.uploaded"));
      queryClient.invalidateQueries({ queryKey: key });
      router.push(`/pgbadger/${id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 499) return;
    },
    onSettled: () => uploadOp.end(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => pgbadgerApi.remove(id),
    onSuccess: () => {
      toast.success(t("pgbadger.deleted"));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const handleDelete = async (report: ReportListItem) => {
    const ok = await confirm({
      title: t("pgbadger.delete"),
      description: t("pgbadger.confirmDelete", { name: report.filename }),
      risk_level: "MAINTENANCE",
      confirm_label: t("pgbadger.delete"),
      cancel_label: t("common.cancel"),
    });
    if (ok) remove.mutate(report.id);
  };

  const rows = reports.data ?? NO_REPORTS;

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FileSearch className="h-4 w-4 text-info" />
            {t("pgbadger.title")}
            <span className="font-mono text-xs font-normal text-muted-foreground">{profile}</span>
          </h1>
          <p className="text-xs text-muted-foreground">{t("pgbadger.subtitle")}</p>
        </div>
        <IfWriter>
          <input
            ref={input}
            type="file"
            accept=".html,.htm,text/html"
            className="hidden"
            aria-label={t("pgbadger.upload")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
            {t(upload.isPending ? "pgbadger.uploading" : "pgbadger.upload")}
          </Button>
          <OpStopButton control={uploadOp} className="h-8" />
        </IfWriter>
      </div>

      <p className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        {t("pgbadger.privacy")}
      </p>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        {reports.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {t("common.loadFailed")}
            <Button variant="outline" size="sm" className="h-6 px-2" onClick={() => reports.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : reports.isLoading ? (
          <Loader2 className="m-4 h-5 w-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">{t("pgbadger.empty")}</p>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {(["file", "period", "uploaded", "status", "actions"] as const).map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 font-medium">
                    {t(`pgbadger.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((report) => (
                <tr key={report.id} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-1.5">
                    <Link href={`/pgbadger/${report.id}`} className="font-mono font-medium hover:text-info">
                      {report.filename}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{formatBytes(report.size_bytes)}</p>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {report.period_start} - {report.period_end}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {report.uploaded_by ?? "-"}
                    <p className="text-[11px]">{formatDate(report.uploaded_at)}</p>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        report.analyzed_at
                          ? "rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success"
                          : "rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning"
                      }
                    >
                      {t(report.analyzed_at ? "pgbadger.status.done" : "pgbadger.status.waiting")}
                    </span>
                  </td>
                  <td className="px-3 py-1">
                    <div className="flex items-center gap-1">
                      <Button asChild variant="outline" size="sm" className="h-7 px-2">
                        <Link href={`/pgbadger/${report.id}`}>{t("pgbadger.open")}</Link>
                      </Button>
                      <IfWriter>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label={t("pgbadger.delete")}
                          onClick={() => handleDelete(report)}
                        >
                          <Trash2 />
                        </Button>
                      </IfWriter>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
