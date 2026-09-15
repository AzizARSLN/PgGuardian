-- Health overview for the current database (PostgreSQL 13+, read-only).
-- Single-row result with server, activity and I/O statistics.
SELECT
    version() AS server_version,
    current_database() AS database_name,
    EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds,
    pg_database_size(current_database()) AS database_size_bytes,
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
    (SELECT count(*)::int FROM pg_stat_activity) AS total_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active') AS active_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle') AS idle_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle in transaction') AS idle_in_transaction,
    (SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS waiting_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'autovacuum worker') AS autovacuum_workers,
    (SELECT max(EXTRACT(EPOCH FROM (now() - xact_start)))::bigint
     FROM pg_stat_activity WHERE xact_start IS NOT NULL) AS oldest_transaction_seconds,
    db.numbackends AS backends,
    db.xact_commit AS xact_commit,
    db.xact_rollback AS xact_rollback,
    db.blks_read AS blocks_read,
    db.blks_hit AS blocks_hit,
    CASE WHEN (db.blks_hit + db.blks_read) > 0
         THEN (db.blks_hit::double precision / (db.blks_hit + db.blks_read)::double precision) * 100
         ELSE NULL END AS cache_hit_ratio_percent,
    db.deadlocks AS deadlocks,
    db.temp_files AS temp_files,
    db.temp_bytes AS temp_bytes,
    db.conflicts AS conflicts
FROM pg_stat_database db
WHERE db.datname = current_database();
