-- Runs once, when the production data volume is created. Requires
-- shared_preload_libraries=pg_stat_statements (set in deploy/docker-compose.prod.yml).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
