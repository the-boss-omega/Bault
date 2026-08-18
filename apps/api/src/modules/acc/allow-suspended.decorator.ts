import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route a SUSPENDED account may still reach.
 *
 * Suspension normally closes the whole surface: `SessionAuthGuard` rejects every
 * request from a non-active account, which is what makes it a real consequence
 * rather than a label.
 *
 * That created a trap the moment suspension became automatic. An account
 * suspended for debt cannot sign in, so it cannot cash in, so it cannot clear
 * the debt that suspended it — recovery depends entirely on somebody else
 * noticing. Bault then had no channel through which to ask them to. The lock had
 * no key on the inside.
 *
 * The helpdesk is that key, and this decorator is what lets it through. It is
 * applied to the ticket routes ONLY, so a suspended holder can explain
 * themselves and read the answer, and can still do nothing else — no vault, no
 * wallet, no marketplace, no shipping.
 *
 * `closed` is deliberately NOT included. Suspension is a state an account is
 * expected to come back from; closure is terminal, and a terminated
 * relationship does not need a message box.
 */
export const ALLOW_SUSPENDED_KEY = 'allow_suspended';
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
