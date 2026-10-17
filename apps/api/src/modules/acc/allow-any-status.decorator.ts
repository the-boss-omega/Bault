import { SetMetadata } from '@nestjs/common';

/**
 * Marks the one route an account may reach WHATEVER its status: signing out.
 *
 * `SessionAuthGuard` refuses every request from an account that is not active,
 * and that used to include `POST /auth/logout`: a suspended account could not
 * end its session, and a closed one kept a live session until its cookie
 * expired. Signing out only ends the session the request presents and grants
 * nothing, so it is the one action every status may take.
 *
 * Not for any other route. Anything that reads or changes the account belongs
 * behind `@AllowSuspended()` at most, and `closed` never gets that far.
 */
export const ALLOW_ANY_STATUS_KEY = 'allow_any_status';
export const AllowAnyStatus = () => SetMetadata(ALLOW_ANY_STATUS_KEY, true);
