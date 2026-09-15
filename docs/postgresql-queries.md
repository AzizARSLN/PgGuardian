# PostgreSQL Queries

All diagnostic SQL lives in `sql/<area>/*.sql` (single source of truth) and
is loaded at runtime by `pgguardian.database.queries.load_sql`. The wheel
packages these files via `force-include`, so installed usage works too.

## Principles

- **Read-only**: only `SELECT` against catalog and statistics views.
- **PostgreSQL 13+**: no `pg_stat_statements` dependency; queries use
  `pg_stat_activity`, `pg_locks`, `pg_stat_database`, `pg_stat_user_tables`,
  `pg_stat_user_indexes`, `pg_statio_user_tables`, `pg_stat_replication`.
- **Bounded**: listing queries take a `%s` LIMIT parameter (psycopg
  server-side binding — never string concatenation).
- **Degradable**: unsupported-version failures surface as `UNKNOWN`, never
  as crashes.

## Files

| File | Purpose |
|---|---|
| `health/overview.sql` | version, uptime, db size, connections, cache ratio, xact stats, temp files |
| `health/connections.sql` | connections grouped by state |
| `health/long_running.sql` | queries slower than `%s` seconds, `LIMIT %s` |
| `health/blocking.sql` | blocked → blocking pairs (Wikibooks-style `pg_locks` self-join) |
| `health/replication.sql` | `pg_stat_replication` with replay lag in bytes |
| `health/maintenance_overview.sql` | cluster dead/live tuples, never-vacuumed tables, autovacuum workers |
| `connections/list.sql` | full `pg_stat_activity` listing, `LIMIT %s` |
| `connections/summary.sql` | totals, `max_connections`, per-state counts |
| `queries/active.sql` | active backends by duration, `LIMIT %s` |
| `queries/long_running.sql` | duration-filtered listing, `LIMIT %s` |
| `locks/blocking.sql` | blocking pairs with queries and durations |
| `locks/summary.sql` | lock counts by type/mode, `LIMIT %s` |
| `storage/databases.sql` | `pg_database_size` per database |
| `storage/tables.sql` | top tables by total size, `LIMIT %s` |
| `storage/indexes.sql` | top indexes by size, `LIMIT %s` |
| `indexes/usage.sql` | scans / tuples read+fetched per index, `LIMIT %s` |
| `indexes/low_usage.sql` | scans ≤ `%s` candidates, `LIMIT %s` |
| `maintenance/tables.sql` | per-table tuples, timestamps and counters, `LIMIT %s` |
| `maintenance/summary.sql` | cluster maintenance rollup |
