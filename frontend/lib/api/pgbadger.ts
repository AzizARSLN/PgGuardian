import { api } from "@/lib/api/client";
import type { CallOptions } from "@/lib/api/types";

export type Severity = "critical" | "high" | "medium" | "low";
export type Role = "backend" | "ui" | "db";
export type TaskStatus = "todo" | "doing" | "done";
export type ExportSection = "all" | "summary" | "findings" | Role;

export interface ReportListItem {
  id: string;
  filename: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
  period_start: string | null;
  period_end: string | null;
  analyzed_at: string | null;
}

export interface FindingTask {
  id: string;
  text: string;
  status: TaskStatus;
  updated_by: string | null;
  updated_at: string | null;
}

export interface Finding {
  id: string;
  code: string;
  severity: Severity;
  category: string;
  title: string;
  problem: string;
  traits: { code: string; label: string }[];
  sql: string | null;
  messages: string[];
  index: { table: string; columns: string[]; status: string; status_text: string; ddl: string | null }[];
  tasks: Record<Role, FindingTask[]>;
}

export interface ReportSummary {
  queries: string;
  normalized: string;
  total_duration: string;
  peak: string;
  events: string;
  lock_wait: string;
  top10_share: number;
  load: { kind: string; share: number; duration: string; count: number; apps: string[] }[];
}

export interface QueryIndex {
  table: string;
  columns: string[];
  status: string;
  status_text: string;
  schema?: string | null;
  rows?: number | null;
  ddl: string | null;
}

export interface QueryHour {
  hour: string;
  count: number;
  ms: number;
}

/** One real, fully parameterised execution of a heavy statement. */
export interface QueryExample {
  sql: string;
  date: string;
  ms: number;
  database: string;
  user: string;
  host: string;
  app: string;
  bind: string;
}

/** One heavy statement with every number kept, for the Queries view. */
export interface QueryDetail {
  id: string;
  rank: number;
  severity: Severity;
  sql: string;
  examples: QueryExample[];
  tables: string[];
  share: number;
  total_ms: number;
  calls: number;
  min_ms: number;
  avg_ms: number;
  max_ms: number;
  peak: string | null;
  hours: QueryHour[];
  apps: string[];
  users: string[];
  temp_bytes: number;
  temp_count: number;
  traits: { code: string; label: string }[];
  sources: string[];
  indexes: QueryIndex[];
}

export interface ReportDetail {
  id: string;
  filename: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
  period_start: string | null;
  period_end: string | null;
  analyzed_at: string | null;
  analyzed: boolean;
  summary: ReportSummary | null;
  findings: Finding[];
  queries: QueryDetail[];
  totals: Record<Role, { total: number; done: number }>;
  activity: { at: string; actor: string | null; action: string; detail: string | null }[];
}

const BASE = "/pgbadger/reports";
// Parsing and reviewing a large report can take longer than a normal request.
const LONG = { timeout: 5 * 60 * 1000 };

export const pgbadgerApi = {
  list: () => api.get<ReportListItem[]>(BASE),
  detail: (id: string, lang: string) =>
    api.get<ReportDetail>(`${BASE}/${id}`, { params: { lang } }),
  upload: (file: File, options?: CallOptions) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ id: string }>(BASE, form, { ...LONG, ...options });
  },
  analyze: (id: string, lang: string, options?: CallOptions) =>
    api.post<ReportDetail>(`${BASE}/${id}/analyze`, undefined, {
      ...LONG,
      ...options,
      params: { lang },
    }),
  setTask: (id: string, taskId: string, status: TaskStatus) =>
    api.put<unknown>(`${BASE}/${id}/tasks/${taskId}`, { status }),
  remove: (id: string) => api.delete<unknown>(`${BASE}/${id}`),
  exportText: (id: string, section: ExportSection, format: "html" | "md", lang: string) =>
    api.get<string>(`${BASE}/${id}/export`, { params: { section, format, lang } }),
};
