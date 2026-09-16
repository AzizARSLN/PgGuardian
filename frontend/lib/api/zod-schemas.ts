import { z } from "zod";

export const SeveritySchema = z.enum([
  "OK",
  "INFO",
  "WARNING",
  "CRITICAL",
  "UNKNOWN",
]);

export const RiskLevelSchema = z.enum([
  "READ",
  "MAINTENANCE",
  "DANGEROUS",
]);

export const StatementKindSchema = z.enum([
  "READ",
  "WRITE",
  "DDL",
  "DANGEROUS",
  "UNKNOWN",
]);

export const HealthCheckSchema = z.object({
  name: z.string(),
  status: SeveritySchema,
  value: z.string().nullable().optional(),
  threshold: z.string().nullable().optional(),
  severity: SeveritySchema.default("OK"),
  description: z.string().default(""),
});

export const HealthReportSchema = z.object({
  server_version: z.string().default("unknown"),
  database: z.string().default("unknown"),
  uptime_seconds: z.number().int().nullable().optional(),
  checks: z.array(HealthCheckSchema).default([]),
  score: z.number().int().default(0),
  status: z.string().default("UNKNOWN"),
  generated_at: z.string().default(() => new Date().toISOString()),
});

export const DiagnosticFindingSchema = z.object({
  code: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  description: z.string(),
  value: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
});

export const ConnectionInfoSchema = z.object({
  pid: z.number().int(),
  user: z.string().nullable().optional(),
  database: z.string().nullable().optional(),
  client_address: z.string().nullable().optional(),
  application_name: z.string().nullable().optional(),
  backend_type: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  wait_event_type: z.string().nullable().optional(),
  wait_event: z.string().nullable().optional(),
  query_duration_seconds: z.number().nullable().optional(),
  transaction_duration_seconds: z.number().nullable().optional(),
  query: z.string().nullable().optional(),
});

export const ConnectionSummarySchema = z.object({
  current_connections: z.number().int().default(0),
  max_connections: z.number().int().default(0),
  usage_percent: z.number().default(0.0),
  active: z.number().int().default(0),
  idle: z.number().int().default(0),
  idle_in_transaction: z.number().int().default(0),
  waiting: z.number().int().default(0),
  by_state: z.record(z.string(), z.number().int()).default({}),
});

export const ConnectionReportSchema = z.object({
  summary: ConnectionSummarySchema.default(() =>
    ConnectionSummarySchema.parse({})
  ),
  connections: z.array(ConnectionInfoSchema).default([]),
});

export const IndexInfoSchema = z.object({
  schema_name: z.string().nullable().optional(),
  table_name: z.string().nullable().optional(),
  index_name: z.string(),
  index_size_bytes: z.number().int().default(0),
  index_scans: z.number().int().default(0),
  tuples_read: z.number().int().default(0),
  tuples_fetched: z.number().int().default(0),
  potentially_unused: z.boolean().default(false),
  reason: z.string().nullable().optional(),
});

export const IndexReportSchema = z.object({
  limit: z.number().int().default(20),
  count: z.number().int().default(0),
  indexes: z.array(IndexInfoSchema).default([]),
  potentially_unused: z.array(IndexInfoSchema).default([]),
});

export const LockInfoSchema = z.object({
  blocking_pid: z.number().int(),
  blocked_pid: z.number().int(),
  blocking_user: z.string().nullable().optional(),
  blocked_user: z.string().nullable().optional(),
  database: z.string().nullable().optional(),
  relation: z.string().nullable().optional(),
  lock_type: z.string().nullable().optional(),
  blocked_mode: z.string().nullable().optional(),
  blocking_mode: z.string().nullable().optional(),
  blocking_duration_seconds: z.number().nullable().optional(),
  blocking_query: z.string().nullable().optional(),
  blocked_query: z.string().nullable().optional(),
});

export const LockSummarySchema = z.object({
  total_locks: z.number().int().default(0),
  waiting_locks: z.number().int().default(0),
  blocking_pairs: z.number().int().default(0),
  by_mode: z.record(z.string(), z.number().int()).default({}),
});

export const LockReportSchema = z.object({
  summary: LockSummarySchema.default(() => LockSummarySchema.parse({})),
  locks: z.array(LockInfoSchema).default([]),
  chains: z.array(z.string()).default([]),
});

