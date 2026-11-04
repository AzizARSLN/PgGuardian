"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Camera,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
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

import { endpoints, Snapshot } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import useConfirm from "@/lib/hooks/useConfirm";
import { OpStopButton, useOpControl } from "@/lib/hooks/use-op-control";
import { useI18n, useT } from "@/lib/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { useProfileStore } from "@/store/useProfileStore";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";

const LIST_LIMIT = 5000;
const PRUNE_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;
// The list key varies by profile, so invalidate every variant through its prefix.
const SNAPSHOTS_PREFIX = ["snapshots"];

const CELL = "px-2 py-1.5 text-xs";
const HEAD = "h-8 px-2 text-xs";

function scoreTone(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-destructive";
}

function usageRisk(ratio: number): RiskLevel {
  if (ratio >= 0.85) return "DANGEROUS";
  if (ratio >= 0.6) return "WARNING";
  return "OK";
}

function riskTone(risk: RiskLevel): string {
  if (risk === "DANGEROUS") return "text-destructive font-semibold";
  if (risk === "WARNING") return "text-warning font-semibold";
  return "";
}

function useFormatAgo() {
  const { locale } = useI18n();
  return React.useCallback(
    (value: string) => {
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return "-";
      const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const seconds = Math.round((time - Date.now()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 60) return format.format(seconds, "second");
      if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
      if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
      return format.format(Math.round(seconds / 86400), "day");
    },
    [locale]
  );
}

export default function SnapshotsPage() {
  const t = useT();
  const { formatNumber, formatDate } = useI18n();
  const formatAgo = useFormatAgo();
  const qc = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();
  // Capture and prune each run server-side work, so each gets its own control.
  const captureOp = useOpControl();
  const pruneOp = useOpControl();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const profile = useProfileStore((s) => s.selectedProfileName) ?? undefined;
  const refMs = autoRefresh ? pollInterval : false;

  const [notesFilter, setNotesFilter] = useState("");

  const snapshotsQuery = useQuery({
    queryKey: qk.snapshots.all(profile, undefined, undefined, LIST_LIMIT),
    queryFn: () => endpoints.listSnapshots(profile, undefined, undefined, LIST_LIMIT),
    refetchInterval: (query) => (query.state.status === "error" ? false : refMs),
  });
  const snapshots = snapshotsQuery.data;

  const captureMutation = useMutation({
    // The store labels a snapshot with this name; without it the snapshot would
    // not show up in this profile's list.
    mutationFn: () => {
      const handle = captureOp.begin("snapshot");
      return endpoints.captureSnapshot(profile, undefined, {
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SNAPSHOTS_PREFIX });
      toast.success(t("snapshots.toast.captured"));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 499) return;
      toast.error(t("snapshots.toast.captureFailed"));
    },
    onSettled: () => captureOp.end(),
  });

  const pruneMutation = useMutation({
    mutationFn: () => {
      const handle = pruneOp.begin("prune");
      return endpoints.pruneSnapshots(PRUNE_DAYS, {
        opId: handle.opId,
        signal: handle.signal,
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: SNAPSHOTS_PREFIX });
      toast.success(
        t("snapshots.toast.pruned", { removed: result.removed, days: result.keep_days })
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 499) return;
      toast.error(t("snapshots.toast.pruneFailed"));
    },
    onSettled: () => pruneOp.end(),
  });

  const sortedSnapshots = useMemo(() => {
    return [...(snapshots ?? [])].sort((a, b) => {
      const ta = a.taken_at ? new Date(a.taken_at).getTime() : 0;
      const tb = b.taken_at ? new Date(b.taken_at).getTime() : 0;
      return tb - ta;
    });
  }, [snapshots]);

  const filteredSnapshots = useMemo(() => {
    const needle = notesFilter.trim().toLowerCase();
    if (!needle) return sortedSnapshots;
    return sortedSnapshots.filter((s) =>
      [s.database, s.host, s.profile, s.server, s.status, s.server_version]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [sortedSnapshots, notesFilter]);

  const stats = useMemo(() => {
    const now = Date.now();
    const old = sortedSnapshots.filter(
      (s) => s.taken_at && now - new Date(s.taken_at).getTime() > PRUNE_DAYS * DAY_MS
    );
    const avgScore =
      sortedSnapshots.length > 0
        ? Math.round(
            sortedSnapshots.reduce((acc, s) => acc + (s.score ?? 0), 0) / sortedSnapshots.length
          )
        : 0;
    return {
      total: sortedSnapshots.length,
      latest: sortedSnapshots[0] ?? null,
      oldCount: old.length,
      avgScore,
    };
  }, [sortedSnapshots]);

  const handleCapture = async () => {
    const ok = await confirm({
      title: t("snapshots.capture"),
      description: t("snapshots.confirm.capture"),
      risk_level: "MAINTENANCE",
      confirm_label: t("snapshots.capture"),
      cancel_label: t("common.cancel"),
    });
    if (ok) captureMutation.mutate();
  };

  const handlePrune = async () => {
    // Pruning spans every profile and this list is scoped and capped, so its
    // count cannot decide whether there is anything to prune.
    const ok = await confirm({
      title: t("snapshots.confirm.pruneTitle"),
      description: t("snapshots.confirm.prune", { days: PRUNE_DAYS }),
      risk_level: "DANGEROUS",
      confirm_name_required: true,
      confirm_name_value: "prune",
      confirm_name_placeholder: t("snapshots.confirm.prunePlaceholder"),
      confirm_label: t("common.delete"),
      cancel_label: t("common.cancel"),
    });
    if (ok) pruneMutation.mutate();
  };

  const latest = stats.latest;
  const connectionRatio = latest ? latest.connections / Math.max(1, latest.max_connections) : 0;
  const pollLabel = refMs
    ? t("snapshots.pollEvery", { seconds: refMs / 1000 })
    : t("snapshots.pollManual");

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Camera className="h-4 w-4 text-info" />
            {t("snapshots.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("snapshots.subtitle")}
            {" · "}
            {profile ? (
              <span className="font-mono">{profile}</span>
            ) : (
              t("snapshots.allProfiles")
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => snapshotsQuery.refetch()}
          >
            <RefreshCw
              className={cn("mr-1.5 h-3.5 w-3.5", snapshotsQuery.isFetching && "animate-spin")}
            />
            {t("common.refresh")}
          </Button>
          <IfWriter>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              onClick={handlePrune}
              disabled={pruneMutation.isPending}
            >
              {pruneMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("snapshots.prune", { days: PRUNE_DAYS })}
            </Button>
            <OpStopButton control={pruneOp} className="h-8 text-xs" />
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleCapture}
              disabled={captureMutation.isPending}
            >
              {captureMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("snapshots.capture")}
            </Button>
            <OpStopButton control={captureOp} className="h-8 text-xs" />
          </IfWriter>
        </div>
      </div>

      {!snapshotsQuery.isError && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {snapshotsQuery.isLoading ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[70px] w-full rounded-md" />)
          ) : (
            <>
              <StatTile
                icon={<Camera className="h-3.5 w-3.5 text-info" />}
                label={t("snapshots.stats.total")}
                value={formatNumber(stats.total)}
                hint={
                  stats.oldCount > 0
                    ? t("snapshots.stats.old", { count: stats.oldCount, days: PRUNE_DAYS })
                    : t("snapshots.stats.noneOld", { days: PRUNE_DAYS })
                }
              />
              <StatTile
                icon={<TrendingUp className="h-3.5 w-3.5 text-success" />}
                label={t("snapshots.stats.avgScore")}
                value={formatNumber(stats.avgScore)}
                tone={stats.total > 0 ? scoreTone(stats.avgScore) : undefined}
                hint={
                  latest
                    ? t("snapshots.stats.last", { ago: formatAgo(latest.taken_at) })
                    : t("snapshots.stats.none")
                }
              />
              <StatTile
                icon={<Users className="h-3.5 w-3.5 text-info" />}
                label={t("snapshots.stats.latestConnections")}
                value={
                  latest
                    ? `${formatNumber(latest.connections)} / ${formatNumber(latest.max_connections)}`
                    : "-"
                }
                tone={latest ? riskTone(usageRisk(connectionRatio)) : undefined}
                hint={
                  latest
                    ? formatNumber(connectionRatio, {
                        style: "percent",
                        maximumFractionDigits: 0,
                      })
                    : "-"
                }
              />
              <StatTile
                icon={<HardDrive className="h-3.5 w-3.5 text-warning" />}
                label={t("snapshots.stats.latestSize")}
                value={latest ? formatBytes(latest.db_size_bytes ?? 0, 1) : "-"}
                hint={latest ? `${latest.host}:${latest.port}/${latest.database}` : "-"}
                monoHint
              />
            </>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t("snapshots.list.title")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("snapshots.list.subtitle", {
                poll: pollLabel,
                shown: filteredSnapshots.length,
                total: sortedSnapshots.length,
              })}
            </p>
          </div>
          <Input
            value={notesFilter}
            onChange={(e) => setNotesFilter(e.target.value)}
            placeholder={t("snapshots.list.filterPlaceholder")}
            aria-label={t("common.search")}
            className="h-8 w-full text-xs sm:max-w-xs"
          />
        </div>
        {snapshotsQuery.isError ? (
          <div className="flex items-center justify-between gap-2 px-3 py-3" role="alert">
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t("common.loadFailed")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => snapshotsQuery.refetch()}
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              {t("common.retry")}
            </Button>
          </div>
        ) : snapshotsQuery.isLoading ? (
          <div className="space-y-1.5 p-3" aria-label={t("common.loading")}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : filteredSnapshots.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">
              {t(
                sortedSnapshots.length === 0
                  ? "snapshots.list.emptyTitle"
                  : "snapshots.list.noMatchTitle"
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                sortedSnapshots.length === 0
                  ? "snapshots.list.emptyHint"
                  : "snapshots.list.noMatchHint"
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>{t("snapshots.columns.id")}</TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.score")}
                  </TableHead>
                  <TableHead className={HEAD}>{t("snapshots.columns.status")}</TableHead>
                  <TableHead className={HEAD}>{t("snapshots.columns.target")}</TableHead>
                  <TableHead className={HEAD}>{t("snapshots.columns.taken")}</TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.connections")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.size")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.dead")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.blocking")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.deadlocks")}
                  </TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>
                    {t("snapshots.columns.longQueries")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSnapshots.map((snap) => (
                  <SnapshotRow
                    key={snap.id}
                    snap={snap}
                    takenAt={snap.taken_at ? formatDate(snap.taken_at) : "-"}
                    ago={snap.taken_at ? formatAgo(snap.taken_at) : "-"}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function SnapshotRow({
  snap,
  takenAt,
  ago,
}: {
  snap: Snapshot;
  takenAt: string;
  ago: string;
}) {
  const { formatNumber } = useI18n();
  const blocking = snap.blocking_pairs ?? 0;
  const deadlocks = snap.deadlocks ?? 0;
  const longQueries = snap.long_queries ?? 0;
  const dead = snap.dead_tuples ?? 0;
  const totalTuples = (snap.live_tuples ?? 0) + dead;
  const deadRatio = totalTuples > 0 ? dead / totalTuples : 0;
  const score = snap.score ?? 0;

  const deadRisk: RiskLevel = deadRatio > 0.4 ? "DANGEROUS" : deadRatio > 0.2 ? "WARNING" : "OK";
  const longRisk: RiskLevel = longQueries > 20 ? "DANGEROUS" : longQueries > 5 ? "WARNING" : "OK";
  const connectionRisk = usageRisk((snap.connections ?? 0) / Math.max(1, snap.max_connections ?? 0));

  return (
    <TableRow>
      <TableCell className={cn(CELL, "font-mono")}>#{snap.id}</TableCell>
      <TableCell className={cn(CELL, "text-right font-mono font-semibold", scoreTone(score))}>
        {formatNumber(Math.round(score))}
      </TableCell>
      <TableCell className={CELL}>
        <Badge variant="outline" className="font-mono text-xs">
          {snap.status || "-"}
        </Badge>
      </TableCell>
      <TableCell className={cn(CELL, "font-mono")}>
        <div>
          {snap.host}:{snap.port}/{snap.database}
        </div>
        <div className="text-muted-foreground">
          {snap.profile ? `${snap.profile} · ` : ""}
          {snap.server_version}
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "whitespace-nowrap font-mono")}>
        <div>{takenAt}</div>
        <div className="text-muted-foreground">{ago}</div>
      </TableCell>
      <TableCell className={cn(CELL, "text-right font-mono", riskTone(connectionRisk))}>
        {formatNumber(snap.connections ?? 0)}/{formatNumber(snap.max_connections ?? 0)}
      </TableCell>
      <TableCell className={cn(CELL, "whitespace-nowrap text-right font-mono")}>
        {formatBytes(snap.db_size_bytes ?? 0, 0)}
      </TableCell>
      <TableCell className={cn(CELL, "text-right font-mono", riskTone(deadRisk))}>
        {formatNumber(dead)}
      </TableCell>
      <TableCell className={cn(CELL, "text-right font-mono", blocking > 0 && riskTone("DANGEROUS"))}>
        {formatNumber(blocking)}
      </TableCell>
      <TableCell className={cn(CELL, "text-right font-mono", deadlocks > 0 && riskTone("DANGEROUS"))}>
        {formatNumber(deadlocks)}
      </TableCell>
      <TableCell className={cn(CELL, "text-right font-mono", riskTone(longRisk))}>
        {formatNumber(longQueries)}
      </TableCell>
    </TableRow>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  tone,
  monoHint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: string;
  monoHint?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("font-mono text-base font-semibold", tone)}>{value}</div>
      <div className={cn("truncate text-xs text-muted-foreground", monoHint && "font-mono")} title={hint}>
        {hint}
      </div>
    </div>
  );
}
