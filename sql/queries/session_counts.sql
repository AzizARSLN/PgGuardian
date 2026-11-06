-- Exact session totals per raw state, over the whole cluster (PostgreSQL 13+, read-only).
-- Counted separately from the row list so the UI counters stay correct even when the
-- listed rows are capped. state is NULL for background processes AND for sessions the
-- current role is not allowed to inspect (needs pg_read_all_stats); client_count splits
-- the latter (real client sessions, state hidden) from background processes.
SELECT
    state,
    count(*)::int AS count,
    count(*) FILTER (WHERE backend_type = 'client backend')::int AS client_count
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
GROUP BY state;
