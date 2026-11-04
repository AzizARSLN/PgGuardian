"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Hash,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/types";
import type {
  DryRunResult,
  MaintenanceActionResult,
  SequenceRow,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IfWriter } from "@/components/role-guard";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useI18n, useT } from "@/lib/i18n";

const LIST_LIMIT = 5000;
const PAGE_SIZE = 25;
const BULK_PREVIEW_LIMIT = 10;
const BULK_TIMEOUT_MS = 30 * 60 * 1000;
const METRIC = "font-mono tabular-nums";

const MULTIPLIERS = [2, 5, 10, 100, 1000];

/** Critical sequences sort to the top; the badge tone follows the same idea. */
const STATUS_ORDER: Record<string, number> = {
  MAXIMUMA_ULASTI: 0,
  MINIMUNA_ULASTI: 1,
  MAXIMUMA_YAKLASIYOR: 2,
  NORMAL: 3,
};

type BadgeRisk = "OK" | "WARNING" | "DANGEROUS";

function statusRisk(status: string): BadgeRisk {
  if (status === "MAXIMUMA_ULASTI" || status === "MINIMUNA_ULASTI") return "DANGEROUS";
  if (status === "MAXIMUMA_YAKLASIYOR") return "WARNING";
  return "OK";
}

function statusKey(status: string): string {
  switch (status) {
    case "MAXIMUMA_ULASTI":
      return "diagnostics.sequences.statusMaxReached";
    case "MINIMUNA_ULASTI":
      return "diagnostics.sequences.statusMinReached";
    case "MAXIMUMA_YAKLASIYOR":
      return "diagnostics.sequences.statusNearMax";
    default:
      return "diagnostics.sequences.statusNormal";
  }
}

function usage(row: SequenceRow): number {
  return Number(row.usage_percent ?? 0);
}

function schemaOf(row: SequenceRow): string {
  return row.schema_name ?? "public";
}

function nameOf(row: SequenceRow): string {
  return row.sequence_name ?? "";
}

function rowKey(row: SequenceRow): string {
  return `${schemaOf(row)}.${nameOf(row)}`;
}

/** New ceiling = current MAXVALUE × multiplier, computed exactly with BigInt. */
function nextMax(row: SequenceRow, multiplier: number): bigint {
  try {
    const raw = row.max_value;
    const base = typeof raw === "number" ? BigInt(Math.trunc(raw)) : BigInt(raw ?? 0);
    return base * BigInt(multiplier);
  } catch {
    return 0n;
  }
}

type SortKey = "sequence" | "last_value" | "max_value" | "usage";

interface BatchProgress {
  total: number;
  done: number;
  ok: number;
  failed: number;
}

/**
 * Sequence exhaustion panel: find sequences that reached (or are close to) their
 * MAXVALUE and raise the ceiling for one or many at once via ALTER SEQUENCE.
 * Exhaustion is reported by the backend; the schema + name filters run client side.
 */
