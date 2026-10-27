// Creates the first administrator of a new database. Nothing about the account
// is in the repository: the email, username and names are arguments, and the
// password is the first line of standard input, so it is in neither the shell
// history nor the process list. It refuses, and writes nothing, once an
// administrator other than the platform custodian exists; further
// administrators are made from the console.
//
//   read -rs ADMIN_PASSWORD
//   printf '%s\n' "$ADMIN_PASSWORD" | node dist/db/create-admin.js \
//     --email you@example.com --username you --first-name Ada --last-name Lovelace
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import * as argon2 from 'argon2';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { userAccount } from '../modules/acc/acc.schema';
import { isValidNamePart, isValidUsername, normalizeNamePart, normalizeUsername } from '../shared/names';

const PLATFORM_EMAIL = 'platform@bault.dev';
// Longer than the 8 a collector needs: this account can move money.
const PASSWORD_MIN = 12;

class Refusal extends Error {}

async function readInput() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      username: { type: 'string' },
      'first-name': { type: 'string' },
      'last-name': { type: 'string' },
    },
  });

  const email = (values.email ?? '').trim().toLowerCase();
  const username = normalizeUsername(values.username ?? '');
  const firstName = normalizeNamePart(values['first-name'] ?? '');
  const lastName = normalizeNamePart(values['last-name'] ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refusal('--email is missing or not an email address.');
  if (!isValidUsername(username)) {
    throw new Refusal('--username must be 3-32 characters of letters, digits, dot, dash or underscore.');
  }
  if (!isValidNamePart(firstName) || !isValidNamePart(lastName)) {
    throw new Refusal('--first-name and --last-name are both required.');
  }

  if (process.stdin.isTTY) {
    throw new Refusal(
      'give the password on standard input, not typed here where it shows: read -rs ADMIN_PASSWORD, then printf \'%s\\n\' "$ADMIN_PASSWORD" | <this command>.',
    );
  }
  const password = (await text(process.stdin)).split(/\r?\n/)[0] ?? '';
  if (password.length < PASSWORD_MIN) {
    throw new Refusal(`the password on standard input is shorter than ${PASSWORD_MIN} characters.`);
  }

  return { email, username, firstName, lastName, password };
}

async function main(): Promise<void> {
  const input = await readInput();
  const passwordHash = await argon2.hash(input.password);

  const pool = new Pool({ connectionString: loadEnv().DIRECT_DATABASE_URL });
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      // Two runs at once would each find no administrator and both insert.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bault:create-admin'))`);

      const admins = await tx
        .select({ email: userAccount.email, username: userAccount.username })
        .from(userAccount)
        .where(and(eq(userAccount.role, 'admin'), ne(userAccount.email, PLATFORM_EMAIL)));
      if (admins.length > 0) {
        const named = admins.map((a) => `${a.username} <${a.email}>`).join(', ');
        throw new Refusal(`an administrator already exists: ${named}. Add more from the console.`);
      }

      const [taken] = await tx
        .select({ email: userAccount.email, username: userAccount.username })
        .from(userAccount)
        .where(or(eq(userAccount.email, input.email), eq(userAccount.username, input.username)))
        .limit(1);
      if (taken) throw new Refusal(`${taken.username} <${taken.email}> already has that email or username.`);

      await tx.insert(userAccount).values({
        email: input.email,
        username: input.username,
        passwordHash,
        status: 'active',
        role: 'admin',
        firstName: input.firstName,
        lastName: input.lastName,
      });
    });
  } finally {
    await pool.end();
  }

  console.log(`✔ administrator ${input.username} <${input.email}> created; two-factor is set up at the first sign-in`);
}

main().catch((err) => {
  if (err instanceof Refusal) {
    console.error(`Refusing to create an administrator: ${err.message}`);
  } else {
    console.error('create-admin failed', err);
  }
  process.exit(1);
});
