import { api } from "./client";

export type Severity = "OK" | "INFO" | "WARNING" | "CRITICAL" | "UNKNOWN";

export type RiskLevel = "READ" | "MAINTENANCE" | "DANGEROUS";

export type StatementKind = "READ" | "WRITE" | "DDL" | "DANGEROUS" | "UNKNOWN";

export interface HealthCheck {
  name: string;
  status: Severity;
  value?: string | null;
  threshold?: string | null;
  severity: Severity;
  description: string;
}

export interface HealthReport {
  server_version: string;
  database: string;
  uptime_seconds?: number | null;
  checks: HealthCheck[];
  score: number;
  status: string;
  generated_at: string;
}

export interface DiagnosticFinding {
  code: string;
  severity: Severity;
  title: string;
  description: string;
  value?: string | null;
  recommendation?: string | null;
}

export interface ConnectionInfo {
  pid: number;
  user?: string | null;
  database?: string | null;
  client_address?: string | null;
  application_name?: string | null;
  backend_type?: string | null;
  state?: string | null;
  wait_event_type?: string | null;
  wait_event?: string | null;
  query_duration_seconds?: number | null;
  transaction_duration_seconds?: number | null;
  query?: string | null;
}

export interface ConnectionSummary {
  current_connections: number;
  max_connections: number;
  usage_percent: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  waiting: number;
  by_state: Record<string, number>;
}

export interface ConnectionReport {
  summary: ConnectionSummary;
  connections: ConnectionInfo[];
}

export interface IndexInfo {
  schema_name?: string | null;
  table_name?: string | null;
  index_name: string;
  index_size_bytes: number;
  index_scans: number;
  tuples_read: number;
  tuples_fetched: number;
  potentially_unused: boolean;
  reason?: string | null;
}

export interface IndexReport {
  limit: number;
  count: number;
  indexes: IndexInfo[];
  potentially_unused: IndexInfo[];
}

export interface LockInfo {
  blocking_pid: number;
  blocked_pid: number;
  blocking_user?: string | null;
  blocked_user?: string | null;
  database?: string | null;
  relation?: string | null;
  lock_type?: string | null;
  blocked_mode?: string | null;
  blocking_mode?: string | null;
  blocking_duration_seconds?: number | null;
  blocking_query?: string | null;
  blocked_query?: string | null;
}

export interface LockSummary {
  total_locks: number;
  waiting_locks: number;
  blocking_pairs: number;
  by_mode: Record<string, number>;
}

export interface LockReport {
  summary: LockSummary;
  locks: LockInfo[];
  chains: string[];
}

export interface TableMaintenance {
  schema_name?: string | null;
  table_name: string;
  live_tuples: number;
  dead_tuples: number;
  dead_tuple_percent: number;
  last_vacuum?: string | null;
  last_autovacuum?: string | null;
  last_analyze?: string | null;
  last_autoanalyze?: string | null;
  vacuum_count: number;
  autovacuum_count: number;
  analyze_count: number;
  autoanalyze_count: number;
  status: Severity;
}

export interface MaintenanceSummary {
  total_live_tuples: number;
  total_dead_tuples: number;
  dead_tuple_percent: number;
  tables_total: number;
  tables_never_vacuumed: number;
  tables_never_analyzed: number;
  autovacuum_workers: number;
}

export interface MaintenanceReport {
  summary: MaintenanceSummary;
  tables: TableMaintenance[];
  limit: number;
}

export interface QueryInfo {
  pid: number;
  duration_seconds?: number | null;
  user?: string | null;
  database?: string | null;
  state?: string | null;
  wait_event_type?: string | null;
  wait_event?: string | null;
  query?: string | null;
}

export interface QueryReport {
  kind: string;
  limit: number;
  count: number;
  queries: QueryInfo[];
}

export interface DatabaseSize {
  database: string;
  size_bytes: number;
}

export interface TableSize {
  schema_name?: string | null;
  table_name: string;
  total_size_bytes: number;
  table_size_bytes: number;
  indexes_size_bytes: number;
}

