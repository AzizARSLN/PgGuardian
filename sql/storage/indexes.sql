-- Largest indexes by size (PostgreSQL 13+, read-only).
-- %s = LIMIT.
SELECT
    schemaname AS schema_name,
    tablename AS table_name,
    indexrelname AS index_name,
    pg_relation_size(indexrelid) AS size_bytes
FROM pg_catalog.pg_stat_user_indexes
ORDER BY size_bytes DESC
LIMIT %s;
