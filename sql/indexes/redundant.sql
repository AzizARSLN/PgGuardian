-- Indexes whose key columns are a leading prefix of another index on the same
-- table (for example (a) covered by (a, b)). Heuristic: a different operator
-- class or an index-only-scan workload can still justify the shorter index.
-- %s = LIMIT.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    rind.relname AS redundant_index,
    kind.relname AS covered_by,
    pg_relation_size(ri.indexrelid) AS redundant_size_bytes,
    pg_relation_size(ki.indexrelid) AS covering_size_bytes
FROM pg_catalog.pg_index ri
JOIN pg_catalog.pg_index ki
  ON ki.indrelid = ri.indrelid
 AND ki.indexrelid <> ri.indexrelid
 AND ki.indisvalid
 AND ki.indpred IS NULL
JOIN pg_catalog.pg_class rind ON rind.oid = ri.indexrelid
JOIN pg_catalog.pg_class kind ON kind.oid = ki.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = ri.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE ri.indisvalid
  AND NOT ri.indisprimary
  AND NOT ri.indisunique
  AND ri.indpred IS NULL
  AND ri.indexprs IS NULL
  AND ri.indnkeyatts < ki.indnkeyatts
  AND (ri.indkey::int2[])[1:ri.indnkeyatts] = (ki.indkey::int2[])[1:ri.indnkeyatts]
  AND c.relkind IN ('r', 'm', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY redundant_size_bytes DESC
LIMIT %s;
