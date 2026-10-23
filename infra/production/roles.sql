
\set ON_ERROR_STOP on
\set QUIET on

\if :{?app_password}
\else
  \getenv app_password BAULT_APP_PASSWORD
\endif
\if :{?worker_password}
\else
  \getenv worker_password BAULT_WORKER_PASSWORD
\endif

BEGIN;

DO $$
BEGIN
  IF current_user <> 'bault_owner' THEN
    RAISE EXCEPTION 'roles.sql must run as bault_owner, not %', current_user
      USING HINT = 'The default privileges below are for objects bault_owner creates; run as anyone else they cover nothing.';
  END IF;
  IF to_regclass('public.ledger_record') IS NULL THEN
    RAISE EXCEPTION 'the schema is not migrated yet (no public.ledger_record)'
      USING HINT = 'Run the migrations as bault_owner first, then this file.';
  END IF;
END
$$;

SELECT 'CREATE ROLE bault_app'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bault_app') \gexec
SELECT 'CREATE ROLE bault_worker'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bault_worker') \gexec

\if :{?app_password}
ALTER ROLE bault_app LOGIN PASSWORD :'app_password';
\else
ALTER ROLE bault_app LOGIN;
\echo 'note: BAULT_APP_PASSWORD not set; bault_app keeps its current password (none, on a first run)'
\endif
\if :{?worker_password}
ALTER ROLE bault_worker LOGIN PASSWORD :'worker_password';
\else
ALTER ROLE bault_worker LOGIN;
\echo 'note: BAULT_WORKER_PASSWORD not set; bault_worker keeps its current password (none, on a first run)'
\endif

ALTER ROLE bault_app    SET statement_timeout = '30s';
ALTER ROLE bault_app    SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE bault_app    SET search_path = public;
ALTER ROLE bault_worker SET statement_timeout = '30s';
ALTER ROLE bault_worker SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE bault_worker SET search_path = public;

SELECT format('GRANT CONNECT ON DATABASE %I TO bault_app, bault_worker', current_database()) \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bault_app, bault_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bault_app, bault_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bault_app, bault_worker;

DO $$
DECLARE
  t text;
  history_tables text[] := ARRAY['ledger_record', 'custody_event', 'audit_record', 'bin_transfer', 'wallet_request_event', 'arrival_disposal', 'parcel_event', 'support_message', 'escrow_event', 'login_attempt'];
BEGIN
  FOREACH t IN ARRAY history_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'history table public.% does not exist', t
        USING HINT = 'Run the migrations first, or update this list to match 0001_append_only.sql.';
    END IF;
  END LOOP;

  FOR t IN
    SELECT unnest(history_tables)
    UNION
    SELECT c.relname
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND tg.tgname LIKE 'trg_append_only_%' AND NOT tg.tgisinternal
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON public.%I FROM bault_app, bault_worker', t);
  END LOOP;
END
$$;

REVOKE DELETE ON public.item FROM bault_app, bault_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE bault_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bault_app, bault_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE bault_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bault_app, bault_worker;

GRANT bault_worker TO bault_owner;

DO $$
DECLARE
  current_owner text;
  obj text;
BEGIN
  SELECT pg_get_userbyid(nspowner) INTO current_owner FROM pg_namespace WHERE nspname = 'pgboss';
  IF current_owner IS NOT NULL AND current_owner NOT IN ('bault_worker', current_user) THEN
    RAISE EXCEPTION 'schema pgboss exists and is owned by %, not bault_worker', current_owner
      USING HINT = 'pg-boss was started under another role. Stop the worker, drop that schema (its scheduled jobs are re-created on start), and re-run this file.';
  END IF;
  IF current_owner = current_user THEN
    RAISE NOTICE 'pgboss is owned by % (a restored backup?); handing it to bault_worker', current_user;
    EXECUTE 'ALTER SCHEMA pgboss OWNER TO bault_worker';
    FOR obj IN
      SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p', 'v', 'm')
         AND c.relowner = current_user::regrole
    LOOP
      EXECUTE format('ALTER TABLE %s OWNER TO bault_worker', obj);
    END LOOP;
    FOR obj IN
      SELECT t.oid::regtype::text FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'pgboss' AND t.typtype IN ('e', 'd') AND t.typowner = current_user::regrole
    LOOP
      EXECUTE format('ALTER TYPE %s OWNER TO bault_worker', obj);
    END LOOP;
    FOR obj IN
      SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'pgboss' AND p.proowner = current_user::regrole
    LOOP
      EXECUTE format('ALTER ROUTINE %s OWNER TO bault_worker', obj);
    END LOOP;
  END IF;
END
$$;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION bault_worker;

SELECT CASE
         WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'pgboss' AND c.relname = 'version')
         THEN format('REVOKE CREATE ON DATABASE %I FROM bault_worker', current_database())
         ELSE format('GRANT CREATE ON DATABASE %I TO bault_worker', current_database())
       END \gexec

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s may %s %s', r.role, p.priv, c.relname), '; ')
    INTO bad
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('bault_app'), ('bault_worker')) AS r(role)
    CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
   WHERE n.nspname = 'public' AND tg.tgname LIKE 'trg_append_only_%' AND NOT tg.tgisinternal
     AND has_table_privilege(r.role, c.oid, p.priv);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'history is still writable: %', bad;
  END IF;
  IF has_database_privilege('bault_app', current_database(), 'CREATE')
     OR has_schema_privilege('bault_app', 'public', 'CREATE')
     OR has_schema_privilege('bault_worker', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'an application role can create objects it must not';
  END IF;
END
$$;

COMMIT;

\set QUIET off
\echo
\echo 'Roles and per-role settings:'
SELECT rolname AS role, rolcanlogin AS login, rolsuper AS superuser, rolconfig AS settings
  FROM pg_roles WHERE rolname IN ('bault_owner', 'bault_app', 'bault_worker') ORDER BY 1;
\echo 'Worker may create schemas (true only until pg-boss has installed itself; re-run this file after the first start):'
SELECT has_database_privilege('bault_worker', current_database(), 'CREATE') AS worker_db_create;