export const TableMaintenanceSchema = z.object({
  schema_name: z.string().nullable().optional(),
  table_name: z.string(),
  live_tuples: z.number().int().default(0),
  dead_tuples: z.number().int().default(0),
  dead_tuple_percent: z.number().default(0.0),
  last_vacuum: z.string().nullable().optional(),
  last_autovacuum: z.string().nullable().optional(),
  last_analyze: z.string().nullable().optional(),
  last_autoanalyze: z.string().nullable().optional(),
  vacuum_count: z.number().int().default(0),
  autovacuum_count: z.number().int().default(0),
  analyze_count: z.number().int().default(0),
  autoanalyze_count: z.number().int().default(0),
  status: SeveritySchema.default("OK"),
});

export const MaintenanceSummarySchema = z.object({
  total_live_tuples: z.number().int().default(0),
  total_dead_tuples: z.number().int().default(0),
  dead_tuple_percent: z.number().default(0.0),
  tables_total: z.number().int().default(0),
  tables_never_vacuumed: z.number().int().default(0),
  tables_never_analyzed: z.number().int().default(0),
  autovacuum_workers: z.number().int().default(0),
});

export const MaintenanceReportSchema = z.object({
  summary: MaintenanceSummarySchema.default(() =>
    MaintenanceSummarySchema.parse({})
  ),
  tables: z.array(TableMaintenanceSchema).default([]),
  limit: z.number().int().default(20),
});

export const QueryInfoSchema = z.object({
  pid: z.number().int(),
  duration_seconds: z.number().nullable().optional(),
  user: z.string().nullable().optional(),
  database: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  wait_event_type: z.string().nullable().optional(),
  wait_event: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
});

export const QueryReportSchema = z.object({
  kind: z.string().default("active"),
  limit: z.number().int().default(20),
  count: z.number().int().default(0),
  queries: z.array(QueryInfoSchema).default([]),
});

export const DatabaseSizeSchema = z.object({
  database: z.string(),
  size_bytes: z.number().int().default(0),
});

export const TableSizeSchema = z.object({
  schema_name: z.string().nullable().optional(),
  table_name: z.string(),
  total_size_bytes: z.number().int().default(0),
  table_size_bytes: z.number().int().default(0),
  indexes_size_bytes: z.number().int().default(0),
});

export const IndexSizeSchema = z.object({
  schema_name: z.string().nullable().optional(),
  table_name: z.string().nullable().optional(),
  index_name: z.string(),
  size_bytes: z.number().int().default(0),
});

export const StorageReportSchema = z.object({
  databases: z.array(DatabaseSizeSchema).default([]),
  tables: z.array(TableSizeSchema).default([]),
  indexes: z.array(IndexSizeSchema).default([]),
  limit: z.number().int().default(20),
});

export const MutationRequestSchema = z.object({
  confirm: z.boolean().default(false),
  confirm_name: z.string().nullable().optional(),
  dry_run: z.boolean().default(false),
});

export const DryRunResultSchema = z.object({
  action: z.string(),
  risk: RiskLevelSchema,
  sql: z.array(z.string()).default([]),
  target: z.string().nullable().optional(),
  note: z.string().default("dry_run: nothing was executed"),
});

export const SqlResultSchema = z.object({
  kind: StatementKindSchema.default("READ"),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.array(z.unknown())).default([]),
  row_count: z.number().int().default(0),
  truncated: z.boolean().default(false),
  duration_ms: z.number().int().default(0),
  command: z.string().default(""),
});

export const ProfileSchema = z.object({
  name: z.string(),
  host: z.string().default("localhost"),
  port: z.number().int().default(5432),
  database: z.string().default("postgres"),
  username: z.string().default("postgres"),
  password: z.string().nullable().optional(),
  password_env: z.string().nullable().optional(),
  server: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_default: z.boolean().default(false),
  created_at: z.string().default(() => new Date().toISOString()),
  updated_at: z.string().default(() => new Date().toISOString()),
});

export const ProfileCreateSchema = z.object({
  name: z.string(),
  host: z.string().default("localhost"),
  port: z.number().int().default(5432),
  database: z.string().default("postgres"),
  username: z.string().default("postgres"),
  password: z.string().nullable().optional(),
  password_env: z.string().nullable().optional(),
  server: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_default: z.boolean().default(false),
});

