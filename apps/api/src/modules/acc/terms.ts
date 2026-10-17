/**
 * The version of the legal terms a new account agrees to.
 *
 * One string covers the three documents shown together at sign-up (the Terms
 * of Service, the Privacy Policy and the Cookie notice), because they are
 * accepted together, by one checkbox, and a dispute later needs to know exactly
 * which text was on the screen.
 *
 * `AuthService.register` refuses any OTHER version, not just a missing one. A
 * sign-up page loaded before the terms changed would otherwise record consent
 * to text the person never saw. The SPA carries the same string in
 * `apps/web/src/areas/customer/help/legalContent.ts` (`TERMS_VERSION`), and
 * `tests/web/faq-legal.test.ts` fails if the two ever disagree.
 *
 * The `-draft-` in it is literal. These documents were written from the code by
 * an engineer and have not been reviewed by a lawyer; publishing a reviewed text
 * means a new version here and in the SPA, in the same change.
 *
 * Pure data: it talks to nothing, so the web suite can import it directly.
 */
export const CURRENT_TERMS_VERSION = '2026-10-draft-1';
