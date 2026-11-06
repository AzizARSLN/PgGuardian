-- Index buffer cache-hit ratio (pg_statio_user_indexes, read-only).
-- A low ratio on a frequently scanned index points at a working set bigger
-- than shared_buffers. %s = LIMIT.
SELECT
    schemaname AS schema_name,
    relname AS table_name,
    indexrelname AS index_name,
    COALESCE(idx_blks_hit, 0) AS idx_blks_hit,
    COALESCE(idx_blks_read, 0) AS idx_blks_read,
    CASE
        WHEN COALESCE(idx_blks_hit, 0) + COALESCE(idx_blks_read, 0) > 0
        THEN ROUND(
            100.0 * idx_blks_hit / NULLIF(idx_blks_hit + idx_blks_read, 0), 2)
        ELSE NULL
    END AS cache_hit_percent
FROM pg_catalog.pg_statio_user_indexes
ORDER BY idx_blks_read DESC
LIMIT %s;
