-- Groups of indexes sharing an identical key column list and predicate.
-- These are heuristic candidates: an INCLUDE column or a different operator
-- class can still make one of them useful. %s = LIMIT.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    i.indkey::text AS column_signature,
    COALESCE(i.indpred::text, '') AS predicate_signature,
    array_agg(ic.relname ORDER BY pg_relation_size(i.indexrelid) DESC) AS index_names,
    array_agg(pg_relation_size(i.indexrelid) ORDER BY pg_relation_size(i.indexrelid) DESC)
        AS index_sizes,
    SUM(pg_relation_size(i.indexrelid)) AS total_size_bytes,
    COUNT(*) AS index_count,
    bool_or(i.indisprimary) AS has_primary
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE i.indisvalid
  AND c.relkind IN ('r', 'm', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
GROUP BY n.nspname, c.relname, i.indkey::text, COALESCE(i.indpred::text, '')
HAVING COUNT(*) > 1
ORDER BY total_size_bytes DESC
LIMIT %s;
