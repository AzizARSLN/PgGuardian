-- Maintenance rollup (PostgreSQL 13+, read-only).
SELECT
    (SELECT coalesce(sum(n_live_tup), 0)::bigint FROM pg_stat_user_tables) AS total_live_tuples,
    (SELECT coalesce(sum(n_dead_tup), 0)::bigint FROM pg_stat_user_tables) AS total_dead_tuples,
    (SELECT count(*)::int FROM pg_stat_user_tables) AS tables_total,
    (SELECT count(*)::int FROM pg_stat_user_tables WHERE last_vacuum IS NULL AND last_autovacuum IS NULL) AS tables_never_vacuumed,
    (SELECT count(*)::int FROM pg_stat_user_tables WHERE last_analyze IS NULL AND last_autoanalyze IS NULL) AS tables_never_analyzed,
    (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'autovacuum worker') AS autovacuum_workers;
