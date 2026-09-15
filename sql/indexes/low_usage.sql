-- Candidate low-usage indexes (PostgreSQL 13+, read-only).
-- These are *potentially* unused: cross-check workload and stats reset time
-- before acting. %s = max scans, second %s = LIMIT.
SELECT
    schemaname AS schema_name,
    relname AS table_name,
    indexrelname AS index_name,
    pg_relation_size(indexrelid) AS index_size_bytes,
    idx_scan AS index_scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched
FROM pg_catalog.pg_stat_user_indexes
WHERE idx_scan <= %s
ORDER BY index_size_bytes DESC
LIMIT %s;
