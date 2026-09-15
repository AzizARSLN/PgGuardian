-- Currently active queries (PostgreSQL 13+, read-only).
-- %s = LIMIT.
SELECT
    pid,
    usename AS username,
    datname AS database,
    state,
    wait_event_type,
    wait_event,
    EXTRACT(EPOCH FROM (now() - query_start)) AS duration_seconds,
    left(query, 1000) AS query
FROM pg_stat_activity
WHERE state = 'active'
  AND pid <> pg_backend_pid()
ORDER BY duration_seconds DESC NULLS LAST
LIMIT %s;
