import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@saha/contracts';
import type { TokenClaims } from '@saha/core-domain';

import { ROLES_KEY } from './roles.decorator';

/** Enforces @Roles(...) metadata. Must run after JwtAuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (!required || required.length === 0) return true;

		const request = context.switchToHttp().getRequest<{ user?: TokenClaims }>();
		const role = request.user?.role as UserRole | undefined;
		if (!role || !required.includes(role)) {
			throw new ForbiddenException('Insufficient role');
		}
		return true;
	}
}
