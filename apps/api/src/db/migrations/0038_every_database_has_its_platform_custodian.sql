-- 0038 — Every database has its platform custodian.
--
-- The house store, donations, buyouts, consignments and the accounting summary
-- find the platform's own account by its email, and only the seed created it,
-- so a production database failed every one of them with "Platform custodian
-- account not seeded". The row is fixed and holds no secret, so it belongs in a
-- migration. Running this on a database that already has the account changes
-- nothing, and the seed truncates user_account and writes the same row itself.
--
-- The account never signs in, and nothing that uses it reads its role or
-- status. It is a plain user, so it is never counted as staff. It is closed, so
-- a sign-in is refused, no password reset is mailed and no notification is
-- emailed: Bault does not hold the bault.dev domain, so mail to
-- platform@bault.dev would reach whoever registers it. The password hash is a
-- well-formed argon2id digest of zero bytes, so a sign-in attempt fails as a
-- wrong password instead of an error, and no password is known to produce it.
INSERT INTO "user_account" ("email", "username", "password_hash", "status", "role", "first_name", "last_name")
VALUES (
  'platform@bault.dev',
  'platform',
  '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'closed',
  'user',
  'Platform',
  'Custodian'
)
ON CONFLICT ("email") DO NOTHING;