export interface IndexSize {
  schema_name?: string | null;
  table_name?: string | null;
  index_name: string;
  size_bytes: number;
}

export interface StorageReport {
  databases: DatabaseSize[];
  tables: TableSize[];
  indexes: IndexSize[];
  limit: number;
}

export interface MutationRequest {
  confirm?: boolean;
  confirm_name?: string | null;
  dry_run?: boolean;
}

export interface DryRunResult {
  action: string;
  risk: RiskLevel;
  sql: string[];
  target?: string | null;
  note: string;
}

export interface SqlResult {
  kind: StatementKind;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
  command: string;
}

export interface Profile {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string | null;
  password_env?: string | null;
  server?: string | null;
  description?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileCreate {
  name: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string | null;
  password_env?: string | null;
  server?: string | null;
  description?: string | null;
  is_default?: boolean;
}

export interface Snapshot {
  id: number;
  taken_at: string;
  profile?: string | null;
  server?: string | null;
  host: string;
  port: number;
  database: string;
  server_version: string;
  score: number;
  status: string;
  connections: number;
  max_connections: number;
  cache_hit?: number | null;
  db_size_bytes: number;
  dead_tuples: number;
  live_tuples: number;
  long_queries: number;
  blocking_pairs: number;
  deadlocks: number;
}

export interface SqlRequest extends MutationRequest {
  sql: string;
  params?: unknown[] | null;
  max_rows?: number;
  readonly?: boolean;
}

export interface SqlFormatRequest {
  sql: string;
  keyword_case?: string;
}

export interface SqlFormatResponse {
  original: string;
  formatted: string;
  keyword_case: string;
}

export interface ExplainRequest {
  sql: string;
  analyze?: boolean;
}

export interface DatabaseInfo {
  name: string;
  owner?: string | null;
  size_bytes: number;
  allow_connections: boolean;
  connection_limit: number;
}

export interface DatabaseCreate extends MutationRequest {
  name: string;
  owner?: string | null;
  encoding?: string | null;
}

export interface DatabaseDrop extends MutationRequest {}

export interface SchemaInfo {
  name: string;
  owner?: string | null;
  is_system: boolean;
}

export interface TableSummary {
  schema_name: string;
  table_name: string;
  owner?: string | null;
  total_size_bytes: number;
  live_tuples: number;
  dead_tuples: number;
  dead_tuple_percent: number;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default?: string | null;
}

export interface TableDetail {
  schema_name: string;
  table_name: string;
  owner?: string | null;
  total_size_bytes: number;
  live_tuples: number;
  dead_tuples: number;
  columns: ColumnInfo[];
  indexes: string[];
  constraints: string[];
}

export interface ViewInfo {
  schema_name: string;
  view_name: string;
  owner?: string | null;
  is_materialized: boolean;
}

export interface SequenceInfo {
  schema_name: string;
  sequence_name: string;
  owner?: string | null;
  size_bytes: number;
}

export interface FunctionInfo {
  schema_name: string;
  function_name: string;
  owner?: string | null;
  arguments?: string | null;
  kind?: string | null;
}

export interface DbObjectInfo {
  schema_name: string;
  object_name: string;
  object_type: string;
  owner?: string | null;
  size_bytes: number;
}

export interface RoleInfo {
  name: string;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  can_login: boolean;
  connection_limit: number;
  valid_until?: string | null;
}

export interface RoleCreate extends MutationRequest {
  name: string;
  login?: boolean;
  password?: string | null;
  superuser?: boolean;
  createdb?: boolean;
  createrole?: boolean;
  connection_limit?: number | null;
}

export interface RoleAlter extends MutationRequest {
  password?: string | null;
  connection_limit?: number | null;
  valid_until?: string | null;
}

export interface GrantChange extends MutationRequest {
  role: string;
  privilege: string;
  object_type: string;
  schema_name?: string | null;
  object_name?: string | null;
}

export interface GrantMembershipRequest extends MutationRequest {
  member: string;
}

export interface RoleMembership {
  role: string;
  member: string;
  admin_option: boolean;
}

export interface BackendActionResult {
  pid: number;
  action: string;
  signal_sent: boolean;
}

export interface VacuumRequest extends MutationRequest {
  schema_name?: string | null;
  table_name?: string | null;
  analyze?: boolean;
  full?: boolean;
  freeze?: boolean;
}

export interface AnalyzeRequest extends MutationRequest {
  schema_name?: string | null;
  table_name?: string | null;
}

export interface ReindexRequest extends MutationRequest {
  schema_name?: string | null;
  table_name?: string | null;
  index_name?: string | null;
  concurrently?: boolean;
}

export interface MaintenanceActionResult {
  action: string;
  target: string;
  command_status: string;
}

export interface SettingInfo {
  name: string;
  setting: string;
  unit?: string | null;
  category?: string | null;
  context?: string | null;
  source?: string | null;
  pending_restart: boolean;
}

export interface SettingChange extends MutationRequest {
  value: string;
}

export interface LagPoint {
  time: string;
  lag_seconds: number;
}

export interface ReplicaInfo {
  client_address?: string | null;
  username?: string | null;
  application_name?: string | null;
  state?: string | null;
  sync_state?: string | null;
  replay_lag_bytes: number;
  replay_lag_seconds?: number | null;
  write_lag_seconds?: number | null;
  flush_lag_seconds?: number | null;
  lag_history_30m?: LagPoint[] | null;
  pid?: number | null;
}

export interface SlotInfo {
  slot_name: string;
  slot_type?: string | null;
  active: boolean;
  wal_size_bytes?: number | null;
  restart_lsn?: string | null;
  confirmed_flush_lsn?: string | null;
  active_pid?: number | null;
  plugin?: string | null;
}

export interface ReplicationStatus {
  replicas: ReplicaInfo[];
  slots: SlotInfo[];
}

export interface BackupRequest extends MutationRequest {
  database?: string | null;
  format?: string;
  schema_only?: boolean;
  data_only?: boolean;
}

export interface RestoreRequest extends MutationRequest {
  backup_id: string;
  database: string;
  clean?: boolean;
}

export interface BackupJob {
  id: string;
  kind: string;
  status: string;
  database: string;
  file?: string | null;
  size_bytes: number;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
}

export interface TableColumnProfile {
  column_name: string;
  null_count?: number;
  distinct_count?: number;
  avg_width_bytes?: number;
  min_value?: unknown;
  max_value?: unknown;
  [key: string]: unknown;
}

export interface TableImportResult {
  imported: string;
  bytes: number;
}

export interface TableAnalyzeResult {
  analyzed: string;
}

export interface ExplainResult {
  plan: unknown;
  analyze: boolean;
}

export interface ReportDict {
  [key: string]: unknown;
}

export interface GenericDict {
  [key: string]: unknown;
}

export interface PgStatStatementsRow {
  queryid?: string;
  query?: string;
  calls?: number;
  total_exec_time?: number;
  mean_exec_time?: number;
  rows?: number;
  shared_blks_hit?: number;
  shared_blks_read?: number;
  [key: string]: unknown;
}

export interface BloatRow {
  schema_name?: string;
  table_name?: string;
  dead_tuple_percent?: number;
  dead_tuples?: number;
  live_tuples?: number;
  [key: string]: unknown;
}

export interface SequenceRow {
  schema_name?: string;
  sequence_name?: string;
  last_value?: number | string;
  max_value?: number | string;
  exhaustion_percent?: number;
  [key: string]: unknown;
}

export interface PruneSnapshotsResult {
  removed: number;
  keep_days: number;
}

export interface DeletedResult {
  deleted: string;
}

export interface AlteredResult {
  altered: string;
}

export interface GrantedResult {
  granted?: string;
  role?: string;
  revoked?: string;
  to?: string;
  from?: string;
}

export interface ReloadConfigResult {
  reloaded: boolean;
}

export const endpoints = {
  getHealth: (): Promise<HealthReport> =>
    api.get<HealthReport>("/health"),

  getDiagnose: (): Promise<DiagnosticFinding[]> =>
    api.get<DiagnosticFinding[]>("/diagnose"),

  getConnections: (limit = 20): Promise<ConnectionReport> =>
    api.get<ConnectionReport>("/connections", { params: { limit } }),

  getActiveQueries: (limit = 20): Promise<QueryReport> =>
    api.get<QueryReport>("/queries/active", { params: { limit } }),

  getLongRunningQueries: (
    minSeconds = 60,
    limit = 20
  ): Promise<QueryReport> =>
    api.get<QueryReport>("/queries/long-running", {
      params: { min_seconds: minSeconds, limit },
    }),

  getLocks: (limit = 20): Promise<LockReport> =>
    api.get<LockReport>("/locks", { params: { limit } }),

  getStorage: (section = "all", limit = 20): Promise<StorageReport> =>
    api.get<StorageReport>("/storage", {
      params: { section, limit },
    }),

  getIndexes: (limit = 20): Promise<IndexReport> =>
    api.get<IndexReport>("/indexes", { params: { limit } }),

  getMaintenance: (limit = 20): Promise<MaintenanceReport> =>
    api.get<MaintenanceReport>("/maintenance", { params: { limit } }),

  getReport: (
    limit = 20,
    profile?: string
  ): Promise<ReportDict> =>
    api.get<ReportDict>("/report", { params: { limit, profile } }),

  getPgStatStatements: (
    limit = 20
  ): Promise<PgStatStatementsRow[]> =>
    api.get<PgStatStatementsRow[]>("/pg-stat-statements", {
      params: { limit },
    }),

  getBloat: (limit = 20): Promise<BloatRow[]> =>
    api.get<BloatRow[]>("/bloat", { params: { limit } }),

  getSequences: (limit = 100): Promise<SequenceRow[]> =>
    api.get<SequenceRow[]>("/sequences", { params: { limit } }),

  formatSql: (body: SqlFormatRequest): Promise<SqlFormatResponse> =>
    api.post<SqlFormatResponse>("/sql/format", body),

  explainSql: (body: ExplainRequest): Promise<ExplainResult> =>
    api.post<ExplainResult>("/sql/explain", body),

  executeSql: (body: SqlRequest): Promise<SqlResult | DryRunResult> =>
    api.post<SqlResult | DryRunResult>("/sql", body),

  listProfiles: (): Promise<Profile[]> =>
    api.get<Profile[]>("/profiles"),

  upsertProfile: (body: ProfileCreate): Promise<Profile> =>
    api.post<Profile>("/profiles", body),

  getProfile: (name: string): Promise<Profile> =>
    api.get<Profile>(`/profiles/${name}`),

  deleteProfile: (name: string): Promise<DeletedResult> =>
    api.delete<DeletedResult>(`/profiles/${name}`, {
      params: { confirm: true },
    }),

  setDefaultProfile: (name: string): Promise<Profile> =>
    api.post<Profile>(`/profiles/${name}/default`),

  listSnapshots: (
    profile?: string,
    server?: string,
    database?: string,
    limit = 50
  ): Promise<Snapshot[]> =>
    api.get<Snapshot[]>("/snapshots", {
      params: { profile, server, database, limit },
    }),

  latestSnapshot: (
    profile?: string,
    server?: string,
    database?: string
  ): Promise<Snapshot> =>
    api.get<Snapshot>("/snapshots/latest", {
      params: { profile, server, database },
    }),

  captureSnapshot: (
    profile?: string,
    server?: string
  ): Promise<Snapshot> =>
    api.post<Snapshot>("/snapshots", undefined, {
      params: { profile, server },
    }),

  pruneSnapshots: (
    keepDays = 90
  ): Promise<PruneSnapshotsResult> =>
    api.post<PruneSnapshotsResult>("/snapshots/prune", undefined, {
      params: { keep_days: keepDays, confirm: true },
    }),

  listDatabases: (): Promise<DatabaseInfo[]> =>
    api.get<DatabaseInfo[]>("/databases"),

  createDatabase: (
    body: DatabaseCreate
  ): Promise<DryRunResult | DatabaseInfo> =>
    api.post<DryRunResult | DatabaseInfo>("/databases", body),

  dropDatabase: (
    name: string,
    body: DatabaseDrop
  ): Promise<DryRunResult | DeletedResult> =>
    api.delete<DryRunResult | DeletedResult>(`/databases/${name}`, body),

  listSchemas: (): Promise<SchemaInfo[]> =>
    api.get<SchemaInfo[]>("/schemas"),

  listTables: (
    schema: string,
    limit = 100
  ): Promise<TableSummary[]> =>
    api.get<TableSummary[]>(`/schemas/${schema}/tables`, {
      params: { limit },
    }),

  listViews: (schema: string): Promise<ViewInfo[]> =>
    api.get<ViewInfo[]>(`/schemas/${schema}/views`),

  listSequencesInSchema: (
    schema: string
  ): Promise<SequenceInfo[]> =>
    api.get<SequenceInfo[]>(`/schemas/${schema}/sequences`),

  listFunctions: (schema: string): Promise<FunctionInfo[]> =>
    api.get<FunctionInfo[]>(`/schemas/${schema}/functions`),

  listObjects: (
    schema: string,
    limit = 200
  ): Promise<DbObjectInfo[]> =>
    api.get<DbObjectInfo[]>(`/schemas/${schema}/objects`, {
      params: { limit },
    }),

  describeTable: (
    schema: string,
    table: string
  ): Promise<TableDetail> =>
    api.get<TableDetail>(`/tables/${schema}/${table}`),

  listRoles: (): Promise<RoleInfo[]> =>
    api.get<RoleInfo[]>("/roles"),

  createRole: (
    body: RoleCreate
  ): Promise<DryRunResult | RoleInfo> =>
    api.post<DryRunResult | RoleInfo>("/roles", body),

  alterRole: (
    name: string,
    body: RoleAlter
  ): Promise<DryRunResult | AlteredResult> =>
    api.patch<DryRunResult | AlteredResult>(`/roles/${name}`, body),

  dropRole: (
    name: string,
    body: MutationRequest
  ): Promise<DryRunResult | DeletedResult> =>
    api.delete<DryRunResult | DeletedResult>(`/roles/${name}`, body),

  grantPrivilege: (
    body: GrantChange
  ): Promise<DryRunResult | GrantedResult> =>
    api.post<DryRunResult | GrantedResult>("/roles/grants", body),

  revokePrivilege: (
    body: GrantChange
  ): Promise<DryRunResult | GrantedResult> =>
    api.post<DryRunResult | GrantedResult>("/roles/revoke", body),

  listRoleMembers: (name: string): Promise<RoleMembership[]> =>
    api.get<RoleMembership[]>(`/roles/${name}/members`),

  listRoleMemberships: (name: string): Promise<RoleMembership[]> =>
    api.get<RoleMembership[]>(`/roles/${name}/memberships`),

  listAllMemberships: (): Promise<RoleMembership[]> =>
    api.get<RoleMembership[]>("/roles/memberships"),

  listRoleGrants: (name: string): Promise<GenericDict[]> =>
    api.get<GenericDict[]>(`/roles/${name}/grants`),

  listTableGrants: (role?: string): Promise<GenericDict[]> =>
    api.get<GenericDict[]>("/roles/grants/table", {
      params: { role },
    }),

  grantMembership: (
    name: string,
    body: GrantMembershipRequest
  ): Promise<DryRunResult | GrantedResult> =>
    api.post<DryRunResult | GrantedResult>(
      `/roles/${name}/grant-membership`,
      body
    ),

  revokeMembership: (
    name: string,
    body: GrantMembershipRequest
  ): Promise<DryRunResult | GrantedResult> =>
    api.post<DryRunResult | GrantedResult>(
      `/roles/${name}/revoke-membership`,
      body
    ),

  cancelBackend: (
    pid: number,
    body: MutationRequest
  ): Promise<DryRunResult | BackendActionResult> =>
    api.post<DryRunResult | BackendActionResult>(
      `/queries/${pid}/cancel`,
      body
    ),

  terminateBackend: (
    pid: number,
    body: MutationRequest
  ): Promise<DryRunResult | BackendActionResult> =>
    api.post<DryRunResult | BackendActionResult>(
      `/queries/${pid}/terminate`,
      body
    ),

  runVacuum: (
    body: VacuumRequest
  ): Promise<DryRunResult | MaintenanceActionResult> =>
    api.post<DryRunResult | MaintenanceActionResult>(
      "/maintenance/vacuum",
      body
    ),

  runAnalyze: (
    body: AnalyzeRequest
  ): Promise<DryRunResult | MaintenanceActionResult> =>
    api.post<DryRunResult | MaintenanceActionResult>(
      "/maintenance/analyze",
      body
    ),

  runReindex: (
    body: ReindexRequest
  ): Promise<DryRunResult | MaintenanceActionResult> =>
    api.post<DryRunResult | MaintenanceActionResult>(
      "/maintenance/reindex",
      body
    ),

  listSettings: (pattern?: string): Promise<SettingInfo[]> =>
    api.get<SettingInfo[]>("/config", { params: { pattern } }),

  getSetting: (name: string): Promise<SettingInfo> =>
    api.get<SettingInfo>(`/config/${name}`),

  changeSetting: (
    name: string,
    body: SettingChange
  ): Promise<DryRunResult | SettingInfo> =>
    api.patch<DryRunResult | SettingInfo>(
      `/config/${name}`,
      body
    ),

  reloadConfig: (
    body: MutationRequest
  ): Promise<DryRunResult | ReloadConfigResult> =>
    api.post<DryRunResult | ReloadConfigResult>(
      "/config/reload",
      body
    ),

  getReplication: (): Promise<ReplicationStatus> =>
    api.get<ReplicationStatus>("/replication"),

  listBackups: (): Promise<BackupJob[]> =>
    api.get<BackupJob[]>("/backups"),

  getBackup: (jobId: string): Promise<BackupJob> =>
    api.get<BackupJob>(`/backups/${jobId}`),

  downloadBackup: (jobId: string): Promise<Blob> =>
    api.get<Blob>(`/backups/${jobId}/download`),

  startBackup: (body: BackupRequest): Promise<BackupJob> =>
    api.post<BackupJob>("/backups", body),

  startRestore: (body: RestoreRequest): Promise<BackupJob> =>
    api.post<BackupJob>("/backups/restore", body),

  exportTable: (
    schema: string,
    table: string,
    limit = 1000,
    format = "csv"
  ): Promise<string> =>
    api.get<string>(`/tables/${schema}/${table}/export`, {
      params: { limit, format },
    }),

  importTable: (
    schema: string,
    table: string,
    file: File,
    confirm = false,
    dryRun = false
  ): Promise<DryRunResult | TableImportResult> => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<DryRunResult | TableImportResult>(
      `/tables/${schema}/${table}/import`,
      formData,
      {
        params: { confirm, dry_run: dryRun },
      }
    );
  },

  profileTable: (
    schema: string,
    table: string
  ): Promise<TableColumnProfile[]> =>
    api.get<TableColumnProfile[]>(
      `/tables/${schema}/${table}/profile`
    ),

  analyzeTable: (
    schema: string,
    table: string,
    confirm = false,
    dryRun = false
  ): Promise<DryRunResult | TableAnalyzeResult> =>
    api.post<DryRunResult | TableAnalyzeResult>(
      `/tables/${schema}/${table}/analyze`,
      undefined,
      {
        params: { confirm, dry_run: dryRun },
      }
    ),
};

export type Endpoints = typeof endpoints;
