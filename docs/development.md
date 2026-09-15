# Development

Requires Python 3.12+ (3.11 works for local development), Docker for the
dev database.

```bash
# Install (editable + dev tools)
pip install -e ".[dev]"

# Start PostgreSQL 16 with seed data
docker compose up -d

# Point the CLI at it
export PGGUARDIAN_CONNECTION_STRING="host=localhost port=5432 dbname=pgguardian user=pgguardian password=pgguardian"

pgguardian health
pgguardian diagnose
pgguardian report --format html --output report.html
```

## Checks (run after every significant change)

```bash
ruff check .
ruff format --check .
mypy src
pytest
pytest --cov=src/pgguardian
```

Live integration tests only run when `PGGUARDIAN_TEST_CONNECTION_STRING`
is set; otherwise they skip. Never point tests at a production database.

## Conventions

- Type hints on all public functions, including return types.
- Frozen Pydantic models for diagnostics; no global mutable state.
- User input always goes through psycopg `%s` parameters — never string
  concatenation into SQL.
- Secrets (passwords, connection strings) must never be logged, printed,
  or embedded in error messages — use `pgguardian.utils.security`.
