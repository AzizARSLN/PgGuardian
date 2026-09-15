-- Connection state breakdown (PostgreSQL 13+, read-only).
SELECT
    coalesce(state, 'unknown') AS state,
    count(*)::int AS connections
FROM pg_stat_activity
GROUP BY coalesce(state, 'unknown')
ORDER BY connections DESC;
