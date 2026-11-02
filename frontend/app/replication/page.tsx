"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { endpoints, ReplicaInfo, SlotInfo } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/lib/utils";
import { useI18n, useT } from "@/lib/i18n";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";

const LAG_WARNING_BYTES = 10 * 1024 * 1024;
const LAG_DANGEROUS_BYTES = 100 * 1024 * 1024;
const HEAD = "h-8 px-3 py-1.5 text-xs font-semibold text-muted-foreground";
const CELL = "px-3 py-1.5 text-xs align-middle";
const METRIC = "font-mono tabular-nums";

function lagRisk(bytes: number): "OK" | "WARNING" | "DANGEROUS" {
  if (bytes > LAG_DANGEROUS_BYTES) return "DANGEROUS";
  if (bytes > LAG_WARNING_BYTES) return "WARNING";
  return "OK";
}

function replicaRisk(replica: ReplicaInfo): "OK" | "WARNING" | "DANGEROUS" {
  const risk = lagRisk(replica.replay_lag_bytes ?? 0);
  return risk === "OK" && replica.state !== "streaming" ? "WARNING" : risk;
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const message = error instanceof Error ? error.message : "";
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <span className="font-medium text-foreground">{t("common.loadFailed")}</span>
      {message && <span className="min-w-0 truncate text-muted-foreground">{message}</span>}
      <Button variant="outline" size="sm" onClick={onRetry} className="h-6 px-2 text-xs">
        {t("common.retry")}
      </Button>
    </div>
  );
}

