-- Per-table VACUUM/ANALYZE state (PostgreSQL 13+, read-only).
-- %s = LIMIT.
SELECT
    schemaname AS schema_name,
    relname AS table_name,
    n_live_tup AS live_tuples,
    n_dead_tup AS dead_tuples,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    vacuum_count,
    autovacuum_count,
    analyze_count,
    autoanalyze_count
FROM pg_catalog.pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT %s;
