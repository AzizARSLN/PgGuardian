-- Exact btree bloat estimate from leaf density (needs the pgstattuple
-- extension). When the extension is missing the query errors and the monitor
-- reports bloat as unknown instead of guessing. %s = LIMIT.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    ic.relname AS index_name,
    pg_relation_size(i.indexrelid) AS index_size_bytes,
    s.avg_leaf_density AS avg_leaf_density,
    s.leaf_fragmentation AS leaf_fragmentation,
    s.level AS btree_level
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = ic.relam AND am.amname = 'btree'
CROSS JOIN LATERAL pgstattuple.pgstatindex(i.indexrelid) s
WHERE i.indisvalid
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY index_size_bytes DESC
LIMIT %s;