export default function ReplicationPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: qk.replication.status(),
    queryFn: () => endpoints.getReplication(),
    refetchInterval: autoRefresh ? pollInterval : false,
  });

  const replicas = useMemo(() => data?.replicas ?? [], [data]);
  const slots = useMemo(() => data?.slots ?? [], [data]);

  const metrics = useMemo(
    () => ({
      streaming: replicas.filter((r) => (r.state ?? "").toLowerCase() === "streaming").length,
      maxLag: replicas.reduce((max, r) => Math.max(max, r.replay_lag_bytes ?? 0), 0),
      activeSlots: slots.filter((s) => s.active).length,
    }),
    [replicas, slots]
  );

  const slotColumns = useMemo<ColumnDef<SlotInfo>[]>(
    () => [
      {
        accessorKey: "slot_name",
        header: () => t("replication.slots.name"),
        cell: ({ row }) => (
          <span className="font-mono font-medium text-foreground">{row.original.slot_name}</span>
        ),
      },
      {
        accessorKey: "slot_type",
        header: () => t("replication.slots.type"),
        cell: ({ row }) => (
          <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[11px] font-medium">
            {row.original.slot_type ?? "-"}
          </Badge>
        ),
      },
      {
        accessorKey: "active",
        header: () => t("replication.slots.status"),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                row.original.active ? "bg-success" : "bg-muted-foreground"
              }`}
            />
            <span
              className={
                row.original.active ? "font-medium text-success" : "font-medium text-muted-foreground"
              }
            >
              {row.original.active ? t("replication.slots.active") : t("replication.slots.inactive")}
            </span>
          </span>
        ),
      },
    ],
    [t]
  );

  const slotTable = useReactTable<SlotInfo>({
    data: slots,
    columns: slotColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: { pagination: { pageSize: 25, pageIndex: 0 } },
  });

  const { pageIndex, pageSize } = slotTable.getState().pagination;

  const tiles = [
    { label: t("replication.tiles.replicas"), value: formatNumber(replicas.length) },
    { label: t("replication.tiles.streaming"), value: formatNumber(metrics.streaming) },
    { label: t("replication.tiles.maxLag"), value: formatBytes(metrics.maxLag) },
    {
      label: t("replication.tiles.slots"),
      value: `${formatNumber(metrics.activeSlots)} / ${formatNumber(slots.length)}`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("replication.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("replication.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {data && !isError && replicas.length > 0 && (
            <RiskBadge riskLevel={lagRisk(metrics.maxLag)} size="sm">
              {t("replication.systemLag")}
            </RiskBadge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{tile.label}</p>
                {isLoading ? (
                  <Skeleton className="mt-1 h-5 w-16" />
                ) : (
                  <p className={`${METRIC} text-base font-semibold text-foreground`}>{tile.value}</p>
                )}
              </div>
            ))}
          </div>

          <section className="overflow-hidden rounded-md border border-border bg-card">
            <header className="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2">
              <h2 className="text-xs font-semibold text-foreground">{t("replication.replicas.title")}</h2>
              <p className="text-[11px] text-muted-foreground">{t("replication.replicas.subtitle")}</p>
            </header>
            {isLoading ? (
              <div className="space-y-1.5 p-3">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : replicas.length === 0 ? (
              <div className="px-3 py-2 text-xs">
                <p className="font-medium text-foreground">{t("replication.replicas.emptyTitle")}</p>
                <p className="text-muted-foreground">{t("replication.replicas.emptyDesc")}</p>
              </div>
            ) : (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className={HEAD}>{t("replication.replicas.application")}</TableHead>
                    <TableHead className={HEAD}>{t("replication.replicas.client")}</TableHead>
                    <TableHead className={HEAD}>{t("replication.replicas.user")}</TableHead>
                    <TableHead className={HEAD}>{t("replication.replicas.state")}</TableHead>
                    <TableHead className={`${HEAD} text-right`}>
                      {t("replication.replicas.replayLag")}
                    </TableHead>
                    <TableHead className={HEAD}>{t("replication.replicas.risk")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replicas.map((replica, idx) => (
                    <TableRow key={idx} className="border-border">
                      <TableCell className={`${CELL} font-medium text-foreground`}>
                        {replica.application_name ??
                          t("replication.replicas.fallbackName", { n: idx + 1 })}
                      </TableCell>
                      <TableCell className={`${CELL} font-mono text-muted-foreground`}>
                        {replica.client_address ?? "-"}
                      </TableCell>
                      <TableCell className={`${CELL} font-mono text-muted-foreground`}>
                        {replica.username ?? "-"}
                      </TableCell>
                      <TableCell className={CELL}>{replica.state ?? "-"}</TableCell>
                      <TableCell className={`${CELL} ${METRIC} text-right text-foreground`}>
                        {formatBytes(replica.replay_lag_bytes ?? 0)}
                      </TableCell>
                      <TableCell className={CELL}>
                        <RiskBadge riskLevel={replicaRisk(replica)} size="sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="overflow-hidden rounded-md border border-border bg-card">
            <header className="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2">
              <h2 className="text-xs font-semibold text-foreground">{t("replication.slots.title")}</h2>
              <p className="text-[11px] text-muted-foreground">{t("replication.slots.subtitle")}</p>
            </header>
            {isLoading ? (
              <div className="space-y-1.5 p-3">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : slots.length === 0 ? (
              <div className="px-3 py-2 text-xs">
                <p className="font-medium text-foreground">{t("replication.slots.emptyTitle")}</p>
                <p className="text-muted-foreground">{t("replication.slots.emptyDesc")}</p>
              </div>
            ) : (
              <>
                <Table className="text-xs">
                  <TableHeader>
                    {slotTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id} className="border-border hover:bg-transparent">
                        {hg.headers.map((h) => (
                          <TableHead key={h.id} className={HEAD}>
                            {h.isPlaceholder
                              ? null
                              : flexRender(h.column.columnDef.header, h.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {slotTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id} className="border-border">
                        {row.getVisibleCells().map((c) => (
                          <TableCell key={c.id} className={CELL}>
                            {flexRender(c.column.columnDef.cell, c.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {slotTable.getPageCount() > 1 && (
                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
                    <p className={`${METRIC} text-[11px] text-muted-foreground`}>
                      {t("replication.slots.range", {
                        from: pageIndex * pageSize + 1,
                        to: Math.min((pageIndex + 1) * pageSize, slots.length),
                        total: slots.length,
                      })}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => slotTable.previousPage()}
                        disabled={!slotTable.getCanPreviousPage()}
                      >
                        {t("replication.slots.previous")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => slotTable.nextPage()}
                        disabled={!slotTable.getCanNextPage()}
                      >
                        {t("replication.slots.next")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
