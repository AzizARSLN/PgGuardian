-- Connection totals and max_connections (PostgreSQL 13+, read-only).
SELECT
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
    (SELECT count(*)::int FROM pg_stat_activity) AS total_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active') AS active_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle') AS idle_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle in transaction') AS idle_in_transaction,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle in transaction (aborted)') AS idle_in_transaction_aborted,
    (SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type IS NOT NULL) AS waiting_connections;
