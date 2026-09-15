-- Database sizes (PostgreSQL 13+, read-only).
SELECT
    datname AS database,
    pg_database_size(datname) AS size_bytes
FROM pg_database
WHERE NOT datistemplate
ORDER BY size_bytes DESC;
