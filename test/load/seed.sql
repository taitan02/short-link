-- Synthetic data for query-plan checks and load tests. Run only against a dedicated database
-- (see README "Load testing"); it truncates everything first.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
TRUNCATE link_daily_stats, click_events, short_links, users;

-- 1,000 users; user 1 is a "power user" owning 50,000 links (listing worst case).
INSERT INTO users (id, email, password_hash, created_at, updated_at)
SELECT ('00000000-0000-7000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
       'load' || i || '@example.com', 'not-a-real-hash', now(), now()
FROM generate_series(1, 1000) AS i;

-- 1,000,000 links with codes c0000001..c1000000. ~10% disabled, ~10% with an expiry.
INSERT INTO short_links (id, user_id, code, original_url, is_active, expires_at, created_at, updated_at)
SELECT ('00000000-0000-7000-9000-' || lpad(to_hex(i), 12, '0'))::uuid,
       ('00000000-0000-7000-8000-' || lpad(to_hex(CASE WHEN i <= 50000 THEN 1 ELSE 2 + i % 999 END), 12, '0'))::uuid,
       'c' || lpad(i::text, 7, '0'),
       'https://example.com/products/' || i || '?campaign=load',
       i % 10 <> 0,
       CASE WHEN i % 10 = 5 THEN now() + ((i % 60) - 20) * interval '1 day' END,
       now() - (i % 365) * interval '1 day' - (i % 86400) * interval '1 second',
       now()
FROM generate_series(1, 1000000) AS i;

-- Daily aggregates: one hot link with a year of history, 10,000 links with 30 days.
INSERT INTO link_daily_stats (short_link_id, day, dimension, value, clicks)
SELECT '00000000-0000-7000-9000-000000000001'::uuid, (current_date - d), dim.dimension, dim.value,
       (random() * 1000)::int
FROM generate_series(0, 364) AS d,
     (VALUES ('total', ''), ('referrer', '(direct)'), ('referrer', 'news.ycombinator.com'),
             ('referrer', 't.co'), ('referrer', 'www.google.com'), ('referrer', 'reddit.com'),
             ('device', 'desktop'), ('device', 'mobile'), ('device', 'tablet'), ('device', 'bot'),
             ('browser', 'Chrome'), ('browser', 'Safari'), ('browser', 'Firefox'),
             ('browser', 'Edge'), ('browser', 'SlackBot')) AS dim(dimension, value);

INSERT INTO link_daily_stats (short_link_id, day, dimension, value, clicks)
SELECT ('00000000-0000-7000-9000-' || lpad(to_hex(l), 12, '0'))::uuid, (current_date - d),
       dim.dimension, dim.value, (random() * 50)::int
FROM generate_series(2, 10001) AS l,
     generate_series(0, 29) AS d,
     (VALUES ('total', ''), ('referrer', '(direct)'), ('referrer', 't.co'),
             ('device', 'mobile'), ('browser', 'Safari')) AS dim(dimension, value);

-- 1,000,000 raw clicks over the last 120 days (a third is past the 90-day retention).
INSERT INTO click_events (id, short_link_id, clicked_at, referrer_host, device_type, browser, os)
SELECT ('00000000-0000-7000-a000-' || lpad(to_hex(i), 12, '0'))::uuid,
       ('00000000-0000-7000-9000-' || lpad(to_hex(1 + i % 10000), 12, '0'))::uuid,
       now() - (i % 120) * interval '1 day' - (i % 86400) * interval '1 second',
       CASE WHEN i % 3 = 0 THEN NULL ELSE 't.co' END, 'mobile', 'Safari', 'iOS'
FROM generate_series(1, 1000000) AS i;

ANALYZE;
SELECT 'users' AS t, count(*) FROM users UNION ALL
SELECT 'short_links', count(*) FROM short_links UNION ALL
SELECT 'link_daily_stats', count(*) FROM link_daily_stats UNION ALL
SELECT 'click_events', count(*) FROM click_events;
