PgGuardian

PostgreSQL health, diagnostics and maintenance toolkit for developers, DBAs and DevOps engineers.

The goal is to provide a simple CLI for checking PostgreSQL performance, connections, locks, storage and database statistics.

Current focus

- PostgreSQL health checks
- Connection diagnostics
- Long running queries
- Blocking queries
- Lock analysis
- Database and table sizes
- Index statistics
- Maintenance statistics
- JSON and HTML reporting

Planned commands

pgguardian health
pgguardian diagnose
pgguardian connections
pgguardian queries
pgguardian locks
pgguardian storage
pgguardian indexes
pgguardian report

Example

PostgreSQL        16.10
Database          production
Connections       74 / 200
Cache Hit Ratio   99.2%
Long Queries      3
Blocking Queries  1
Deadlocks         0

Health Score      91 / 100
Status            HEALTHY

Technology

.NET 10
C#
Npgsql
PostgreSQL
Spectre.Console
System.CommandLine

The project is designed to be read-only by default and suitable for development, DBA and production diagnostic scenarios.

Roadmap

- Health checks
- Query diagnostics
- Lock diagnostics
- Storage analysis
- Index analysis
- JSON output
- HTML reports
- Docker support
- CI/CD integration
- Configurable health rules
- PostgreSQL replication diagnostics

License

MIT
