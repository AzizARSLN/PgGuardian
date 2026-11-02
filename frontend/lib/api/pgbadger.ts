import { api } from "@/lib/api/client";

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
  totals: Record<Role, { total: number; done: number }>;
  activity: { at: string; actor: string | null; action: string; detail: string | null }[];
}

const BASE = "/pgbadger/reports";
// Parsing and reviewing a large report can take longer than a normal request.
const LONG = { timeout: 5 * 60 * 1000 };

export const pgbadgerApi = {
  list: () => api.get<ReportListItem[]>(BASE),
  detail: (id: string, lang: string) => api.get<ReportDetail>(`${BASE}/${id}?lang=${lang}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ id: string }>(BASE, form, LONG);
  },
  analyze: (id: string, lang: string) =>
    api.post<ReportDetail>(`${BASE}/${id}/analyze?lang=${lang}`, undefined, LONG),
  setTask: (id: string, taskId: string, status: TaskStatus) =>
    api.put<unknown>(`${BASE}/${id}/tasks/${taskId}`, { status }),
  remove: (id: string) => api.delete<unknown>(`${BASE}/${id}`),
  exportText: (id: string, section: ExportSection, format: "html" | "md", lang: string) =>
    api.get<string>(`${BASE}/${id}/export?section=${section}&format=${format}&lang=${lang}`),
};
