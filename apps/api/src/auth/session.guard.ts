import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Inject,
	Injectable,
	SetMetadata,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionAudience, UserRole } from '@saha-textile/contracts';
import type { AuthPort, AuthUserRepository } from '@saha-textile/core-domain';
import type { FastifyRequest } from 'fastify';

import { cookieNames } from '../common/cookies';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AUTH_PORT, AUTH_USER_REPOSITORY } from '../infra/tokens';

export const PUBLIC_ROUTE_KEY = 'auth:public';
export const AUDIENCE_KEY = 'auth:audience';
export const ROLES_KEY_V2 = 'auth:roles';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Marks a route as reachable without a session. */
export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);

/** Restricts a route to one browser audience. Admin cookies must never drive storefront flows. */
export const Audience = (audience: SessionAudience) => SetMetadata(AUDIENCE_KEY, audience);

export const RequireRoles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY_V2, roles);

export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** What the guard attaches to the request for downstream handlers. */
export interface AuthenticatedPrincipal {
	userId: string;
	sessionId: string;
	audience: SessionAudience;
	role: UserRole;
	permissions: string[];
}

/** `@fastify/cookie` adds `cookies`; the session guard adds `principal`. */
export type RequestWithPrincipal = FastifyRequest & {
	principal?: AuthenticatedPrincipal;
	cookies?: Record<string, string>;
};

/**
 * Cookie-session authentication.
 *
 * The access token is a short-lived JWT read from an httpOnly cookie — never from a
 * request body and never from a browser-supplied Authorization header. It carries
 * `tokenVersion` and `permissionsVersion`, which are compared against the user's CURRENT
 * values: that is what makes a password change, a role change, or reuse detection take
 * effect immediately instead of waiting for the token to expire.
 *
 * The audience check is the isolation the owner lock requires — an admin session cookie
 * cannot authorize a storefront-only route, and vice versa, even for the same person.
 */
@Injectable()
export class SessionGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(AUTH_PORT) private readonly auth: AuthPort,
		@Inject(AUTH_USER_REPOSITORY) private readonly authUsers: AuthUserRepository,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) return true;

		const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
		const token = request.cookies?.[cookieNames(this.config).access];
		if (!token) throw new UnauthorizedException('Authentication required');

		let claims: Record<string, unknown>;
		try {
			claims = (await this.auth.verifyToken(token)) as unknown as Record<string, unknown>;
		} catch {
			throw new UnauthorizedException('Invalid or expired session');
		}

		const userId = String(claims.sub ?? '');
		const sessionId = String(claims.sid ?? '');
		const audience = claims.aud as SessionAudience | undefined;
		if (!userId || !sessionId || !audience) throw new UnauthorizedException('Malformed session');

		const requiredAudience = this.reflector.getAllAndOverride<SessionAudience | undefined>(AUDIENCE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (requiredAudience && audience !== requiredAudience) {
			// Not a 403: to this surface the session simply does not exist.
			throw new UnauthorizedException('Authentication required');
		}

		const user = await this.authUsers.findAuthStateById(userId);
		if (!user || user.status !== 'active') throw new UnauthorizedException('Account is not active');

		// Stale-token rejection. A bumped counter invalidates every token minted before it.
		if (Number(claims.tokenVersion ?? -1) !== user.tokenVersion) {
			throw new UnauthorizedException('Session is no longer valid');
		}
		if (Number(claims.permissionsVersion ?? -1) !== user.permissionsVersion) {
			throw new UnauthorizedException('Permissions changed; re-authentication required');
		}

		const principal: AuthenticatedPrincipal = {
			userId,
			sessionId,
			audience,
			role: user.role,
			permissions: user.permissions,
		};
		request.principal = principal;

		const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY_V2, [
			context.getHandler(),
			context.getClass(),
		]);
		if (requiredRoles?.length && !requiredRoles.includes(principal.role)) {
			throw new ForbiddenException('Insufficient role');
		}

		const requiredPermissions = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (requiredPermissions?.length) {
			const missing = requiredPermissions.filter((permission) => !principal.permissions.includes(permission));
			// An admin role does not imply every permission — the grant list is authoritative.
			if (missing.length > 0) throw new ForbiddenException('Insufficient permissions');
		}

		return true;
	}
}
