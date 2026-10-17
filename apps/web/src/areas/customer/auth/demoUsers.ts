/**
 * The seeded accounts, for the sign-in page, in development only.
 *
 * Kept out of the i18n catalogue, which is one object literal that ships whole
 * in every bundle. This constant is referenced only inside an
 * `import.meta.env.DEV` branch, which Vite replaces with `false` at build time,
 * so Rollup drops the branch and this module.
 * `tests/web/no-credentials-in-bundle.test.ts` checks the built bundle.
 *
 * Deliberately not translated: it names literal email addresses and a literal
 * password, and a translated copy would be a second place for them to ship.
 */
export const DEMO_USERS =
  'Demo users (password 11111111): red@bault.dev · golden@bault.dev (collectors) · hermon@bault.dev (warehouse) · eldar@bault.dev (manager)';
