# PgGuardian

PostgreSQL diagnostics without the complexity — a CLI-first tool for
developers, DBAs and DevOps that inspects health, connections, queries,
locks, storage, indexes and maintenance. Read-only by default, with an
expert **backend API** (FastAPI) for full server/database management,
saved connection **profiles**, ad-hoc **SQL execution** and **snapshot
tracking** for large estates. A UI will consume the API later.

```text
PgGuardian — PostgreSQL Diagnostics

PostgreSQL       16.10
Database         production
Connections      74 / 200
Cache Hit Ratio  99.2%
Long Queries     2
Blocking Queries 0
Deadlocks        0

Health Score     94 / 100
Status           HEALTHY
```

## Features

- **Health** — version, uptime, size, connections, cache hit ratio,
  commits/rollbacks, deadlocks, temp files, long-running/blocking queries,
  replication lag, transaction age, autovacuum, dead tuples + 0–100 score
- **Diagnose** — aggregated findings (`LONG_RUNNING_QUERY`,
  `BLOCKING_QUERY`, `HIGH_CONNECTION_USAGE`, `LOW_CACHE_HIT_RATIO`,
  `IDLE_IN_TRANSACTION`, `HIGH_DEAD_TUPLES`, `POTENTIALLY_UNUSED_INDEX`,
  `AUTOVACUUM_DELAY`, `HIGH_TRANSACTION_AGE`, `REPLICATION_LAG`) with
  recommendations
- **Connections** — `pg_stat_activity` listing grouped by state + usage %
- **Queries** — `active` and `long-running` listings (bounded with LIMIT)
- **Locks** — blocking pairs, blocking chains, per-mode summary; never
  terminates backends
- **Storage** — database sizes, largest tables/indexes with B/KB/MB/GB/TB
- **Indexes** — scans, tuples read/fetched; low-scan indexes reported only
  as *potentially* unused
- **Maintenance** — live/dead tuples, dead %, last vacuum/analyze,
  autovacuum state
- **Reports** — terminal, machine-readable JSON, standalone HTML
- **Profiles** — saved server/database connections; connect once, reuse
  everywhere (`--profile prod`), passwords via env vars, never re-asked
- **Expert SQL** — run one statement at a time with read-only guards,
  classification and capped results (`pgguardian query --sql ...`)
- **Snapshots** — aggregate tracking history per server/database in local
  SQLite (`pgguardian snapshot`, `pgguardian history`)
- **Backend API** — FastAPI service (`pgguardian serve`) with diagnostics,
  databases, schemas/tables, roles/grants, cancel/terminate, vacuum/reindex,
  config, replication, pg_dump backups; mutations need opt-in + confirmation
- **PostgreSQL 13+** — unsupported checks degrade to `UNKNOWN`, never crash

## Requirements

- Python 3.12+ (3.11 also works)
- PostgreSQL 13+

## Installation

```bash
pip install pgguardian
# or from source:
pip install -e ".[dev]"
```

## Quick start

```bash
export PGGUARDIAN_CONNECTION_STRING="host=localhost dbname=app user=app password=secret"

pgguardian health
pgguardian diagnose
pgguardian connections
pgguardian queries active
pgguardian queries long-running --min-seconds 60
pgguardian locks
pgguardian storage
pgguardian storage tables
pgguardian indexes
pgguardian maintenance
pgguardian report --format json
pgguardian report --format html --output report.html

# Saved profiles — no repeated connection flags
pgguardian profile add --name prod --host db.internal --database app \
  --username app --password-env PG_PROD_PW
pgguardian --profile prod health

# Expert SQL (read-only by default, capped results)
pgguardian --profile prod query --sql "SELECT * FROM orders ORDER BY id DESC" --max-rows 50
pgguardian --profile prod query --file ./report.sql --format json

# Tracking snapshots for end-of-day server/database reports
pgguardian --profile prod snapshot
pgguardian history --profile prod

# Backend API for the future UI
pgguardian serve --port 8000
# → http://127.0.0.1:8000/docs
```

## Connection configuration

Precedence: `--connection-string` → `PGGUARDIAN_CONNECTION_STRING` →
explicit `--host/--port/--database/--username/--password` → `--profile`
(saved profile, authoritative over ambient `PG*` variables) → standard
`PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`. Passwords are never
printed or logged; error messages are sanitized. See
[docs/configuration.md](docs/configuration.md).

