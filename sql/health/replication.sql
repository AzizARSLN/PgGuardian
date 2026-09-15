-- Replication status (PostgreSQL 13+, read-only).
-- Empty when this instance has no streaming replicas or the role lacks access.
SELECT
    client_addr::text AS client_address,
    usename AS username,
    application_name,
    state,
    sent_lsn::text AS sent_lsn,
    write_lsn::text AS write_lsn,
    flush_lsn::text AS flush_lsn,
    replay_lsn::text AS replay_lsn,
    (pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn))::bigint AS replay_lag_bytes
FROM pg_stat_replication;
