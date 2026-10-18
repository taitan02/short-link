-- Hand-edited to build CONCURRENTLY, i.e. without blocking writes to short_links (a plain
-- CREATE INDEX holds a write lock for the whole build). Prisma sends a migration as one script,
-- and Postgres wraps multi-statement scripts in a transaction, where CONCURRENTLY is not
-- allowed: so this migration has exactly one statement, and the old index is dropped in the
-- next one, after this one exists. If a concurrent build fails it leaves an INVALID index:
-- drop it, mark the migration rolled back (prisma migrate resolve), and deploy again.
CREATE INDEX CONCURRENTLY "short_links_user_id_created_at_id_idx" ON "short_links"("user_id", "created_at" DESC, "id" DESC);