## Backend API

```bash
export PGGUARDIAN_API_TOKEN="change-me"   # require bearer auth
export PGGUARDIAN_ALLOW_WRITES=1          # enable expert mutations
export PGGUARDIAN_ALLOW_DANGEROUS=1       # enable drops/terminates/reindex
pgguardian serve --port 8000
```

Covers diagnostics, expert SQL, profiles, snapshots, databases,
schemas/tables, roles/grants, cancel/terminate, vacuum/analyze/reindex,
`pg_settings`, replication and `pg_dump` backups — all mutations need
explicit confirmation and are audit-logged. Full reference in
[docs/api.md](docs/api.md). Built for the future UI to consume.

## CLI commands

| Command | Description |
|---|---|
| `pgguardian health` | Health checks + 0–100 score |
| `pgguardian diagnose` | Aggregated findings with recommendations |
| `pgguardian connections` | Connection states and usage |
| `pgguardian queries [active\|long-running]` | Running queries (default limit 20) |
| `pgguardian locks` | Blocking pairs and chains |
| `pgguardian storage [databases\|tables\|indexes]` | Sizes, top-N |
| `pgguardian indexes` | Index usage + candidates |
| `pgguardian maintenance` | VACUUM/ANALYZE state |
| `pgguardian report` | Full report (`--format terminal\|json\|html`, `--output`) |
| `pgguardian profile [list\|show\|add\|remove\|set-default]` | Saved connection profiles |
| `pgguardian query --sql ...` | One guarded SQL statement (read-only default) |
| `pgguardian snapshot` / `pgguardian history` | Tracking snapshots + deltas |
| `pgguardian serve` | Backend API (FastAPI, Swagger at `/docs`) |

Global options: `--connection-string --profile --host --port --database
--username --password --format --json --quiet --timeout --no-color --version`.

Exit codes: `0` healthy · `1` warning · `2` critical · `3` config/runtime error.

## JSON / HTML

```bash
pgguardian health --json
pgguardian report --format json > report.json
pgguardian report --format html --output report.html
```

`--json` output contains no decorative text and is safe to pipe to `jq`.

## Docker

```bash
docker compose up -d
export PGGUARDIAN_CONNECTION_STRING="host=localhost port=5432 dbname=pgguardian user=pgguardian password=1"
pgguardian health
```

`docker/init.sql` seeds `customers`/`orders` with indexes for local testing.

## Development / Testing

```bash
pip install -e ".[dev]"
ruff check . && ruff format --check . && mypy src
pytest
pytest --cov=src/pgguardian
PGGUARDIAN_TEST_CONNECTION_STRING="host=localhost ..." pytest tests/integration
```

See [docs/development.md](docs/development.md) and
[docs/architecture.md](docs/architecture.md).

## Architecture

Typer CLI → isolated diagnostics (psycopg 3, `.sql` files in `sql/`) →
frozen Pydantic models → Rich/JSON/HTML renderers. Details in
[docs/architecture.md](docs/architecture.md).

## Security

Diagnostics are read-only by design. Expert mutations (cancel/terminate,
vacuum/reindex, create/drop, grants, `ALTER SYSTEM`, restores) exist in the
API and `query` command but are **disabled by default** — they need
`PGGUARDIAN_ALLOW_WRITES` / `PGGUARDIAN_ALLOW_DANGEROUS` plus explicit
confirmation (`confirm_name` for drops/terminates), and are audit-logged.
User input is bound as SQL parameters or composed with
`psycopg.sql.Identifier`; secrets are masked in all output and errors
(see `utils/security.py` and `tests/unit/test_security.py`).

## PostgreSQL compatibility

Targets PostgreSQL 13+. The server version is detected per connection;
checks that fail (permissions, version) report `UNKNOWN` while the rest
continue. No `pg_stat_statements` dependency.

## Roadmap

- Web UI on top of the backend API
- `pgguardian.toml` / `pgguardian.yaml` config file support
- Baseline/diff mode and watch mode
- Prometheus/OpenTelemetry export
- More check packs (bloat estimates, sequence exhaustion)

## License

MIT — see [LICENSE](LICENSE).
