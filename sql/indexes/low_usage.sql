-- Candidate low-usage indexes (PostgreSQL 13+, read-only).
-- These are *potentially* unused: cross-check workload and stats reset time
-- before acting. %s = max scans, second %s = LIMIT.
SELECT
    s.schemaname AS schema_name,
    s.relname AS table_name,
    s.indexrelname AS index_name,
    pg_relation_size(s.indexrelid) AS index_size_bytes,
    s.idx_scan AS index_scans,
    s.idx_tup_read AS tuples_read,
    s.idx_tup_fetch AS tuples_fetched,
    (
        SELECT array_agg(a.attname ORDER BY k.ord)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE k.ord <= i.indnkeyatts
    ) AS key_columns
FROM pg_catalog.pg_stat_user_indexes s
JOIN pg_catalog.pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan <= %s
ORDER BY index_size_bytes DESC
LIMIT %s;
