export const qk = {
  health: () => ["health"] as const,

  diagnostics: {
    all: () => ["diagnostics"] as const,
    diagnose: () => ["diagnostics", "diagnose"] as const,
    connections: (limit?: number) =>
      ["diagnostics", "connections", limit] as const,
    queries: {
      active: (limit?: number) =>
        ["diagnostics", "queries", "active", limit] as const,
      longRunning: (minSeconds?: number, limit?: number) =>
        [
          "diagnostics",
          "queries",
          "long-running",
          minSeconds,
          limit,
        ] as const,
    },
    locks: (limit?: number) => ["diagnostics", "locks", limit] as const,
    storage: (section?: string, limit?: number) =>
      ["diagnostics", "storage", section, limit] as const,
    indexes: (limit?: number) => ["diagnostics", "indexes", limit] as const,
    maintenance: (limit?: number) =>
      ["diagnostics", "maintenance", limit] as const,
    report: (limit?: number, profile?: string) =>
      ["diagnostics", "report", limit, profile] as const,
    pgStatStatements: (limit?: number) =>
      ["diagnostics", "pg-stat-statements", limit] as const,
    bloat: (limit?: number) => ["diagnostics", "bloat", limit] as const,
    sequences: (limit?: number) =>
      ["diagnostics", "sequences", limit] as const,
  },

  sql: {
    format: () => ["sql", "format"] as const,
    explain: () => ["sql", "explain"] as const,
    execute: () => ["sql", "execute"] as const,
  },

  profiles: {
    all: () => ["profiles"] as const,
    detail: (name: string) => ["profiles", name] as const,
  },

  snapshots: {
    all: (
      profile?: string,
      server?: string,
      database?: string,
      limit?: number
    ) =>
      ["snapshots", profile, server, database, limit] as const,
    latest: (profile?: string, server?: string, database?: string) =>
      ["snapshots", "latest", profile, server, database] as const,
  },

  databases: {
    all: () => ["databases"] as const,
  },

  schemas: {
    all: () => ["schemas"] as const,
    tables: (schema: string, limit?: number) =>
      ["schemas", schema, "tables", limit] as const,
    views: (schema: string) => ["schemas", schema, "views"] as const,
    sequences: (schema: string) =>
      ["schemas", schema, "sequences"] as const,
    functions: (schema: string) =>
      ["schemas", schema, "functions"] as const,
    objects: (schema: string, limit?: number) =>
      ["schemas", schema, "objects", limit] as const,
    table: (schema: string, table: string) =>
      ["schemas", "table", schema, table] as const,
  },

  roles: {
    all: () => ["roles"] as const,
    detail: (name: string) => ["roles", name] as const,
    members: (name: string) => ["roles", name, "members"] as const,
    memberships: (name: string) =>
      ["roles", name, "memberships"] as const,
    allMemberships: () => ["roles", "memberships"] as const,
    grants: (name: string) => ["roles", name, "grants"] as const,
    tableGrants: (role?: string) =>
      ["roles", "table-grants", role] as const,
  },

  querymgmt: {
    cancel: (pid: number) => ["querymgmt", "cancel", pid] as const,
    terminate: (pid: number) =>
      ["querymgmt", "terminate", pid] as const,
  },

  maintenance_ops: {
    vacuum: () => ["maintenance_ops", "vacuum"] as const,
    analyze: () => ["maintenance_ops", "analyze"] as const,
    reindex: () => ["maintenance_ops", "reindex"] as const,
  },

  configops: {
    all: (pattern?: string) => ["configops", pattern] as const,
    detail: (name: string) => ["configops", name] as const,
    reload: () => ["configops", "reload"] as const,
  },

  replication: {
    status: () => ["replication", "status"] as const,
  },

  backups: {
    all: () => ["backups"] as const,
    detail: (jobId: string) => ["backups", jobId] as const,
    download: (jobId: string) =>
      ["backups", "download", jobId] as const,
    restore: () => ["backups", "restore"] as const,
  },

  table_io: {
    export: (schema: string, table: string, limit?: number) =>
      ["table_io", "export", schema, table, limit] as const,
    import: (schema: string, table: string) =>
      ["table_io", "import", schema, table] as const,
    profile: (schema: string, table: string) =>
      ["table_io", "profile", schema, table] as const,
    analyze: (schema: string, table: string) =>
      ["table_io", "analyze", schema, table] as const,
  },
};

export type QueryKeyType = typeof qk;
