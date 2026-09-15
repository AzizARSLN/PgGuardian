-- Lock summary by type/mode (PostgreSQL 13+, read-only).
-- %s = LIMIT.
SELECT
    locktype AS lock_type,
    mode,
    count(*)::int AS locks,
    count(*) FILTER (WHERE NOT granted)::int AS waiting
FROM pg_catalog.pg_locks
GROUP BY locktype, mode
ORDER BY locks DESC
LIMIT %s;
