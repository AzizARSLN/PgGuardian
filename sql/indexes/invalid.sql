-- Invalid or not-ready indexes left behind by a failed CREATE/REINDEX
-- CONCURRENTLY. They take up space, slow down writes and are never used by
-- the planner until they are rebuilt. %s = LIMIT.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    ic.relname AS index_name,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    i.indislive AS is_live,
    pg_relation_size(i.indexrelid) AS index_size_bytes,
    pg_get_indexdef(i.indexrelid) AS definition
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE (NOT i.indisvalid OR NOT i.indisready)
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY index_size_bytes DESC
LIMIT %s;
