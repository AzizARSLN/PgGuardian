-- Full connection listing from pg_stat_activity (PostgreSQL 13+, read-only).
-- %s = LIMIT.
SELECT
    pid,
    usename AS username,
    datname AS database,
    client_addr::text AS client_address,
    application_name,
    backend_type,
    state,
    wait_event_type,
    wait_event,
    EXTRACT(EPOCH FROM (now() - query_start)) AS query_duration_seconds,
    EXTRACT(EPOCH FROM (now() - xact_start)) AS transaction_duration_seconds,
    left(query, 500) AS query
FROM pg_stat_activity
ORDER BY query_duration_seconds DESC NULLS LAST
LIMIT %s;
