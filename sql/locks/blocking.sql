-- Lock waits: same blocking-pair query as health/blocking (PostgreSQL 13+, read-only).
SELECT
    blocked.pid AS blocked_pid,
    blocking.pid AS blocking_pid,
    blocked.usename AS blocked_user,
    blocking.usename AS blocking_user,
    blocked.datname AS database_name,
    blocked.relation::regclass::text AS relation,
    blocked_lock.locktype AS lock_type,
    blocked_lock.mode AS blocked_mode,
    blocking_lock.mode AS blocking_mode,
    EXTRACT(EPOCH FROM (now() - blocking.query_start)) AS blocking_duration_seconds,
    left(blocking.query, 500) AS blocking_query,
    left(blocked.query, 500) AS blocked_query
FROM pg_catalog.pg_locks AS blocked_lock
JOIN pg_catalog.pg_stat_activity AS blocked ON blocked.pid = blocked_lock.pid
JOIN pg_catalog.pg_locks AS blocking_lock
  ON blocking_lock.locktype = blocked_lock.locktype
 AND blocking_lock.database IS NOT DISTINCT FROM blocked_lock.database
 AND blocking_lock.relation IS NOT DISTINCT FROM blocked_lock.relation
 AND blocking_lock.page IS NOT DISTINCT FROM blocked_lock.page
 AND blocking_lock.tuple IS NOT DISTINCT FROM blocked_lock.tuple
 AND blocking_lock.virtualxid IS NOT DISTINCT FROM blocked_lock.virtualxid
 AND blocking_lock.transactionid IS NOT DISTINCT FROM blocked_lock.transactionid
 AND blocking_lock.classid IS NOT DISTINCT FROM blocked_lock.classid
 AND blocking_lock.objid IS NOT DISTINCT FROM blocked_lock.objid
 AND blocking_lock.objsubid IS NOT DISTINCT FROM blocked_lock.objsubid
 AND blocking_lock.pid <> blocked_lock.pid
JOIN pg_catalog.pg_stat_activity AS blocking ON blocking.pid = blocking_lock.pid
WHERE NOT blocked_lock.granted
  AND blocking_lock.granted;
