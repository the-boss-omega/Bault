/**
 * The seeded accounts, for the sign-in page — IN DEVELOPMENT ONLY.
 *
 * This sentence used to live in the i18n catalogue, and that was the bug. The
 * render site has always been guarded by `import.meta.env.DEV`, so the line was
 * never DISPLAYED in a production build — but the guard only removes the JSX.
 * The catalogue is one big object literal that ships whole, so the string went
 * into the bundle regardless, and anybody who opened devtools on a deployed
 * build could search for "password" and find the shared one, along with the
 * address of the ADMINISTRATOR account.
 *
 * A plain module-level constant referenced only inside a `DEV` branch is a
 * different thing: Vite replaces `import.meta.env.DEV` with `false` at build
 * time, the branch becomes unreachable, and Rollup drops both the branch and
 * this module. `tests/web/no-credentials-in-bundle.test.ts` asserts that it
 * actually happened rather than trusting that it should have.
 *
 * It is NOT translated, deliberately. It is a developer convenience, it names
 * literal email addresses and a literal password, and a translated copy is a
 * second place for the same secret to hide.
 */
export const DEMO_USERS =
  'Demo users (password 11111111): red@bault.dev · golden@bault.dev (collectors) · hermon@bault.dev (warehouse) · eldar@bault.dev (manager)';
