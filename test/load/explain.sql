-- Query plans for the hot paths, against the seeded load database.
\set power '''00000000-0000-7000-8000-000000000001'''
\set hot '''00000000-0000-7000-9000-000000000001'''

\echo '### 1. Redirect lookup (cache miss)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, original_url, is_active, expires_at, deleted_at, updated_at
FROM short_links WHERE code = 'c0500000';

\echo '### 2. Dashboard list: newest first, page 1 (power user, 50k links)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM short_links WHERE user_id = :power AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 0;

\echo '### 3. Same list, page 2,000 (OFFSET 39,980)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM short_links WHERE user_id = :power AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 39980;

\echo '### 4. List total count'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM short_links WHERE user_id = :power AND deleted_at IS NULL;

\echo '### 5. List filtered: status=active, sorted by expiresAt'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM short_links WHERE user_id = :power AND deleted_at IS NULL AND is_active
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY expires_at ASC NULLS LAST, id ASC LIMIT 20;

\echo '### 6. List search: q=campaign (ILIKE on code and URL)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM short_links WHERE user_id = :power AND deleted_at IS NULL
  AND (code ILIKE '%4999%' OR original_url ILIKE '%4999%')
ORDER BY created_at DESC, id DESC LIMIT 20;

\echo '### 7. Analytics: daily totals, hot link, 365 days'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT day, clicks FROM link_daily_stats
WHERE short_link_id = :hot AND dimension = 'total' AND day BETWEEN current_date - 364 AND current_date;

\echo '### 8. Analytics: top referrers, hot link, 365 days'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT value, sum(clicks) FROM link_daily_stats
WHERE short_link_id = :hot AND dimension = 'referrer' AND day BETWEEN current_date - 364 AND current_date
GROUP BY value ORDER BY sum(clicks) DESC, value ASC LIMIT 10;

\echo '### 9. Retention: one delete batch'
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
DELETE FROM click_events WHERE id IN (
  SELECT id FROM click_events WHERE clicked_at < now() - interval '90 days' LIMIT 5000);
ROLLBACK;
