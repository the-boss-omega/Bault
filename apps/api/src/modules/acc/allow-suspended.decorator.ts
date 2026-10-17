import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route a SUSPENDED account may still reach.
 *
 * Suspension normally closes the whole surface: `SessionAuthGuard` rejects every
 * request from a non-active account. But an account suspended automatically for
 * debt cannot sign in, so it cannot cash in to clear the debt; the helpdesk is
 * its way to ask for help.
 *
 * Applied ONLY to the ticket routes and the shell's profile probe
 * (`GET /me/profile`), so a suspended holder can explain themselves and read
 * the answer, and can still do nothing else: no vault, no wallet, no
 * marketplace, no shipping.
 *
 * `closed` is deliberately NOT included: closure is terminal.
 */
export const ALLOW_SUSPENDED_KEY = 'allow_suspended';
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
