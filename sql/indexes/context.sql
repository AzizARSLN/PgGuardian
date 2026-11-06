-- Statistics collection context (read-only).
-- ``stats_reset`` tells the monitor how long the counters have been running:
-- a fresh reset makes "unused index" verdicts unreliable, so it is surfaced.
SELECT
    current_database() AS database,
    pg_stat_get_db_stat_reset_time(d.oid) AS stats_reset
FROM pg_catalog.pg_database d
WHERE d.datname = current_database();
