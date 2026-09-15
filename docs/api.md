# PgGuardian Backend API

Expert HTTP backend for PostgreSQL: every diagnostic the CLI offers, plus
server/database management, guarded mutations, snapshots and SQL execution.
Built for the UI to consume later — same safety rules apply everywhere.

```bash
pgguardian serve --host 127.0.0.1 --port 8000
# → Swagger UI at http://127.0.0.1:8000/docs
```

Stack: **FastAPI (current) + Pydantic v2 + psycopg 3 + uvicorn**. No ORM,
no background server — connection handling is short-lived per request,
statement timeouts stay on for diagnostics.

## Connection selection

Each request uses, in order: `PGGUARDIAN_CONNECTION_STRING`, standard
`PG*` variables, or `?profile=<name>` (saved profiles win over ambient
`PG*` variables so a profile always hits the same server).

```bash
curl "http://127.0.0.1:8000/api/v1/health?profile=prod"
```

## Auth

Set `PGGUARDIAN_API_TOKEN` to require
`Authorization: Bearer <token>` on all `/api/v1` routes (constant-time
comparison). Unset = open access (local dev only). `/` and `/healthz`
never need auth or a database.

## Safety model (mutations)

Read endpoints are always available. Mutations are classified:

| Risk | Examples | Requirements |
|---|---|---|
| `MAINTENANCE` | cancel query, vacuum/analyze, create role/db, grant, backup | `PGGUARDIAN_ALLOW_WRITES=1` + `confirm: true` |
| `DANGEROUS` | terminate, drop, reindex, `VACUUM FULL`, `ALTER SYSTEM`, reload, restore | `PGGUARDIAN_ALLOW_DANGEROUS=1` + `confirm: true` + `confirm_name` matching the target |

Every executed mutation is audit-logged (stderr + optional
`PGGUARDIAN_AUDIT_LOG_FILE` JSONL) without secrets. Identifiers are
validated and composed with `psycopg.sql.Identifier` — never string
concatenation. `dry_run: true` returns the planned SQL without executing
(works without a database for most endpoints).

```bash
curl -X POST /api/v1/queries/123/cancel -d '{"confirm": true}'
curl -X POST /api/v1/queries/123/terminate -d '{"confirm": true, "confirm_name": "123"}'
```

## Endpoints

Diagnostics (read-only): `GET /health /diagnose /connections
/queries/active /queries/long-running /locks /storage?section=
/indexes /maintenance /report`

| Method & path | Description |
|---|---|
| `POST /sql` | One statement (`sql`, `params[]`, `max_rows` ≤ 5000, `readonly` default true). Results capped, `truncated` flag. |
| `GET/POST /profiles`, `GET/DELETE /profiles/{name}`, `POST /profiles/{name}/default` | Saved connection profiles (passwords stripped). |
| `GET/POST /snapshots`, `GET /snapshots/latest`, `POST /snapshots/prune` | Aggregate tracking snapshots + trends per profile/server/database. |
| `GET/POST /databases`, `DELETE /databases/{name}` | List/create/drop (refuses system + busy DBs). |
| `GET /schemas`, `GET /schemas/{s}/tables`, `GET /tables/{s}/{t}` | Namespaces, table sizes/dead-%, columns/indexes/constraints. |
| `GET/POST /roles`, `PATCH/DELETE /roles/{name}`, `POST /roles/grants`, `POST /roles/revoke`, `GET /roles/grants/table` | Roles + grants (superuser creation is DANGEROUS). |
| `POST /queries/{pid}/cancel`, `POST /queries/{pid}/terminate` | Backend control (never self). |
| `POST /maintenance/vacuum`, `/maintenance/analyze`, `/maintenance/reindex` | Expert maintenance; long ops run without statement timeout. |
| `GET/PATCH /config`, `GET /config/{name}`, `POST /config/reload` | `pg_settings` + guarded `ALTER SYSTEM`. |
| `GET /replication` | Replicas + slots (degrades gracefully). |
| `GET/POST /backups`, `GET /backups/{id}`, `GET /backups/{id}/download`, `POST /backups/restore` | `pg_dump`/`pg_restore` background jobs with sidecars; 501 when binaries missing. |

Exit mapping: `400` validation/confirm, `401` auth, `403` writes disabled,
`404` unknown target, `409` refused (self/backend busy), `501` missing
binaries, `502/503` database errors (sanitized).

## Large databases

- Every listing is bounded (`LIMIT`, API caps at 500 for diagnostics).
- `/sql` caps rows client-side (`max_rows`, hard cap 5000, `truncated` flag).
- Snapshots store aggregates only — safe to capture on TB-scale estates.
- Statement timeout stays on for diagnostics; maintenance/backup ops
  intentionally run without it (they routinely exceed it) while keeping
  connection timeouts.
- `VACUUM`/`REINDEX`/`pg_dump` run in background-safe, per-call
  connections — no shared/global state anywhere.
