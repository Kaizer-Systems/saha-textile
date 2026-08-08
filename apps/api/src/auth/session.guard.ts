import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Inject,
	Injectable,
	SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionAudience, UserRole } from '@saha-textile/contracts';
import type { AuthPort, AuthUserRepository } from '@saha-textile/core-domain';
import type { FastifyRequest } from 'fastify';

import { cookieNames } from '../common/cookies';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AUTH_PORT, AUTH_USER_REPOSITORY } from '../infra/tokens';
import { SessionRefusal } from './session-refusal';
import { SessionService } from './session.service';

export const PUBLIC_ROUTE_KEY = 'auth:public';
export const AUDIENCE_KEY = 'auth:audience';
export const ROLES_KEY = 'auth:roles';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Marks a route as reachable without a session. */
export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);

/** Restricts a route to one browser audience. Admin cookies must never drive storefront flows. */
export const Audience = (audience: SessionAudience) => SetMetadata(AUDIENCE_KEY, audience);

export const RequireRoles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

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
 * values so a password change or role change invalidates every token immediately.
 *
 * Logout and refresh-family revocation do NOT bump `tokenVersion` (that would kill every
 * other device). Instead this guard loads the AuthSession identified by JWT `sid` and
 * fail-closes when the session is missing, revoked, expired, or identity-mismatched —
 * so reuse revocation and single-session logout take effect immediately.
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
		private readonly sessions: SessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
		const token = request.cookies?.[cookieNames(this.config).access];

		// Public routes remain reachable anonymously, but when an access cookie IS present
		// we still resolve the principal so ownership checks (cart, consent) can bind to it.
		if (!token) {
			if (isPublic) return true;
			throw new SessionRefusal('session_missing', 'Authentication required');
		}

		let claims: Record<string, unknown>;
		try {
			claims = (await this.auth.verifyToken(token)) as unknown as Record<string, unknown>;
		} catch {
			if (isPublic) return true;
			throw new SessionRefusal('session_expired', 'Invalid or expired session');
		}

		const userId = String(claims.sub ?? '');
		const sessionId = String(claims.sid ?? '');
		const audience = claims.aud as SessionAudience | undefined;
		if (!userId || !sessionId || !audience) {
			if (isPublic) return true;
			throw new SessionRefusal('session_expired', 'Malformed session');
		}

		const requiredAudience = this.reflector.getAllAndOverride<SessionAudience | undefined>(AUDIENCE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (requiredAudience && audience !== requiredAudience) {
			if (isPublic) return true;
			// Not a 403, and deliberately the SAME refusal as presenting no cookie at all: an
			// admin session must not be able to detect that a storefront surface exists, or
			// vice versa. Giving this its own reason would rebuild exactly that probe.
			throw new SessionRefusal('session_missing', 'Authentication required');
		}

		const session = await this.sessions.findLiveById(sessionId, { userId, audience });
		if (!session) {
			if (isPublic) return true;
			throw new SessionRefusal('session_revoked', 'Session is no longer valid');
		}

		const user = await this.authUsers.findAuthStateById(userId);
		if (!user || user.status !== 'active') {
			if (isPublic) return true;
			throw new SessionRefusal('account_inactive', 'Account is not active');
		}

		// Stale-token rejection. A bumped counter invalidates every token minted before it.
		if (Number(claims.tokenVersion ?? -1) !== user.tokenVersion) {
			if (isPublic) return true;
			throw new SessionRefusal('session_revoked', 'Session is no longer valid');
		}
		if (Number(claims.permissionsVersion ?? -1) !== user.permissionsVersion) {
			if (isPublic) return true;
			throw new SessionRefusal('permissions_changed', 'Permissions changed; re-authentication required');
		}

		const principal: AuthenticatedPrincipal = {
			userId,
			sessionId,
			audience,
			role: user.role,
			permissions: user.permissions,
		};
		request.principal = principal;

		if (isPublic) return true;

		const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
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
