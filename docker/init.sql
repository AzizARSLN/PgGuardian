-- PgGuardian development seed: sample schema, tables, data and indexes.
-- Applied automatically by docker compose on first volume init.
-- Safe to run multiple times (idempotent DDL).

CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers (id),
    status TEXT NOT NULL DEFAULT 'pending',
    total_cents INTEGER NOT NULL DEFAULT 0,
    placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
-- Intentionally low-traffic index for the "potentially unused" heuristic demo.
CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders (placed_at);

INSERT INTO customers (email, full_name)
SELECT 'customer' || g || '@example.com', 'Customer ' || g
FROM generate_series(1, 500) g
ON CONFLICT (email) DO NOTHING;

INSERT INTO orders (customer_id, status, total_cents)
SELECT (g % 500) + 1,
       (ARRAY['pending', 'paid', 'shipped', 'cancelled'])[(g % 4) + 1],
       (g % 250) * 100
FROM generate_series(1, 5000) g
ON CONFLICT DO NOTHING;

-- Let planner statistics exist for the seeded tables.
ANALYZE customers;
ANALYZE orders;

-- PgGuardian authentication tables (idempotent DDL).
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS pgguardian_users (
    id BIGSERIAL PRIMARY KEY,
    email CITEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    app_role TEXT NOT NULL CHECK (app_role IN ('Admin', 'DBA', 'Viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    password_must_change BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_pgguardian_users_email ON pgguardian_users (email);
CREATE INDEX IF NOT EXISTS idx_pgguardian_users_role ON pgguardian_users (app_role);
CREATE INDEX IF NOT EXISTS idx_pgguardian_users_active ON pgguardian_users (is_active);

CREATE TABLE IF NOT EXISTS pgguardian_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES pgguardian_users (id) ON DELETE CASCADE,
    refresh_hash TEXT NOT NULL,
    user_agent TEXT,
    ip_addr INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pgguardian_sessions_user_id ON pgguardian_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_pgguardian_sessions_refresh_hash ON pgguardian_sessions (refresh_hash);
CREATE INDEX IF NOT EXISTS idx_pgguardian_sessions_expires_at ON pgguardian_sessions (expires_at);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgguardian') THEN
        CREATE ROLE pgguardian WITH LOGIN PASSWORD 'pgguardian';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pgguardian;
GRANT SELECT, INSERT, UPDATE, DELETE ON pgguardian_users TO pgguardian;
GRANT SELECT, INSERT, UPDATE, DELETE ON pgguardian_sessions TO pgguardian;
GRANT USAGE, SELECT ON SEQUENCE pgguardian_users_id_seq TO pgguardian;
GRANT USAGE, SELECT ON SEQUENCE pgguardian_sessions_id_seq TO pgguardian;
