-- Live progress of running CREATE INDEX / REINDEX operations (PostgreSQL 12+).
-- Backed by pg_stat_progress_create_index joined to pg_stat_activity, so an
-- operator can watch, for every build currently on the server: the phase, the
-- tuple/block/partition counters, how long it has been running, the wait event
-- it is blocked on, which sessions are blocking it and who started it.
-- A concurrent build has finished its main scan once tuples_done = tuples_total;
-- when the row disappears from this view the statement has completed.
-- %s = application_name filter (NULL returns every running operation).
SELECT
    p.pid,
    p.datname AS database_name,
    p.relid::regclass::text AS table_name,
    p.index_relid::regclass::text AS index_name,
    p.command,
    p.phase,
    p.lockers_total,
    p.lockers_done,
    p.blocks_total,
    p.blocks_done,
    p.tuples_total,
    p.tuples_done,
    p.partitions_total,
    p.partitions_done,
    EXTRACT(EPOCH FROM (now() - a.query_start))::float8 AS elapsed_seconds,
    a.query_start,
    a.wait_event_type,
    a.wait_event,
    a.usename AS username,
    a.application_name,
    a.client_addr::text AS client_addr,
    a.state,
    pg_blocking_pids(p.pid) AS blocking_pids,
    a.query
FROM pg_stat_progress_create_index p
LEFT JOIN pg_stat_activity a ON a.pid = p.pid
WHERE %s::text IS NULL OR a.application_name = %s
ORDER BY p.pid;
