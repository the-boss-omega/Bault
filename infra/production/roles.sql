-- =============================================================================
-- Bault — production database roles, for a managed Postgres.
--
-- Until this file existed the API, the worker and the migrations all connected
-- as one role that owned every table. The append-only triggers still refused
-- UPDATE and DELETE on history, but the owner can DROP TRIGGER, so one SQL
-- injection, one bad deploy or one wrong psql session away from the triggers
-- there was nothing. `0001_append_only.sql` already created a restricted
-- `bault_app` role for exactly this, without LOGIN, and nothing ever used it.
--
-- Three roles, one job each:
--   bault_owner   owns the database and the schema. Runs migrations, this file
--                 and the nightly dump. Never configured in the API or worker.
--   bault_app     the API. Reads and writes rows; cannot alter the schema, drop
--                 a trigger, or UPDATE/DELETE an append-only history table.
--   bault_worker  the worker. The same rights on the application tables, plus
--                 ownership of pg-boss's own `pgboss` schema.
--
-- RUN IT as bault_owner, which owns the database and is NOT a superuser (no
-- managed provider gives you one). bault_owner needs CREATEROLE, which the
-- provider's admin user has and can pass on. Run it AFTER the first migration:
-- the migration is what creates the history tables and `bault_app`.
--
--   export BAULT_APP_PASSWORD=...  BAULT_WORKER_PASSWORD=...  # from the password manager
--   psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -f infra/production/roles.sql
--
-- The passwords come from psql variables, read from those two environment
-- variables (or passed as `-v app_password=... -v worker_password=...`, which
-- leaves them in `ps` and the shell history, so prefer the environment). They
-- are never written in this file. Without them the file still runs and leaves
-- the existing passwords alone, which is how it is re-run after a deploy.
-- Do not add `-a` or `-e`: psql would echo the ALTER ROLE with the password.
-- The statement reaches the server in clear text over TLS and is stored as a
-- SCRAM verifier; a server logging DDL (`log_statement = ddl` or `all`) would
-- also write it to its log, so check the provider's setting before the first run.
--
-- RE-RUN IT (no passwords needed) after the worker's first start, and after any
-- migration. It is idempotent. The first re-run closes the pg-boss first-start
-- window described in section 6. Later re-runs revoke UPDATE/DELETE from both
-- roles on any history table a new migration added: the default privileges in
-- section 5 grant a new table full read/write to both roles, and
-- `0001_append_only.sql` revokes only from bault_app.
--
-- -----------------------------------------------------------------------------
-- CONNECTION STRINGS. Every one carries sslmode=require; a managed database is
-- reached over a network that is not ours.
--
--   migrate (/etc/bault/migrate.env) and backup.sh, as the owner, direct:
--     DATABASE_URL=postgres://bault_owner:<pw>@<host>:<port>/<db>?sslmode=require
--     DIRECT_DATABASE_URL=postgres://bault_owner:<pw>@<host>:<port>/<db>?sslmode=require
--   api:
--     DATABASE_URL=postgres://bault_app:<pw>@<pooler-host>:<pooler-port>/<db>?sslmode=require
--     DIRECT_DATABASE_URL=postgres://bault_app:<pw>@<host>:<port>/<db>?sslmode=require
--   worker, both pointing at the server, not a pooler: the worker and pg-boss
--   connect only through DIRECT_DATABASE_URL (apps/worker/src/index.ts), and
--   loadEnv() requires DATABASE_URL to be set as well:
--     DATABASE_URL=postgres://bault_worker:<pw>@<host>:<port>/<db>?sslmode=require
--     DIRECT_DATABASE_URL=postgres://bault_worker:<pw>@<host>:<port>/<db>?sslmode=require
--
-- The API and the worker therefore need DIFFERENT values for the same two
-- variables, so they cannot share one env_file unchanged: give each service
-- its own file, or override the two URLs per service in compose.
--
-- What `sslmode=require` means depends on the client. libpq (psql, pg_dump,
-- pg_restore) encrypts and does NOT check the certificate. node-postgres
-- (API, worker, migrate) treats `require` as `verify-full`: it checks the chain
-- and the hostname against Node's CA store, which does not contain a managed
-- provider's private CA, so the connection is refused. Download the provider's
-- CA certificate, mount it read-only, and name it in every URL:
--     ...?sslmode=verify-full&sslrootcert=/etc/bault/db-ca.crt
-- which is also the right setting for psql and pg_dump.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- Passwords: an explicit `-v` wins, else the environment, else none.
\if :{?app_password}
\else
  \getenv app_password BAULT_APP_PASSWORD
\endif
\if :{?worker_password}
\else
  \getenv worker_password BAULT_WORKER_PASSWORD
