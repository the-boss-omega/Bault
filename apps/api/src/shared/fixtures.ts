/**
 * The reserved identity space for automated-test accounts.
 *
 * The e2e suites drive the real HTTP stack against a real database, so they
 * create real `user_account` rows. Those rows used to be minted at `bault.dev`,
 * which is also where the seeded personas live, so every test run left a
 * customer-shaped account behind in the Management > Users table with nothing to
 * mark it as machinery.
 *
 * Fixtures now live in their own domain instead. `.test` is reserved by
 * RFC 2606 and can never be registered, so this can never collide with a real
 * customer address, and the exclusion in `AdmService.listUsers` can be an exact
 * domain match rather than a guess at what "looks like" a test account.
 *
 * Keep this in step with `tests/integration/helpers/http.ts`, which mints the
 * addresses; the two are matched by value on purpose so the API carries no
 * dependency on the test tree.
 */
export const FIXTURE_EMAIL_DOMAIN = 'fixture.bault.test';

/** Whether an address belongs to the fixture space. Exact domain, not a substring. */
export function isFixtureEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${FIXTURE_EMAIL_DOMAIN}`);
}
