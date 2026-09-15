-- Largest tables by total size (PostgreSQL 13+, read-only).
-- %s = LIMIT.
SELECT
    schemaname AS schema_name,
    relname AS table_name,
    pg_total_relation_size(relid) AS total_size_bytes,
    pg_relation_size(relid) AS table_size_bytes,
    pg_indexes_size(relid) AS indexes_size_bytes
FROM pg_catalog.pg_statio_user_tables
ORDER BY total_size_bytes DESC
LIMIT %s;
