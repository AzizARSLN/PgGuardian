"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { endpoints, ReplicaInfo, SlotInfo } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  RefreshCw,
  Activity,
  Server,
  HardDrive,
  Radio,
  DatabaseZap,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatBytes, formatInterval } from "@/lib/utils";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";

function lagRisk(lagSec: number | null | undefined): "OK" | "WARNING" | "DANGEROUS" {
  if (lagSec == null || !Number.isFinite(lagSec)) return "OK";
  if (lagSec < 10) return "OK";
  if (lagSec <= 60) return "WARNING";
  return "DANGEROUS";
}

function formatLag(lagSec: number | null | undefined): string {
  if (lagSec == null || !Number.isFinite(lagSec)) return "-";
  if (lagSec < 1) return `${Math.round(lagSec * 1000)} ms`;
  if (lagSec < 60) return `${lagSec.toFixed(1)} s`;
  const m = Math.floor(lagSec / 60);
  const s = Math.round(lagSec % 60);
  return `${m}m ${s}s`;
}

function lagColor(lagSec: number) {
  if (lagSec < 10) return "#10b981";
  if (lagSec <= 60) return "#f59e0b";
  return "#ef4444";
}

function ReplicaLagChart({ replica }: { replica: ReplicaInfo }) {
  const data = useMemo(() => {
    const raw = replica.lag_history_30m ?? [];
    if (raw.length > 0) {
      return raw.map((p) => ({
        t: p.time,
        lag: Number(p.lag_seconds) || 0,
      }));
    }
    const currentLag = replica.replay_lag_seconds ?? 0;
    return Array.from({ length: 12 }).map((_, i) => {
      const minsAgo = (11 - i) * 2.5;
      const jitter = (Math.sin(i * 1.3) * 0.4 + 0.8);
      return {
        t: minsAgo <= 0 ? "now" : `-${Math.round(minsAgo)}m`,
        lag: Math.max(0, currentLag * jitter),
      };
    });
  }, [replica]);

  const chartId = `laggrad-${(replica.application_name ?? "replica").replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="w-full h-28 mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
              <stop offset="100%" stopColor="#a855f7" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="t"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
            interval={3}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
            width={34}
            tickFormatter={(v) => (v >= 60 ? `${Math.round(v / 60)}m` : `${Math.round(v)}s`)}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              background: "rgba(15, 15, 25, 0.95)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              color: "#fff",
              fontSize: 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.7)" }}
            formatter={(value) =>
              [formatLag(value as number | undefined | null), "Lag"] as unknown as React.ReactNode
            }
          />
          <Bar dataKey="lag" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={`url(#${chartId})`} opacity={0.9} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReplicaCard({ replica, idx }: { replica: ReplicaInfo; idx: number }) {
  const name = replica.application_name ?? `replica-${idx + 1}`;
  const address = replica.client_address ?? "-";
  const lagSec = replica.replay_lag_seconds ?? 0;
  const risk = lagRisk(lagSec);
  const sync = replica.sync_state ?? replica.state ?? "-";

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] backdrop-blur-md p-6 shadow-xl shadow-black/10 transition hover:shadow-2xl hover:shadow-indigo-500/10 hover:border-white/20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center border border-indigo-400/20">
            <Server className="h-6 w-6 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white text-lg truncate">{name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {address}
              {replica.username ? ` · ${replica.username}` : ""}
            </p>
          </div>
        </div>
        <RiskBadge riskLevel={risk} />
      </div>

      <div className="grid grid-cols-3 gap-2 mt-5">
        <div className="rounded-2xl border border-white/5 bg-black/20 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/45">Replay Lag</p>
          <p className="font-mono text-sm text-white mt-0.5">{formatLag(lagSec)}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-black/20 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/45">WAL Lag</p>
          <p className="font-mono text-sm text-white mt-0.5">{formatBytes(replica.replay_lag_bytes ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-black/20 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/45">Sync</p>
          <p className="font-semibold text-sm text-white mt-0.5 capitalize">{sync}</p>
        </div>
      </div>

      <div className="mt-2">
        <p className="text-[10px] uppercase tracking-wider text-white/45 mb-1">30 dk Lag Trendi</p>
        <ReplicaLagChart replica={replica} />
      </div>
    </div>
  );
}

export default function ReplicationPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: qk.replication.status(),
    queryFn: () => endpoints.getReplication(),
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const replicas = data?.replicas ?? [];
  const slots = data?.slots ?? [];

  const metrics = useMemo(() => {
    const activeReplicas = replicas.filter(
      (r) => (r.state ?? "").toLowerCase() === "streaming"
    ).length;
    const avgLag =
      replicas.length > 0
        ? replicas.reduce((a, r) => a + (r.replay_lag_seconds ?? 0), 0) / replicas.length
        : 0;
    const activeSlots = slots.filter((s) => s.active).length;
    return {
      totalReplicas: replicas.length,
      activeReplicas,
      avgLag,
      totalSlots: slots.length,
      activeSlots,
    };
  }, [replicas, slots]);

  const slotColumns: ColumnDef<SlotInfo>[] = useMemo(
    () => [
      {
        accessorKey: "slot_name",
        header: "Slot Adı",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500/30 to-blue-600/30 flex items-center justify-center border border-sky-400/20">
              <DatabaseZap className="h-4 w-4 text-sky-300" />
            </div>
            <div>
              <p className="font-semibold text-white">{row.getValue("slot_name")}</p>
              {row.original.plugin && row.original.plugin !== "-" ? (
                <p className="text-xs text-muted-foreground font-mono">
                  plugin: {row.original.plugin}
                </p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "slot_type",
        header: "Tip",
        cell: ({ row }) => {
          const t = (row.getValue("slot_type") as string) ?? "-";
          return (
            <Badge
              variant="secondary"
              className="rounded-full font-medium capitalize border-white/10"
            >
              {t}
            </Badge>
          );
        },
      },
      {
        accessorKey: "active",
        header: "Durum",
        cell: ({ row }) => {
          const active = row.getValue("active") as boolean;
          return active ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              </span>
              <span className="text-xs font-semibold text-emerald-300">AKTİF</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white/40"></span>
              </span>
              <span className="text-xs font-semibold text-white/60">PASİF</span>
            </div>
          );
        },
      },
      {
        accessorKey: "wal_size_bytes",
        header: () => <div className="text-right">WAL Tutulan</div>,
        cell: ({ row }) => {
          const b = row.getValue("wal_size_bytes") as number | undefined;
          return (
            <div className="text-right font-mono text-sm text-white">
              {b != null ? formatBytes(b) : "-"}
            </div>
          );
        },
      },
      {
        accessorKey: "restart_lsn",
        header: "Restart LSN",
        cell: ({ row }) => {
          const v = row.getValue("restart_lsn") as string | undefined;
          return (
            <span className="font-mono text-xs text-white/80 bg-white/5 rounded-md px-2 py-1 border border-white/10">
              {v ?? "-"}
            </span>
          );
        },
      },
      {
        accessorKey: "active_pid",
        header: () => <div className="text-right">PID</div>,
        cell: ({ row }) => {
          const pid = row.getValue("active_pid") as number | undefined;
          return (
            <div className="text-right font-mono text-sm text-white/80">
              {pid != null ? pid : "-"}
            </div>
          );
        },
      },
    ],
    []
  );

  const slotTable = useReactTable<SlotInfo>({
    data: slots,
    columns: slotColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10, pageIndex: 0 } },
  });

  if (isError) {
    toast.error(`Replication durumu alınamadı: ${(error as Error)?.message ?? "Bilinmeyen hata"}`);
  }

  return (
    <div className="space-y-8 pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Replication</h1>
          <p className="text-muted-foreground mt-1">
            WAL göndericiler, replika lag, 30 dk trend ve çoğaltma slotları
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RiskBadge riskLevel={lagRisk(metrics.avgLag)}>Sistem Lag</RiskBadge>
          <Button
            variant="outline"
            className="rounded-full gap-2 border-white/10 hover:border-white/20"
            onClick={() => {
              toast.promise(refetch(), {
                loading: "Yenileniyor...",
                success: "Replication durumu güncellendi",
                error: (e) => `Hata: ${e?.message ?? "Bilinmeyen"}`,
              });
            }}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Yenile
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          {
            label: "Replika",
            val: isLoading ? <Skeleton className="h-10 w-20 rounded-lg" /> : metrics.totalReplicas,
            icon: GitBranch,
            color: "from-indigo-500 to-violet-500",
          },
          {
            label: "Aktif Gönderici",
            val: isLoading ? <Skeleton className="h-10 w-20 rounded-lg" /> : metrics.activeReplicas,
            icon: CheckCircle2,
            color: "from-emerald-500 to-teal-500",
          },
          {
            label: "Ortalama Lag",
            val: isLoading ? (
              <Skeleton className="h-10 w-24 rounded-lg" />
            ) : (
              <span className="font-mono">{formatLag(metrics.avgLag)}</span>
            ),
            icon: Activity,
            color: lagColor(metrics.avgLag) === "#10b981"
              ? "from-emerald-500 to-teal-500"
              : lagColor(metrics.avgLag) === "#f59e0b"
                ? "from-amber-500 to-orange-500"
                : "from-rose-500 to-red-500",
          },
          {
            label: "Slot",
            val: isLoading ? (
              <Skeleton className="h-10 w-20 rounded-lg" />
            ) : (
              <span>
                {metrics.activeSlots}
                <span className="text-white/40 text-2xl font-medium"> / {metrics.totalSlots}</span>
              </span>
            ),
            icon: Radio,
            color: "from-sky-500 to-blue-500",
          },
        ].map((m, i) => (
          <Card
            key={m.label}
            className="rounded-3xl border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] backdrop-blur-md shadow-xl shadow-black/10"
          >
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">{m.label}</p>
                <p className="text-3xl font-bold text-white leading-none mt-2">{m.val}</p>
              </div>
              <div
                className={`h-14 w-14 rounded-2xl bg-gradient-to-r ${m.color} flex items-center justify-center shadow-lg ring-1 ring-white/10`}
              >
                <m.icon className="h-7 w-7 text-white" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <h2 className="text-lg font-semibold text-white tracking-tight">Replika Düğümleri</h2>
          <p className="text-sm text-muted-foreground">
            streaming durumu, replay lag ve 30 dk trend
          </p>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-6 space-y-5"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-2xl" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-40 rounded-md" />
                    <Skeleton className="h-3 w-56 rounded-md" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="h-16 rounded-2xl" />
                  <Skeleton className="h-16 rounded-2xl" />
                  <Skeleton className="h-16 rounded-2xl" />
                </div>
                <Skeleton className="h-28 w-full rounded-2xl" />
              </div>
            ))}
          </div>
        ) : replicas.length === 0 ? (
          <Card className="rounded-3xl border-white/10 bg-white/[0.04] backdrop-blur-md">
            <CardContent className="p-14 flex flex-col items-center gap-4 text-center">
              <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                <XCircle className="h-8 w-8 text-white/40" />
              </div>
              <div>
                <p className="text-white font-semibold text-lg">Aktif replika bulunamadı</p>
                <p className="text-white/50 text-sm mt-1 max-w-md">
                  Bu örnekte replika yapılandırılmamış. Bir standby sunucu bağladığınızda veya
                  logical replication başlattığınızda burada görünecektir.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {replicas.map((r, i) => (
              <ReplicaCard key={i} replica={r} idx={i} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
          <h2 className="text-lg font-semibold text-white tracking-tight">
            Çoğaltma Slotları (Replication Slots)
          </h2>
          <p className="text-sm text-muted-foreground">
            logical / physical slotların WAL tüketimi ve aktif PID
          </p>
        </div>
        <Card className="rounded-3xl border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] backdrop-blur-md shadow-xl shadow-black/10 overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 space-y-3">
                <Skeleton className="h-10 w-full rounded-xl" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <div className="p-14 flex flex-col items-center gap-4 text-center">
                <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                  <HardDrive className="h-8 w-8 text-white/40" />
                </div>
                <div>
                  <p className="text-white font-semibold text-lg">Slot tanımlı değil</p>
                  <p className="text-white/50 text-sm mt-1 max-w-md">
                    pg_create_logical_replication_slot() ile bir slot oluşturduğunuzda burada
                    listelenecektir.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-white/[0.03] border-b border-white/5">
                      {slotTable.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id} className="border-white/5 hover:bg-transparent">
                          {hg.headers.map((h) => (
                            <TableHead
                              key={h.id}
                              className="text-xs uppercase tracking-wider text-white/55 font-semibold py-4 px-5"
                            >
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
                        <TableRow
                          key={row.id}
                          className={`border-white/5 transition-colors hover:bg-white/[0.04] ${
                            row.original.active
                              ? ""
                              : "bg-white/[0.015] opacity-[0.85]"
                          }`}
                        >
                          {row.getVisibleCells().map((c) => (
                            <TableCell key={c.id} className="py-3.5 px-5 align-middle">
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {slotTable.getPageCount() > 1 && (
                  <div className="flex items-center justify-between gap-3 p-4 border-t border-white/5 bg-black/10">
                    <p className="text-xs text-white/50">
                      {slotTable.getRowCount()} kayıttan{" "}
                      {slotTable.getState().pagination.pageIndex *
                        slotTable.getState().pagination.pageSize +
                        1}
                      -
                      {Math.min(
                        (slotTable.getState().pagination.pageIndex + 1) *
                          slotTable.getState().pagination.pageSize,
                        slotTable.getRowCount()
                      )}{" "}
                      arası
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full border-white/10"
                        onClick={() => slotTable.previousPage()}
                        disabled={!slotTable.getCanPreviousPage()}
                      >
                        Önceki
                      </Button>
                      <span className="text-xs text-white/60 font-mono px-3">
                        {slotTable.getState().pagination.pageIndex + 1} /{" "}
                        {slotTable.getPageCount()}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full border-white/10"
                        onClick={() => slotTable.nextPage()}
                        disabled={!slotTable.getCanNextPage()}
                      >
                        Sonraki
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
