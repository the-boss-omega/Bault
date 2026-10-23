export const FIXTURE_EMAIL_DOMAIN = 'fixture.bault.test';

export function isFixtureEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${FIXTURE_EMAIL_DOMAIN}`);
}
