-- Needs shared_preload_libraries=pg_stat_statements (set in docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
\connect shortlink_test
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