export const SnapshotSchema = z.object({
  id: z.number().int().default(0),
  taken_at: z.string().default(() => new Date().toISOString()),
  profile: z.string().nullable().optional(),
  server: z.string().nullable().optional(),
  host: z.string().default("localhost"),
  port: z.number().int().default(5432),
  database: z.string().default("postgres"),
  server_version: z.string().default("unknown"),
  score: z.number().int().default(0),
  status: z.string().default("UNKNOWN"),
  connections: z.number().int().default(0),
  max_connections: z.number().int().default(0),
  cache_hit: z.number().nullable().optional(),
  db_size_bytes: z.number().int().default(0),
  dead_tuples: z.number().int().default(0),
  live_tuples: z.number().int().default(0),
  long_queries: z.number().int().default(0),
  blocking_pairs: z.number().int().default(0),
  deadlocks: z.number().int().default(0),
});

export const SqlRequestSchema = MutationRequestSchema.extend({
  sql: z.string(),
  params: z.array(z.unknown()).nullable().optional(),
  max_rows: z.number().int().default(100),
  readonly: z.boolean().default(true),
});

export const SqlFormatRequestSchema = z.object({
  sql: z.string(),
  keyword_case: z.string().default("upper"),
});

export const SqlFormatResponseSchema = z.object({
  original: z.string(),
  formatted: z.string(),
  keyword_case: z.string(),
});

export const ExplainRequestSchema = z.object({
  sql: z.string(),
  analyze: z.boolean().default(false),
});

export const DatabaseInfoSchema = z.object({
  name: z.string(),
  owner: z.string().nullable().optional(),
  size_bytes: z.number().int().default(0),
  allow_connections: z.boolean().default(true),
  connection_limit: z.number().int().default(-1),
});

export const DatabaseCreateSchema = MutationRequestSchema.extend({
  name: z.string(),
  owner: z.string().nullable().optional(),
  encoding: z.string().nullable().optional(),
});

export const DatabaseDropSchema = MutationRequestSchema;

export const SchemaInfoSchema = z.object({
  name: z.string(),
  owner: z.string().nullable().optional(),
  is_system: z.boolean().default(false),
});

export const TableSummarySchema = z.object({
  schema_name: z.string(),
  table_name: z.string(),
  owner: z.string().nullable().optional(),
  total_size_bytes: z.number().int().default(0),
  live_tuples: z.number().int().default(0),
  dead_tuples: z.number().int().default(0),
  dead_tuple_percent: z.number().default(0.0),
});

export const ColumnInfoSchema = z.object({
  name: z.string(),
  data_type: z.string(),
  nullable: z.boolean().default(true),
  default: z.string().nullable().optional(),
});

export const TableDetailSchema = z.object({
  schema_name: z.string(),
  table_name: z.string(),
  owner: z.string().nullable().optional(),
  total_size_bytes: z.number().int().default(0),
  live_tuples: z.number().int().default(0),
  dead_tuples: z.number().int().default(0),
  columns: z.array(ColumnInfoSchema).default([]),
  indexes: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
});

export const ViewInfoSchema = z.object({
  schema_name: z.string(),
  view_name: z.string(),
  owner: z.string().nullable().optional(),
  is_materialized: z.boolean().default(false),
});

export const SequenceInfoSchema = z.object({
  schema_name: z.string(),
  sequence_name: z.string(),
  owner: z.string().nullable().optional(),
  size_bytes: z.number().int().default(0),
});

export const FunctionInfoSchema = z.object({
  schema_name: z.string(),
  function_name: z.string(),
  owner: z.string().nullable().optional(),
  arguments: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
});

export const DbObjectInfoSchema = z.object({
  schema_name: z.string(),
  object_name: z.string(),
  object_type: z.string(),
  owner: z.string().nullable().optional(),
  size_bytes: z.number().int().default(0),
});

export const RoleInfoSchema = z.object({
  name: z.string(),
  superuser: z.boolean().default(false),
  createdb: z.boolean().default(false),
  createrole: z.boolean().default(false),
  can_login: z.boolean().default(false),
  connection_limit: z.number().int().default(-1),
  valid_until: z.string().nullable().optional(),
});

