import { api } from "@/lib/api/client";

export type StatementState = "ok" | "not_installed" | "not_preloaded";

export interface StatementStatus {
  profile: string | null;
  database: string | null;
  server_version_num: number | null;
  state: StatementState;
  extension_version: string | null;
  stats_since: string | null;
  dealloc: number | null;
  track_planning: boolean | null;
  warnings: string[];
}

export interface StatementRow {
  queryid: string;
  query: string;
  kind: string;
  users: string[];
  calls: number;
  calls_per_min: number | null;
  total_ms: number;
  mean_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  stddev_ms: number | null;
  rows_total: number;
  rows_per_call: number | null;
  cache_hit_pct: number | null;
  load_pct: number | null;
  blks_hit: number;
  blks_read: number;
  temp_written: number;
  wal_bytes: number | null;
  plan_ms: number | null;
  io_read_ms: number | null;
  jit_ms: number | null;
}

export interface StatementList {
  status: StatementStatus;
  totals: { statements: number; total_ms: number; calls: number } | null;
  items: StatementRow[];
}

export interface StatementSource {
  application_name: string | null;
  client_addr: string | null;
  usename: string | null;
  sessions: number;
}

export interface StatementDetail extends StatementRow {
  formatted: string;
  variants: { queryid: string; calls: number; total_ms: number }[];
  sources: StatementSource[];
}

export interface PlanResult {
  status: "ok" | "failed" | "not_explainable";
  plan: PlanEnvelope[] | null;
  mode: "generic" | "custom";
  reason: string | null;
  message: string | null;
}

export interface PlanEnvelope {
  Plan: PlanNodeJson;
  "Planning Time"?: number;
  "Execution Time"?: number;
}

export interface PlanNodeJson {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Alias?: string;
  Filter?: string;
  "Index Cond"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Sort Key"?: string[];
  "Total Cost": number;
  "Plan Rows": number;
  "Plan Width": number;
  "Actual Rows"?: number;
  "Actual Total Time"?: number;
  Plans?: PlanNodeJson[];
}

export interface Recommendation {
  code: string;
  severity: "high" | "medium" | "low";
  safety: "safe" | "conditional" | "advisory";
  evidence: Record<string, unknown>;
  sql_rewrite: string | null;
  ddl: string | null;
}

export interface Advice {
  recommendations: Recommendation[];
  suggested_sql: string | null;
  applied: string[];
  cost: { before: number; after: number } | null;
  plan_status: PlanResult["status"];
  plan_reason: string | null;
  plan_cost: number | null;
  parsed: boolean;
  locator: {
    sqlcommenter: Record<string, string>;
    orm_hint: string | null;
    tables: string[];
    search_terms: string[];
    applications: string[];
    clients: string[];
  };
}

export type StatementSort =
  | "total_time"
  | "mean_time"
  | "calls"
  | "calls_per_min"
  | "rows_per_call"
  | "io"
  | "temp"
  | "wal"
  | "load";

export interface StatementFilters {
  sort: StatementSort;
  direction: "asc" | "desc";
  limit: number;
  offset: number;
  min_calls: number;
  search?: string;
}

export const statementsApi = {
  list: (filters: StatementFilters): Promise<StatementList> => {
    const params = new URLSearchParams({
      sort: filters.sort,
      direction: filters.direction,
      limit: String(filters.limit),
      offset: String(filters.offset),
      min_calls: String(filters.min_calls),
    });
    if (filters.search) params.set("search", filters.search);
    return api.get<StatementList>(`/statements?${params}`);
  },
  detail: (queryid: string): Promise<StatementDetail> =>
    api.get<StatementDetail>(`/statements/${queryid}`),
  recommendations: (queryid: string, searchPath?: string): Promise<Advice> =>
    api.get<Advice>(
      `/statements/${queryid}/recommendations${
        searchPath ? `?search_path=${encodeURIComponent(searchPath)}` : ""
      }`
    ),
  explain: (
    queryid: string,
    body: { params?: string[]; search_path?: string; analyze?: boolean }
  ): Promise<PlanResult> => api.post<PlanResult>(`/statements/${queryid}/explain`, body),
};
