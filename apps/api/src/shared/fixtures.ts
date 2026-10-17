/**
 * The reserved identity space for automated-test accounts.
 *
 * The e2e suites drive the real HTTP stack against a real database, so they
 * create real `user_account` rows. Those rows live in their own domain, apart
 * from the seeded personas at `bault.dev`. `.test` is reserved by RFC 2606 and
 * can never be registered, so this can never collide with a real customer
 * address, and the exclusion in `AdmService.listUsers` can be an exact domain
 * match.
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
