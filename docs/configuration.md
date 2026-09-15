# Configuration

Precedence (highest first): **CLI options → environment variables → defaults**.

## Connection

Option 1 — connection string (highest precedence):

```bash
pgguardian --connection-string "host=db port=5432 dbname=app user=app password=secret" health
export PGGUARDIAN_CONNECTION_STRING="host=db port=5432 dbname=app user=app"
```

Option 2 — standard PostgreSQL variables (no PgGuardian-specific setup needed):

```text
PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
```

Option 3 — individual options (also available as `PGGUARDIAN_HOST`, ...):

```bash
pgguardian --host db --port 5432 --database app --username app health
# PGPASSWORD or --password supplies the password; it is never logged.
```

An optional `.env` file in the working directory is also read.

## Thresholds

All thresholds are settings with `PGGUARDIAN_*` overrides:

| Setting | Default | Env var |
|---|---|---|
| `connection_usage_warning` | 80 (%) | `PGGUARDIAN_CONNECTION_USAGE_WARNING` |
| `connection_usage_critical` | 95 (%) | `PGGUARDIAN_CONNECTION_USAGE_CRITICAL` |
| `cache_hit_warning` | 95 (%) | `PGGUARDIAN_CACHE_HIT_WARNING` |
| `cache_hit_critical` | 90 (%) | `PGGUARDIAN_CACHE_HIT_CRITICAL` |
| `long_query_warning_seconds` | 60 | `PGGUARDIAN_LONG_QUERY_WARNING_SECONDS` |
| `long_query_critical_seconds` | 300 | `PGGUARDIAN_LONG_QUERY_CRITICAL_SECONDS` |
| `dead_tuple_warning_percent` | 10 | `PGGUARDIAN_DEAD_TUPLE_WARNING_PERCENT` |
| `dead_tuple_critical_percent` | 30 | `PGGUARDIAN_DEAD_TUPLE_CRITICAL_PERCENT` |
| `transaction_age_warning_seconds` | 300 | `PGGUARDIAN_TRANSACTION_AGE_WARNING_SECONDS` |
| `transaction_age_critical_seconds` | 900 | `PGGUARDIAN_TRANSACTION_AGE_CRITICAL_SECONDS` |
| `replication_lag_warning_bytes` | 16777216 | `PGGUARDIAN_REPLICATION_LAG_WARNING_BYTES` |
| `replication_lag_critical_bytes` | 134217728 | `PGGUARDIAN_REPLICATION_LAG_CRITICAL_BYTES` |
| `unused_index_max_scans` | 50 | `PGGUARDIAN_UNUSED_INDEX_MAX_SCANS` |
| `connect_timeout` | 10 (s) | `PGGUARDIAN_CONNECT_TIMEOUT` |
| `query_timeout_ms` | 30000 | `PGGUARDIAN_QUERY_TIMEOUT_MS` |
| `default_limit` | 20 | `PGGUARDIAN_DEFAULT_LIMIT` |

A future `pgguardian.toml`/`pgguardian.yaml` file is on the roadmap; the
current MVP intentionally keeps configuration to CLI + environment.
