import { api } from "@/lib/api/client";
import type { PlanResult, Recommendation } from "@/lib/api/statements";

export interface InsightLocator {
  sqlcommenter: Record<string, string>;
  orm_hint: string | null;
  tables: string[];
  search_terms: string[];
  applications: string[];
  clients: string[];
}

/**
 * Cost + advice for one SQL text, regardless of where the text came from
 * (pg_stat_statements, active queries, the SQL editor, ...).
 */
export interface QueryInsight {
  formatted: string;
  recommendations: Recommendation[];
  suggested_sql: string | null;
  applied: string[];
  cost: { before: number; after: number } | null;
  plan_status: "ok" | "failed" | "not_explainable";
  plan_reason: string | null;
  plan_cost: number | null;
  parsed: boolean;
  locator: InsightLocator;
}

export interface ExplainPlanOptions {
  analyze?: boolean;
  verbose?: boolean;
  costs?: boolean;
  settings?: boolean;
  buffers?: boolean;
  wal?: boolean;
  timing?: boolean;
}

export const insightApi = {
  advise: (sql: string, searchPath?: string): Promise<QueryInsight> =>
    api.post<QueryInsight>("/sql/advise", {
      sql,
      search_path: searchPath || undefined,
    }),
  explain: (sql: string, options: ExplainPlanOptions): Promise<PlanResult> =>
    api.post<PlanResult>("/sql/explain", { sql, ...options }),
};
