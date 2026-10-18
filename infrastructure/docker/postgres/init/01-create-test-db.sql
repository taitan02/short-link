-- Runs only when the data volume is first created. Tests refuse to run against any database
-- whose name does not end in _test.
CREATE DATABASE shortlink_test OWNER shortlink;
