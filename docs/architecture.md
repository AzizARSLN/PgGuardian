# Architecture

PgGuardian is a CLI-first diagnostics tool. The dependency flow is strictly
one-directional — domain and diagnostic code never depends on output code:

```text
CLI (pgguardian/cli)
  └─> diagnostics (pgguardian/diagnostics)
        ├─> database (connection factory + SQL loader)
        ├─> models (immutable Pydantic models)
        ├─> scoring (HealthScoreCalculator)
        ├─> config (Pydantic Settings + thresholds)
        ├─> profiles (saved connections, ~/.config/pgguardian)
        ├─> sqlexec (guarded expert SQL: classify + capped execute)
        ├─> snapshots (SQLite tracking store, stdlib only)
        └─> utils (formatting, secret masking)
  └─> output (terminal / json / html renderers)

API (pgguardian/api, FastAPI — for the future UI)
  └─> routers (diagnostics, sql, profiles, snapshots, databases,
      schemas, roles, querymgmt, maintenance-ops, configops,
      replication, backups)
        ├─> deps (settings, client resolution, token auth, error mapping)
        └─> safety (risk levels, opt-in gates, confirm, audit, identifiers)
```

## Layers

- **CLI (`cli/`)** — Typer commands, global options, exit codes. Each
  `cli/<area>.py` module orchestrates one command: build settings, create a
  `DbClient`, run the diagnostic, render, return an exit code (0 healthy,
  1 warning, 2 critical, 3 runtime error).
- **Diagnostics (`diagnostics/`)** — one module per area. Each exposes
  `collect_*` functions plus pure `map_*`/`evaluate_*` helpers so the
  threshold logic is unit-testable without a database. Every query is
  isolated: a failure degrades that check to `UNKNOWN` instead of aborting
  the whole run.
- **Database (`database/`)** — `DbClient` opens a short-lived psycopg 3
  connection per call (no global state). `queries.load_sql` loads the
  versioned `.sql` files from `sql/<area>/`. `statement_timeout` provides
  query timeout/cancellation.
- **Models (`models/`)** — frozen Pydantic models (`HealthCheck`,
  `HealthReport`, `DiagnosticFinding`, `ConnectionInfo`, `QueryInfo`,
  `LockInfo`, `StorageInfo`, `IndexInfo`, `MaintenanceInfo`). Immutable by
  design; serialization via `model_dump(mode="json")`.
- **Scoring (`scoring/`)** — `HealthScoreCalculator`: CRITICAL −25,
  WARNING −10, UNKNOWN −5, clamped to 0–100. Status: HEALTHY ≥ 90,
  DEGRADED ≥ 60, CRITICAL < 60, UNKNOWN when no checks ran.
- **Output (`output/`)** — `TerminalRenderer` (Rich), `JsonRenderer`
  (stdlib/Pydantic), `HtmlRenderer` (dependency-free template). Models never
  import renderers.

## Read-only guarantee

PgGuardian only issues `SELECT` queries against catalog views
(`pg_stat_activity`, `pg_locks`, `pg_stat_user_tables`, ...). The `tests`
suite asserts that no SQL file contains destructive keywords or calls such
as `pg_terminate_backend` / `pg_cancel_backend`.
