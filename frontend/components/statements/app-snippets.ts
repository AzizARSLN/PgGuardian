/** Before and after examples for the application fix tab, per finding code. */
export const APP_SNIPPETS: Record<string, { label: string; code: string }[]> = {
  N_PLUS_1: [
    {
      label: "Python / psycopg",
      code: `# before: one round trip per id
for id in ids:
    db.execute("SELECT id, name FROM users WHERE id = %s", (id,))

# after: one statement for the whole batch
rows = db.execute("SELECT id, name FROM users WHERE id = ANY(%s)", (ids,)).fetchall()
by_id = {r["id"]: r for r in rows}  # ids with no row are simply absent`,
    },
    {
      label: "SQLAlchemy",
      code: `orders = session.scalars(
    select(Order).options(selectinload(Order.customer))
).all()`,
    },
    {
      label: "Hibernate / JPA",
      code: `@Query("select o from Order o join fetch o.customer where o.status = :status")
List<Order> findWithCustomer(@Param("status") String status);
// or on the association: @BatchSize(size = 100)`,
    },
    {
      label: "Entity Framework",
      code: `var orders = await db.Orders.Include(o => o.Customer)
    .Where(o => o.Status == status).ToListAsync();`,
    },
    {
      label: "Prisma",
      code: `const orders = await prisma.order.findMany({
  where: { status },
  include: { customer: true },
});`,
    },
  ],
  OFFSET_PAGING: [
    {
      label: "SQL",
      code: `-- the client sends the last row it saw instead of a page number
SELECT id, created_at, total FROM orders
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT $3;
-- needs: CREATE INDEX CONCURRENTLY ON orders (created_at DESC, id DESC);`,
    },
    {
      label: "API",
      code: `GET /orders?limit=50
-> { "items": [...], "next_cursor": "2026-10-01T10:00:00Z|8412" }
GET /orders?limit=50&cursor=2026-10-01T10:00:00Z|8412`,
    },
  ],
  LARGE_IN: [
    {
      label: "Python / psycopg",
      code: `# one statement text whatever the list length, so one plan cache entry
db.execute("SELECT id FROM orders WHERE customer_id = ANY(%s)", (customer_ids,))`,
    },
    {
      label: "Java / JDBC",
      code: `Array ids = conn.createArrayOf("bigint", customerIds);
stmt = conn.prepareStatement("SELECT id FROM orders WHERE customer_id = ANY(?)");
stmt.setArray(1, ids);`,
    },
  ],
  SELECT_STAR: [
    {
      label: "SQLAlchemy",
      code: `session.execute(select(Order.id, Order.status).where(Order.customer_id == cid))`,
    },
    {
      label: "Hibernate / JPA",
      code: `@Query("select new com.acme.OrderRow(o.id, o.status) from Order o where o.customerId = :cid")`,
    },
  ],
  MISSING_INDEX: [
    {
      label: "Migration",
      code: `-- CONCURRENTLY cannot run inside a transaction: mark the migration as non-transactional.
-- If it fails it leaves an INVALID index; drop that before retrying.
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`,
    },
  ],
  NON_SARGABLE: [
    {
      label: "SQL",
      code: `-- before: the function hides the column from its index
WHERE lower(email) = $1
-- either index the same expression
CREATE INDEX CONCURRENTLY ON users (lower(email));

-- before: casting a timestamp column
WHERE created_at::date = $1
-- after: a range, which uses the plain index on created_at
WHERE created_at >= $1 AND created_at < $1 + interval '1 day'`,
    },
  ],
  IMPLICIT_CAST: [
    {
      label: "SQL",
      code: `-- send the parameter with the column's type, do not cast the column
WHERE id = $1::bigint`,
    },
  ],
  NOT_IN_SUBQUERY: [
    {
      label: "SQL",
      code: `-- NOT IN returns nothing when the subquery yields a NULL
WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id)`,
    },
  ],
  COUNT_FOR_EXISTS: [
    {
      label: "SQL",
      code: `-- stops at the first match instead of counting everything
SELECT EXISTS (SELECT 1 FROM orders WHERE customer_id = $1);`,
    },
  ],
  CORRELATED_SUBQUERY: [
    {
      label: "SQL",
      code: `SELECT a.id, m.max_v
FROM a
LEFT JOIN LATERAL (SELECT max(v) AS max_v FROM b WHERE b.a_id = a.id) m ON true;`,
    },
  ],
  OR_COLUMNS: [
    {
      label: "SQL",
      code: `SELECT id FROM t WHERE x = $1
UNION
SELECT id FROM t WHERE y = $2;`,
    },
  ],
  TEMP_SPILL: [
    {
      label: "SQL",
      code: `BEGIN;
SET LOCAL work_mem = '64MB';
-- the statement
COMMIT;`,
    },
  ],
  POLLING: [
    {
      label: "SQL",
      code: `-- writer
NOTIFY orders_changed;
-- worker, instead of polling
LISTEN orders_changed;`,
    },
  ],
  WAL_HEAVY: [
    {
      label: "SQL",
      code: `-- split huge writes into batches
UPDATE orders SET archived = true
WHERE id IN (SELECT id FROM orders WHERE created_at < $1 AND NOT archived LIMIT 5000);`,
    },
  ],
};
