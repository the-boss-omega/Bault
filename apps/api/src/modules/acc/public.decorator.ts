import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as public (no session required), such as registration, login,
 * email verification, password reset and public marketplace browsing.
 * Read by SessionAuthGuard.
 */
export const IS_PUBLIC_KEY = 'is_public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
