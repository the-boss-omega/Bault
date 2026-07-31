import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as public (no session required): registration, login, email
 * verification, password-reset request/apply, and public marketplace browsing.
 * Read by SessionAuthGuard.
 */
export const IS_PUBLIC_KEY = 'is_public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