export const RoleCreateSchema = MutationRequestSchema.extend({
  name: z.string(),
  login: z.boolean().default(false),
  password: z.string().nullable().optional(),
  superuser: z.boolean().default(false),
  createdb: z.boolean().default(false),
  createrole: z.boolean().default(false),
  connection_limit: z.number().int().nullable().optional(),
});

export const RoleAlterSchema = MutationRequestSchema.extend({
  password: z.string().nullable().optional(),
  connection_limit: z.number().int().nullable().optional(),
  valid_until: z.string().nullable().optional(),
});

export const GrantChangeSchema = MutationRequestSchema.extend({
  role: z.string(),
  privilege: z.string(),
  object_type: z.string(),
  schema_name: z.string().nullable().optional(),
  object_name: z.string().nullable().optional(),
});

export const GrantMembershipRequestSchema = MutationRequestSchema.extend({
  member: z.string(),
});

export const RoleMembershipSchema = z.object({
  role: z.string(),
  member: z.string(),
  admin_option: z.boolean().default(false),
});

export const BackendActionResultSchema = z.object({
  pid: z.number().int(),
  action: z.string(),
  signal_sent: z.boolean(),
});

export const VacuumRequestSchema = MutationRequestSchema.extend({
  schema_name: z.string().nullable().optional(),
  table_name: z.string().nullable().optional(),
  analyze: z.boolean().default(true),
  full: z.boolean().default(false),
  freeze: z.boolean().default(false),
});

export const AnalyzeRequestSchema = MutationRequestSchema.extend({
  schema_name: z.string().nullable().optional(),
  table_name: z.string().nullable().optional(),
});

export const ReindexRequestSchema = MutationRequestSchema.extend({
  schema_name: z.string().nullable().optional(),
  table_name: z.string().nullable().optional(),
  index_name: z.string().nullable().optional(),
  concurrently: z.boolean().default(true),
});

export const MaintenanceActionResultSchema = z.object({
  action: z.string(),
  target: z.string(),
  command_status: z.string(),
});

export const SettingInfoSchema = z.object({
  name: z.string(),
  setting: z.string(),
  unit: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  pending_restart: z.boolean().default(false),
});

export const SettingChangeSchema = MutationRequestSchema.extend({
  value: z.string(),
});

export const ReplicaInfoSchema = z.object({
  client_address: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  application_name: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  replay_lag_bytes: z.number().int().default(0),
});

export const SlotInfoSchema = z.object({
  slot_name: z.string(),
  slot_type: z.string().nullable().optional(),
  active: z.boolean().default(false),
});

export const ReplicationStatusSchema = z.object({
  replicas: z.array(ReplicaInfoSchema).default([]),
  slots: z.array(SlotInfoSchema).default([]),
});

export const BackupRequestSchema = MutationRequestSchema.extend({
  database: z.string().nullable().optional(),
  format: z.string().default("custom"),
  schema_only: z.boolean().default(false),
  data_only: z.boolean().default(false),
});

export const RestoreRequestSchema = MutationRequestSchema.extend({
  backup_id: z.string(),
  database: z.string(),
  clean: z.boolean().default(false),
});

