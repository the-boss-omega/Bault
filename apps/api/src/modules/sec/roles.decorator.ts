import { SetMetadata } from '@nestjs/common';
import type { Role } from './auth-context';

/** Attach required roles to a route: `@Roles('admin')`. Read by RolesGuard. */
export const ROLES_KEY = 'required_roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
