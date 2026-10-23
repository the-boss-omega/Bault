# Restore drill

This database is the only record of who owns which card and who is owed what. A
backup that has never been restored is a rumour, so this drill is performed on a
schedule, timed, and written down in the log at the bottom. Launch waits for one
successful run of each drill.

There are two ways back, and both are drilled:

|                                         | Provider PITR                                            | Nightly dump (`backup.sh`)                                                   |
| --------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Recovery point                          | any second in the retention window (seven days at least) | the last 01:17 UTC dump, so up to 24 hours lost                              |
| Survives losing the provider account    | no                                                       | yes: it lives in a bucket in a separate account                              |
| Survives a bad migration that succeeded | yes, restore to just before it                           | yes, `deploy.sh` dumps before every migration                                |
| Who holds the key                       | the provider                                             | the owner: the age private key is in the password manager, never on a server |

**Schedule.** PITR drill and dump drill once a month each, alternating every
two weeks. Run both again after any change to `backup.sh`, `roles.sql`, the
provider plan or the Postgres major version.

**Where.** On a restore machine (the owner's workstation or a throwaway VM),
never on the production host. A restore always goes into a NEW cluster or a NEW
database and never over the live one.

## What the restore machine needs

- `postgresql-client-16` (psql, pg_dump and pg_restore at the server's major version), `age`, and the `aws` cli or `rclone`
- the repository at the deployed tag (`cat /opt/bault/CURRENT_TAG` on the host), for `backup.sh` and `roles.sql`
- the age identity, copied from the password manager to a file with mode 600 for the length of the drill, then deleted
- a READ key for the backup bucket. Not the host's key, which can only write.
- a Postgres server on which you may create databases: the provider's restored cluster, or a local one:

  ```
  docker run -d --name restore-pg -e POSTGRES_PASSWORD=<scratch> -p 127.0.0.1:55432:5432 postgres:16
  export RESTORE_ADMIN_URL=postgres://postgres:<scratch>@127.0.0.1:55432/postgres
  ```

---

## Drill 1. Point-in-time recovery at the provider

1. **Pick the target time T.** Choose a random minute in the last seven days, not
   a round one, and write it in the log as UTC.

2. **Record a witness**, so the restore can be checked against T instead of
   against a feeling. On production, read-only:

   ```sql
   SELECT id, created_at FROM ledger_record
    WHERE created_at BETWEEN TIMESTAMPTZ '<T>' - interval '30 minutes'
                         AND TIMESTAMPTZ '<T>' + interval '30 minutes'
    ORDER BY created_at;
   ```

   Note the last row before T and the first row after it. If there are none, use
   `custody_event.occurred_at` or `login_attempt.created_at`.

3. **Restore to T into a NEW cluster**, from the provider console or CLI. Two
   examples, to be checked against the provider's current documentation:

   ```
   # DigitalOcean
   doctl databases fork bault-pitr-drill --restore-from-cluster-id <cluster-id> \
     --restore-from-timestamp "<T, e.g. 2026-10-11 14:37:00 +0000 UTC>"
   # AWS RDS
   aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier bault-prod \
     --target-db-instance-identifier bault-pitr-drill --restore-time <T, e.g. 2026-10-11T14:37:00Z>
   ```

   Write down when you asked and when the cluster accepted connections.

4. **Check that it is T.** Connect as `bault_owner`, with `sslmode=require` or stricter:

   - the witness row before T is present and the one after T is absent;
   - `SELECT max(created_at) FROM ledger_record;` is no later than T;
   - `SELECT rolname FROM pg_roles WHERE rolname LIKE 'bault%';` lists the three roles. A provider that restores one database rather than the whole cluster does not bring roles back; run `infra/production/roles.sql` with the passwords in that case.

5. **Check it is whole.** Dump the restored cluster and verify the dump. `verify`
   restores it once more into a scratch database, counts rows, checks the ledger
   and custody trail point at rows that exist and that all eleven append-only
   guard triggers are there, and exits 1 on any violation:

   ```
   DIRECT_DATABASE_URL='postgres://bault_owner:<pw>@<restored-host>:<port>/<db>?sslmode=require' \
     BACKUP_DIR=./drill ./infra/ops/backup.sh dump
   DIRECT_DATABASE_URL="$RESTORE_ADMIN_URL" ./infra/ops/backup.sh verify ./drill/bault-<stamp>.dump
   ```

   Copy the six row counts it prints into the log.

6. **Check the application can use it.** Run the deployed API image against the
   restored cluster as `bault_app`, with a staging env file, and ask it whether
   it is ready:

   ```
   docker run --rm -d --name api-drill --env-file staging.env \
     -e DATABASE_URL='postgres://bault_app:<pw>@<restored-host>:<port>/<db>?sslmode=require' \
     -e DIRECT_DATABASE_URL='postgres://bault_app:<pw>@<restored-host>:<port>/<db>?sslmode=require' \
     -p 127.0.0.1:3999:3000 ghcr.io/<owner>/bault-api:<tag>
   curl -fsS http://127.0.0.1:3999/api/v1/readyz
   docker rm -f api-drill
   ```

7. **Tear down** the restored cluster (it is billed by the hour) and fill in the log.

## Drill 2. Restore the nightly dump from the off-site bucket

1. **Fetch the latest dump** and its checksum (now and then a random older one):

   ```
   aws s3 ls s3://<backup-bucket>/nightly/ [--endpoint-url <endpoint>] | tail -3
   aws s3 cp s3://<backup-bucket>/nightly/bault-<stamp>.dump.age        ./drill/
   aws s3 cp s3://<backup-bucket>/nightly/bault-<stamp>.dump.age.sha256 ./drill/
   ```

2. **Verify it:** checksum, decryption, table of contents, a full restore into a
   scratch database, row counts and invariants. Exit 0 means usable and exit 1
   means not:

   ```
   DIRECT_DATABASE_URL="$RESTORE_ADMIN_URL" \
     ./infra/ops/backup.sh verify ./drill/bault-<stamp>.dump.age --age-identity ./bault-backup.key
   ```

3. **Restore it as production would be restored:** into a new, empty database
   owned by a non-superuser `bault_owner`, then migrations and roles exactly as
   on a fresh managed database. As the server's admin:

   ```sql
   CREATE ROLE bault_owner LOGIN CREATEROLE PASSWORD '<scratch>';
   CREATE DATABASE bault_restore OWNER bault_owner;
   ```

   Then:

   ```
   OWNER_URL='postgres://bault_owner:<scratch>@127.0.0.1:55432/bault_restore'
   echo bault_restore | ./infra/ops/backup.sh restore ./drill/bault-<stamp>.dump.age "$OWNER_URL" \
     --age-identity ./bault-backup.key
   docker run --rm --network host --env-file staging.env \
     -e DATABASE_URL="$OWNER_URL" -e DIRECT_DATABASE_URL="$OWNER_URL" \
     ghcr.io/<owner>/bault-api:<tag> node dist/db/migrate.js       # applies nothing new; re-installs the guards
   BAULT_APP_PASSWORD=<scratch> BAULT_WORKER_PASSWORD=<scratch> \
     psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -f infra/production/roles.sql
   ```

   (`restore` asks for the database name. Piping it is fine in a drill and
   deliberate in an incident.)

4. **Check the application can use it:** step 6 of Drill 1, against
   `bault_restore` as `bault_app`.

5. **Clean up.** Drop the restore database or container, then
   `shred -u ./bault-backup.key ./drill/*`.

---

## In a real incident

1. **Stop the worker first**, because it moves money on a schedule. Then stop
   the API: `docker compose stop worker api`. Caddy now answers 502, which is
   correct.
2. **Choose T:** just before the damage. A bad deploy has its time in the
   deploy run and in `CURRENT_TAG`'s mtime; for a bad statement, look in the
   provider's logs.
3. **Restore to a NEW cluster** (Drill 1, steps 3 to 5). Keep the damaged one
   untouched until the incident is closed: it is the evidence. If PITR is
   unavailable, restore the last nightly dump (Drill 2) or the pre-migration
   dump `deploy.sh` took, and accept the larger window.
4. **Point the release at it:** update the URLs in `/etc/bault/api.env`,
   `/etc/bault/worker.env` and `/etc/bault/migrate.env`, which is where they
   live (each service's own role, so change the host and keep the user), and in
   `/etc/bault/backup.env`, or the next nightly dump is of the damaged cluster.
   If `api.env` names a pooler, point the pooler at the new cluster instead.
   Re-run `roles.sql` without passwords (it only re-asserts grants), then
   `docker compose up -d api` and `readyz`. Start the worker last, once the API
   is ready.
5. **Reconcile what happened outside the database after T.** PayPal captures and
   payouts, and EasyPost labels bought, are real and are not in the restored
   ledger. List them from each provider's dashboard for the window between T
   and the stop, and record each one through the admin flows as a compensating
   entry. Never write to the history tables by hand: the triggers refuse, and
   they are right to.
6. Write it up in the log below, with the window lost.

---

## Log

One block per drill or incident, newest first. All times in UTC. Elapsed times
are measured from "Started".

```
Date / operator:                 ____ / ____
Kind:                            PITR drill | dump drill | INCIDENT
Target T, or dump file:          ____
Deployed tag:                    ____
Started:                         ____
Restore requested:               ____
Database accepting connections:  ____   (elapsed ____ min)
verify finished (exit 0/1):      ____   (elapsed ____ min)
API readyz 200:                  ____   (elapsed ____ min)   <- recovery time
Data window lost:                ____   (T to incident, or dump time to incident)
Row counts  user_account / item / custody_event / bin_transfer / ledger_record / parcel:
                                 ____ / ____ / ____ / ____ / ____ / ____
Witness rows (PITR):             before T present? ____   after T absent? ____
Problems, and what was changed because of them:
                                 ____
```

### Reference: local proof, 2026-10-15, development data

Not a drill and not a timing for production: one development database of 251
rows, so only the commands are representative.

- `backup.sh dump` produced a 136K dump and `verify` exited 0.
- `verify` exited 1 on a copy with an orphan ledger row and an item in a missing bin, on a copy that had lost one append-only trigger, and on a byte-flipped copy (checksum mismatch).
- `verify` exited 0 on a copy holding an `EXT:` bin location (N1). The previous script failed there with `invalid input syntax for type uuid`.
- `restore` into an empty database took 0.75s, and the row counts matched the source in all 50 tables.
- An age-encrypted dump verified with the right key and was refused without a key and with the wrong one.