export function SequencesPanel({
  refetchInterval = false,
}: {
  refetchInterval?: number | false;
}) {
  const t = useT();
  const { formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const seqQ = useQuery({
    queryKey: qk.diagnostics.sequences(LIST_LIMIT),
    queryFn: () => endpoints.getSequences(LIST_LIMIT),
    refetchInterval,
  });

  const [schemaFilter, setSchemaFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [multiplier, setMultiplier] = React.useState("10");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [page, setPage] = React.useState(0);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "usage",
    dir: "desc",
  });
  const [progress, setProgress] = React.useState<BatchProgress | null>(null);

  const rows = React.useMemo(() => seqQ.data ?? [], [seqQ.data]);

  const schemaOptions = React.useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) names.add(schemaOf(row));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (schemaFilter !== "all" && schemaOf(row) !== schemaFilter) return false;
      if (!needle) return true;
      const haystack = `${rowKey(row)} ${row.data_type ?? ""} ${row.status ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, schemaFilter, search]);

  const sorted = React.useMemo(() => {
    const list = [...filtered];
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === "sequence") return dir * rowKey(a).localeCompare(rowKey(b));
      if (sort.key === "usage") return dir * (usage(a) - usage(b));
      const av = Number(sort.key === "last_value" ? a.last_value : a.max_value ?? 0);
      const bv = Number(sort.key === "last_value" ? b.last_value : b.max_value ?? 0);
      return dir * (av - bv);
    });
    return list;
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const selectedRows = React.useMemo(
    () => sorted.filter((row) => selected.has(rowKey(row))),
    [sorted, selected]
  );

  React.useEffect(() => {
    setPage(0);
  }, [schemaFilter, search]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "sequence" ? "asc" : "desc" }
    );
  };

  const toggleRow = (row: SequenceRow) => {
    const key = rowKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(rowKey(row)));
  const somePageSelected = pageRows.some((row) => selected.has(rowKey(row)));

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const row of pageRows) next.delete(rowKey(row));
      } else {
        for (const row of pageRows) next.add(rowKey(row));
      }
      return next;
    });
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.diagnostics.all() });

  const multiplierValue = Number(multiplier) || 10;

  const handleRaiseOne = React.useCallback(
    async (row: SequenceRow) => {
      const schema = schemaOf(row);
      const name = nameOf(row);
      const target = nextMax(row, multiplierValue);
      const ok = await confirm({
        title: t("diagnostics.sequences.raiseTitle", { sequence: `${schema}.${name}` }),
        description: t("diagnostics.sequences.raiseDesc", {
          current: String(row.max_value ?? "-"),
          next: target.toString(),
          multiplier: String(multiplierValue),
        }),
        risk_level: "DANGEROUS",
        confirm_label: t("diagnostics.sequences.raiseConfirm"),
        cancel_label: t("common.cancel"),
        confirm_name_required: true,
        confirm_name_value: name,
        confirm_name_placeholder: t("diagnostics.sequences.typeName", { name }),
        sql_preview: [`ALTER SEQUENCE ${schema}.${name} MAXVALUE ${target};`],
      });
      if (!ok) return;
      try {
        await endpoints.raiseSequenceMaxValue({
          schema_name: schema,
          sequence_name: name,
          multiplier: multiplierValue,
          confirm: true,
          confirm_name: name,
        });
        invalidate();
        toast.success(t("diagnostics.sequences.raiseDone", { sequence: `${schema}.${name}` }));
      } catch {
        // The API client already surfaces the error toast.
      }
    },
    [confirm, multiplierValue, t, queryClient]
  );

  const handleRaiseSelected = React.useCallback(async () => {
    const targets = selectedRows;
    const count = targets.length;
    if (count === 0) return;
    const preview = targets
      .slice(0, BULK_PREVIEW_LIMIT)
      .map((row) => `ALTER SEQUENCE ${schemaOf(row)}.${nameOf(row)} MAXVALUE ${nextMax(row, multiplierValue)};`);
    if (count > BULK_PREVIEW_LIMIT) preview.push(`-- … +${count - BULK_PREVIEW_LIMIT}`);
    const ok = await confirm({
      title: t("diagnostics.sequences.bulkTitle", { count }),
      description: t("diagnostics.sequences.bulkDesc", {
        count: String(count),
        multiplier: String(multiplierValue),
      }),
      risk_level: "DANGEROUS",
      confirm_label: t("diagnostics.sequences.bulkConfirm"),
      cancel_label: t("common.cancel"),
      confirm_name_required: true,
      confirm_name_value: String(count),
      confirm_name_placeholder: t("diagnostics.sequences.typeCount", { count }),
      sql_preview: preview,
    });
    if (!ok) return;

    setProgress({ total: count, done: 0, ok: 0, failed: 0 });
    let okCount = 0;
    let failedCount = 0;
    for (const row of targets) {
      try {
        const data = await api.post<DryRunResult | MaintenanceActionResult>(
          "/maintenance/sequence-maxvalue",
          {
            schema_name: schemaOf(row),
            sequence_name: nameOf(row),
            multiplier: multiplierValue,
            confirm: true,
            confirm_name: nameOf(row),
          },
          { skipToast: true, timeout: BULK_TIMEOUT_MS }
        );
        if ("risk" in data) failedCount += 1;
        else okCount += 1;
      } catch {
        failedCount += 1;
      }
      setProgress({ total: count, done: okCount + failedCount, ok: okCount, failed: failedCount });
    }
    setProgress(null);
    setSelected(new Set());
    invalidate();
    const summary = t("diagnostics.sequences.bulkSummary", { ok: okCount, failed: failedCount });
    if (failedCount > 0) toast.warning(summary);
    else toast.success(summary);
  }, [confirm, multiplierValue, selectedRows, t, queryClient]);

  const criticalCount = rows.filter(
    (row) => statusRisk(row.status ?? "NORMAL") === "DANGEROUS"
  ).length;

  const renderBody = () => {
    if (seqQ.isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={7} className="p-2">
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          </TableCell>
        </TableRow>
      );
    }
    if (seqQ.isError) {
      return (
        <TableRow>
          <TableCell colSpan={7} className="px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-foreground">{t("common.loadFailed")}</span>
              <Button variant="outline" size="sm" onClick={() => seqQ.refetch()} className="h-6 px-2 text-xs">
                {t("common.retry")}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    }
    if (pageRows.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={7} className="px-3 py-2">
            <p className="font-medium text-foreground">{t("diagnostics.sequences.emptyTitle")}</p>
            <p className="text-muted-foreground">{t("diagnostics.sequences.emptyDesc")}</p>
          </TableCell>
        </TableRow>
      );
    }
    return pageRows.map((row) => {
      const pct = usage(row);
      const status = row.status ?? "NORMAL";
      const risk = statusRisk(status);
      const atLimit = status === "MAXIMUMA_ULASTI" || status === "MINIMUNA_ULASTI";
      const key = rowKey(row);
      return (
        <TableRow key={key} className={atLimit ? "bg-destructive/5" : undefined}>
          <IfWriter>
            <TableCell className="w-[36px] px-2 py-1.5">
              <Checkbox
                checked={selected.has(key)}
                onCheckedChange={() => toggleRow(row)}
                aria-label={`${schemaOf(row)}.${nameOf(row)}`}
              />
            </TableCell>
          </IfWriter>
          <TableCell className="px-2 py-1.5">
            <div className="font-mono font-medium text-foreground">{nameOf(row)}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{schemaOf(row)}</div>
          </TableCell>
          <TableCell className="px-2 py-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              {row.data_type ?? "-"}
            </span>
          </TableCell>
          <TableCell className="px-2 py-1.5 text-right">
            {row.last_value == null ? (
              <span className="text-muted-foreground">-</span>
            ) : (
              <code className={METRIC}>{formatNumber(Number(row.last_value))}</code>
            )}
          </TableCell>
          <TableCell className="px-2 py-1.5 text-right">
            <code className={`${METRIC} text-muted-foreground`}>
              {formatNumber(Number(row.max_value ?? 0))}
            </code>
          </TableCell>
          <TableCell className="px-2 py-1.5">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-muted">
                <div
                  className={`h-full ${risk === "DANGEROUS" ? "bg-destructive" : risk === "WARNING" ? "bg-warning" : "bg-success"}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span className={`${METRIC} font-semibold`}>
                {formatNumber(pct, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
              </span>
            </div>
          </TableCell>
          <TableCell className="px-2 py-1.5">
            <RiskBadge riskLevel={risk} size="sm" showIcon={false}>
              {t(statusKey(status))}
            </RiskBadge>
          </TableCell>
          <IfWriter>
            <TableCell className="px-2 py-1.5 text-right">
              <Button
                variant="outline"
                size="sm"
                disabled={progress !== null || multiplierValue === 0}
                onClick={() => handleRaiseOne(row)}
                className="h-6 gap-1 px-1.5 text-[11px]"
              >
                <TrendingUp className="h-3 w-3" />
                {t("diagnostics.sequences.raiseOne")}
              </Button>
            </TableCell>
          </IfWriter>
        </TableRow>
      );
    });
  };

  return (
    <div className="space-y-2">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("diagnostics.sequences.search")}
            aria-label={t("diagnostics.sequences.search")}
            className="h-7 pl-7 text-xs"
          />
        </div>

        <Select value={schemaFilter} onValueChange={setSchemaFilter}>
          <SelectTrigger className="h-7 w-[190px] rounded-md text-xs" aria-label={t("diagnostics.sequences.schema")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("diagnostics.sequences.allSchemas")}</SelectItem>
            {schemaOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <IfWriter>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t("diagnostics.sequences.multiplier")}</span>
            <Select value={multiplier} onValueChange={setMultiplier}>
              <SelectTrigger className="h-7 w-[78px] rounded-md text-xs" aria-label={t("diagnostics.sequences.multiplier")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MULTIPLIERS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    ×{m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={selectedRows.length === 0 || progress !== null}
            onClick={handleRaiseSelected}
            className="h-7 gap-1 px-2 text-xs"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            {t("diagnostics.sequences.raiseSelected", { count: selectedRows.length })}
          </Button>
        </IfWriter>

        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {progress ? (
            <span className={METRIC}>
              {t("diagnostics.sequences.bulkProgress", {
                done: progress.done,
                total: progress.total,
              })}
            </span>
          ) : (
            <span className={METRIC}>
              {t("diagnostics.sequences.summary", {
                total: formatNumber(rows.length),
                critical: formatNumber(criticalCount),
              })}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={seqQ.isFetching}
            onClick={() => seqQ.refetch()}
            className="h-7 gap-1 px-2 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${seqQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <IfWriter>
                <TableHead className="h-8 w-[36px] px-2 py-1.5">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={togglePage}
                    aria-label={t("diagnostics.sequences.selectPage")}
                  />
                </TableHead>
              </IfWriter>
              <TableHead className="h-8 px-2 py-1.5 text-xs font-semibold">
                <button type="button" onClick={() => toggleSort("sequence")} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Hash className="h-3 w-3" />
                  {t("diagnostics.sequences.sequence")}
                </button>
              </TableHead>
              <TableHead className="h-8 px-2 py-1.5 text-xs font-semibold">
                {t("diagnostics.sequences.type")}
              </TableHead>
              <TableHead className="h-8 px-2 py-1.5 text-right text-xs font-semibold">
                <button type="button" onClick={() => toggleSort("last_value")} className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
                  {t("diagnostics.sequences.lastValue")}
                </button>
              </TableHead>
              <TableHead className="h-8 px-2 py-1.5 text-right text-xs font-semibold">
                <button type="button" onClick={() => toggleSort("max_value")} className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
                  {t("diagnostics.sequences.maxValue")}
                </button>
              </TableHead>
              <TableHead className="h-8 px-2 py-1.5 text-xs font-semibold">
                <button type="button" onClick={() => toggleSort("usage")} className="inline-flex items-center gap-1 hover:text-foreground">
                  {t("diagnostics.sequences.usage")}
                </button>
              </TableHead>
              <TableHead className="h-8 px-2 py-1.5 text-xs font-semibold">
                {t("diagnostics.sequences.status")}
              </TableHead>
              <IfWriter>
                <TableHead className="h-8 px-2 py-1.5 text-right text-xs font-semibold">
                  {t("diagnostics.columns.actions")}
                </TableHead>
              </IfWriter>
            </TableRow>
          </TableHeader>
          <TableBody>{renderBody()}</TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${METRIC} text-[11px] text-muted-foreground`}>
          {t("diagnostics.table.pageInfo", {
            page: safePage + 1,
            pages: pageCount,
            total: formatNumber(sorted.length),
          })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-7 gap-1 px-2 text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("diagnostics.table.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="h-7 gap-1 px-2 text-xs"
          >
            {t("diagnostics.table.next")}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SequencesPanel;
