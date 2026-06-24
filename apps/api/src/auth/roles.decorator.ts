import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@saha/contracts';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more user roles (enforced by RolesGuard). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
