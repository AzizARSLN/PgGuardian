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
