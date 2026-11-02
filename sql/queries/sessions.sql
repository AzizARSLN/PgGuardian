-- Every backend with where it connects from (PostgreSQL 13+, read-only).
-- state is NULL for background processes. client_hostname needs log_hostname=on.
-- %s = LIMIT.
SELECT
    pid,
    usename AS username,
    datname AS database,
    state,
    backend_type,
    application_name,
    host(client_addr) AS client_addr,
    client_hostname,
    client_port,
    wait_event_type,
    wait_event,
    EXTRACT(EPOCH FROM (now() - state_change))::float8 AS state_seconds,
    EXTRACT(EPOCH FROM (now() - xact_start))::float8 AS xact_seconds,
    EXTRACT(EPOCH FROM (now() - backend_start))::float8 AS backend_seconds,
    pg_blocking_pids(pid) AS blocked_by,
    left(query, 2000) AS query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
ORDER BY state NULLS LAST, state_change
LIMIT %s;
