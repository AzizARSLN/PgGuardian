-- Full index inventory (PostgreSQL 13+, read-only).
-- Carries validity flags, key columns, index type and per-index usage stats
-- so the monitor can judge usefulness without a second round-trip.
-- %s = LIMIT.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    ic.relname AS index_name,
    pg_relation_size(i.indexrelid) AS index_size_bytes,
    COALESCE(s.idx_scan, 0) AS index_scans,
    COALESCE(s.idx_tup_read, 0) AS tuples_read,
    COALESCE(s.idx_tup_fetch, 0) AS tuples_fetched,
    COALESCE(ts.seq_scan, 0) AS table_seq_scan,
    i.indisunique AS is_unique,
    i.indisprimary AS is_primary,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    i.indislive AS is_live,
    (i.indpred IS NOT NULL) AS is_partial,
    (i.indexprs IS NOT NULL) AS is_expression,
    (i.indnkeyatts < i.indnatts) AS has_include,
    i.indnkeyatts AS key_column_count,
    am.amname AS index_type,
    pg_get_indexdef(i.indexrelid) AS definition,
    (
        SELECT array_agg(a.attname ORDER BY k.ord)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE k.ord <= i.indnkeyatts
    ) AS key_columns
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = ic.relam
LEFT JOIN pg_catalog.pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
LEFT JOIN pg_catalog.pg_stat_user_tables ts ON ts.relid = i.indrelid
WHERE c.relkind IN ('r', 'm', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY index_size_bytes DESC
LIMIT %s;
