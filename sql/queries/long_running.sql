-- Long-running queries above a duration threshold (PostgreSQL 13+, read-only).
-- %s = minimum duration in seconds, second %s = LIMIT.
SELECT
    pid,
    usename AS username,
    datname AS database,
    state,
    wait_event_type,
    wait_event,
    EXTRACT(EPOCH FROM (now() - query_start)) AS duration_seconds,
    -- Full text: a truncated statement cannot be EXPLAINed by the analysis panel.
    query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND query_start IS NOT NULL
  AND EXTRACT(EPOCH FROM (now() - query_start)) > %s
ORDER BY duration_seconds DESC
LIMIT %s;