export const BackupJobSchema = z.object({
  id: z.string(),
  kind: z.string().default("backup"),
  status: z.string().default("running"),
  database: z.string().default(""),
  file: z.string().nullable().optional(),
  size_bytes: z.number().int().default(0),
  started_at: z.string().default(""),
  finished_at: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const TableColumnProfileSchema = z.record(z.unknown());

export const TableImportResultSchema = z.object({
  imported: z.string(),
  bytes: z.number().int(),
});

export const TableAnalyzeResultSchema = z.object({
  analyzed: z.string(),
});

export const ExplainResultSchema = z.object({
  plan: z.unknown(),
  analyze: z.boolean(),
});

export const GenericDictSchema = z.record(z.unknown());

export const PruneSnapshotsResultSchema = z.object({
  removed: z.number().int(),
  keep_days: z.number().int(),
});

export const DeletedResultSchema = z.object({
  deleted: z.string(),
});

export const AlteredResultSchema = z.object({
  altered: z.string(),
});

export const GrantedResultSchema = z.object({
  granted: z.string().optional(),
  role: z.string().optional(),
  revoked: z.string().optional(),
  to: z.string().optional(),
  from: z.string().optional(),
});

export const ReloadConfigResultSchema = z.object({
  reloaded: z.boolean(),
});

export type Severity = z.infer<typeof SeveritySchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type StatementKind = z.infer<typeof StatementKindSchema>;
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type HealthReport = z.infer<typeof HealthReportSchema>;
export type DiagnosticFinding = z.infer<typeof DiagnosticFindingSchema>;
export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;
export type ConnectionSummary = z.infer<typeof ConnectionSummarySchema>;
export type ConnectionReport = z.infer<typeof ConnectionReportSchema>;
export type IndexInfo = z.infer<typeof IndexInfoSchema>;
export type IndexReport = z.infer<typeof IndexReportSchema>;
export type LockInfo = z.infer<typeof LockInfoSchema>;
export type LockSummary = z.infer<typeof LockSummarySchema>;
export type LockReport = z.infer<typeof LockReportSchema>;
export type TableMaintenance = z.infer<typeof TableMaintenanceSchema>;
export type MaintenanceSummary = z.infer<typeof MaintenanceSummarySchema>;
export type MaintenanceReport = z.infer<typeof MaintenanceReportSchema>;
export type QueryInfo = z.infer<typeof QueryInfoSchema>;
export type QueryReport = z.infer<typeof QueryReportSchema>;
export type DatabaseSize = z.infer<typeof DatabaseSizeSchema>;
export type TableSize = z.infer<typeof TableSizeSchema>;
export type IndexSize = z.infer<typeof IndexSizeSchema>;
export type StorageReport = z.infer<typeof StorageReportSchema>;
export type MutationRequest = z.infer<typeof MutationRequestSchema>;
export type DryRunResult = z.infer<typeof DryRunResultSchema>;
export type SqlResult = z.infer<typeof SqlResultSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileCreate = z.infer<typeof ProfileCreateSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type SqlRequest = z.infer<typeof SqlRequestSchema>;
export type SqlFormatRequest = z.infer<typeof SqlFormatRequestSchema>;
export type SqlFormatResponse = z.infer<typeof SqlFormatResponseSchema>;
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;
export type DatabaseInfo = z.infer<typeof DatabaseInfoSchema>;
export type DatabaseCreate = z.infer<typeof DatabaseCreateSchema>;
export type DatabaseDrop = z.infer<typeof DatabaseDropSchema>;
export type SchemaInfo = z.infer<typeof SchemaInfoSchema>;
export type TableSummary = z.infer<typeof TableSummarySchema>;
export type ColumnInfo = z.infer<typeof ColumnInfoSchema>;
export type TableDetail = z.infer<typeof TableDetailSchema>;
export type ViewInfo = z.infer<typeof ViewInfoSchema>;
export type SequenceInfo = z.infer<typeof SequenceInfoSchema>;
export type FunctionInfo = z.infer<typeof FunctionInfoSchema>;
export type DbObjectInfo = z.infer<typeof DbObjectInfoSchema>;
export type RoleInfo = z.infer<typeof RoleInfoSchema>;
export type RoleCreate = z.infer<typeof RoleCreateSchema>;
export type RoleAlter = z.infer<typeof RoleAlterSchema>;
export type GrantChange = z.infer<typeof GrantChangeSchema>;
export type GrantMembershipRequest = z.infer<typeof GrantMembershipRequestSchema>;
export type RoleMembership = z.infer<typeof RoleMembershipSchema>;
export type BackendActionResult = z.infer<typeof BackendActionResultSchema>;
export type VacuumRequest = z.infer<typeof VacuumRequestSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type ReindexRequest = z.infer<typeof ReindexRequestSchema>;
export type MaintenanceActionResult = z.infer<typeof MaintenanceActionResultSchema>;
export type SettingInfo = z.infer<typeof SettingInfoSchema>;
export type SettingChange = z.infer<typeof SettingChangeSchema>;
export type ReplicaInfo = z.infer<typeof ReplicaInfoSchema>;
export type SlotInfo = z.infer<typeof SlotInfoSchema>;
export type ReplicationStatus = z.infer<typeof ReplicationStatusSchema>;
export type BackupRequest = z.infer<typeof BackupRequestSchema>;
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;
export type BackupJob = z.infer<typeof BackupJobSchema>;
