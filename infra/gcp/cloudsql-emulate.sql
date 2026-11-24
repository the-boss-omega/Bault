\set ON_ERROR_STOP on
\set QUIET on

\if :{?owner_password}
\else
  \getenv owner_password BAULT_OWNER_PASSWORD
\endif
\if :{?dbname}
\else
  \set dbname bault
\endif

SELECT 'CREATE ROLE cloudsqlsuperuser NOLOGIN CREATEROLE CREATEDB'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') \gexec
SELECT format('CREATE ROLE bault_owner LOGIN CREATEROLE CREATEDB PASSWORD %L IN ROLE cloudsqlsuperuser', :'owner_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bault_owner') \gexec
SELECT format('CREATE DATABASE %I OWNER cloudsqlsuperuser', :'dbname')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec

\set QUIET off
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb
  FROM pg_roles WHERE rolname IN ('cloudsqlsuperuser', 'bault_owner') ORDER BY 1;
