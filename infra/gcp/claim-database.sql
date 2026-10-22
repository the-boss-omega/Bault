\set ON_ERROR_STOP on
\set QUIET on
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), current_user)
 WHERE (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> current_user \gexec
\set QUIET off
SELECT current_database() AS database, pg_get_userbyid(datdba) AS owner
  FROM pg_database WHERE datname = current_database();