\endif

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Preconditions. Fail before changing anything, with a reason.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 1. The two login roles.
--
-- `0001_append_only.sql` creates bault_app WITHOUT LOGIN, so create it only if
-- it is missing and then switch LOGIN on. Created by bault_owner (here or by the
-- migration), so bault_owner holds ADMIN OPTION on both, which is what lets a
-- non-superuser alter them on Postgres 16.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. Per-role settings, applied by the server at every login.
--
-- statement_timeout: a runaway query is cancelled by Postgres and releases its
-- row locks, instead of holding a wallet lock until somebody notices.
-- idle_in_transaction_session_timeout: a transaction left open (a request that
-- awaited something slow between BEGIN and COMMIT, a crashed handler) is ended
-- after 10s instead of holding its locks indefinitely.
-- search_path = public: without "$user" first in the path, a schema somebody
-- names after one of these roles can never shadow a table the code names
-- unqualified. See section 6 for why the worker can briefly create schemas.
-- -----------------------------------------------------------------------------
ALTER ROLE bault_app    SET statement_timeout = '30s';
ALTER ROLE bault_app    SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE bault_app    SET search_path = public;
ALTER ROLE bault_worker SET statement_timeout = '30s';
ALTER ROLE bault_worker SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE bault_worker SET search_path = public;

-- -----------------------------------------------------------------------------
-- 3. Reaching the database and the schema.
--
-- CONNECT explicitly, because some providers revoke it from PUBLIC. CREATE on
-- `public` is revoked from PUBLIC: Postgres 15 already does that, older servers
-- let every role create objects next to the application's tables.
-- -----------------------------------------------------------------------------
SELECT format('GRANT CONNECT ON DATABASE %I TO bault_app, bault_worker', current_database()) \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bault_app, bault_worker;

-- -----------------------------------------------------------------------------
-- 4. Rows: read and write everything, never rewrite history.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bault_app, bault_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bault_app, bault_worker;

-- The history tables: the list in `0001_append_only.sql`, plus any table that
-- carries one of its `trg_append_only_*` triggers, so a history table added to
-- that list later is covered here without editing this file. Every listed
-- table must exist: a missing one means the migrations and this list disagree,
-- and silently skipping it would leave it writable.
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

-- An item is never deleted (Constitution Principle I, `trg_no_delete_item`).
-- It is updated all the time, so only DELETE goes.
REVOKE DELETE ON public.item FROM bault_app, bault_worker;

-- -----------------------------------------------------------------------------
-- 5. Tables that future migrations create.
--
-- Migrations run as bault_owner, so these defaults apply to everything they add.
-- A new HISTORY table is the exception: it starts out writable by both roles
-- until this file is re-run (see the header).
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE bault_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bault_app, bault_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE bault_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bault_app, bault_worker;

-- -----------------------------------------------------------------------------
-- 6. pg-boss.
--
-- DECISION: the owner pre-creates the `pgboss` schema, OWNED BY bault_worker.
--
-- The worker has to own pg-boss's tables, not merely write to them: creating a
-- queue (`boss.createQueue`, run at every start) calls `pgboss.create_queue`,
-- which ATTACHes a new partition to `pgboss.job`, and only the owner of
-- `pgboss.job` may do that. pg-boss upgrades its own schema the same way. So the
-- worker's role must be the one that owns them, and the owner's grants cannot
-- substitute.
--
-- Pre-creating the schema is not enough on its own. pg-boss 10 installs itself
-- with `CREATE SCHEMA IF NOT EXISTS pgboss`, and Postgres checks CREATE on the
-- DATABASE before it checks whether the schema exists (checked on 16.13: the
-- worker gets "permission denied for database" even when it already owns
-- `pgboss`). So until pg-boss has installed itself, the worker also holds
-- CREATE on the database, and every run of this file after that revokes it.
-- Installing is pg-boss's first start; after it, starts and upgrades only touch
-- objects the worker owns. The pinned search_path in section 2 is what keeps
-- that window harmless.
--
-- bault_owner becomes a member of bault_worker. Postgres 16 requires that to
-- create a schema owned by another role, and the inherited access is what lets
-- the owner's nightly pg_dump read pg-boss's tables. The worker gains nothing.
-- -----------------------------------------------------------------------------
GRANT bault_worker TO bault_owner;

-- A restore from `backup.sh` (pg_restore --no-owner, run as bault_owner) gives
-- every object in it to bault_owner, pg-boss's included, and a worker that does
-- not own `pgboss.job` cannot start. So objects in `pgboss` that this role owns
-- are handed back to the worker; a schema owned by anybody else is refused.
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
    -- Tables, partitions included (indexes and owned sequences follow them).
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

-- -----------------------------------------------------------------------------
-- 7. Check the result before committing it.
-- -----------------------------------------------------------------------------
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
