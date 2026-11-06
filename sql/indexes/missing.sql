-- Tables dominated by sequential scans while holding little or no index
-- support. Advisory only: without the query workload we cannot know which
-- columns to index, so the monitor never auto-creates anything. %s = LIMIT.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    COALESCE(s.seq_scan, 0) AS seq_scan,
    COALESCE(s.seq_tup_read, 0) AS seq_tup_read,
    COALESCE(s.idx_scan, 0) AS idx_scan,
    COALESCE(s.n_live_tup, 0) AS live_tuples,
    pg_relation_size(c.oid) AS table_size_bytes,
    (
        SELECT COUNT(*) FROM pg_catalog.pg_index i
        WHERE i.indrelid = c.oid AND i.indisvalid
    ) AS index_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND COALESCE(s.seq_scan, 0) > 0
  AND pg_relation_size(c.oid) > 1048576
ORDER BY COALESCE(s.seq_tup_read, 0) DESC
LIMIT %s;
