import { timingSafeEqual } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { PUBLIC_ROUTE_KEY } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { cookieNames, requestCookieAudience } from './cookies';
import { CsrfRefusal } from './csrf-refusal';

/** Methods that cannot change state, so they need no CSRF proof. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Constant-time comparison so a token cannot be recovered by timing the failures. */
function safeEquals(a: string, b: string): boolean {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

/**
 * Double-submit CSRF enforcement.
 *
 * The attack this stops: a browser attaches our session cookies to a request the USER
 * never intended, triggered from another origin. The defence is that the request must
 * also echo the CSRF token in a header. The app gets that token from the CSRF route's
 * response, which CORS lets only allowlisted origins read. A cross-site page can make the
 * browser send cookies, but it cannot read the response, so it cannot produce the header.
 *
 * Enforced only when a SESSION cookie is present: a request with no session has nothing
 * to forge, and requiring a token there would break legitimate public reads and the
 * approved non-browser clients that use bearer auth (which are immune by construction,
 * because a browser never attaches an Authorization header on its own).
 *
 * `SameSite=lax` on the session cookie is the first line of defence; this is the second.
 * Neither is trusted alone.
 *
 * Fail-closed: when session credentials are present, a live AuthSession MUST resolve and
 * the CSRF token MUST match that session's stored hash. Cookie/header agreement alone is
 * not enough — otherwise a revoked/missing refresh session plus a still-accepted access
 * cookie could forge state changes with any matching double-submit pair.
 *
 * ## Dead cookies on a public route
 *
 * One exception, and it is what keeps a person able to sign in. Session cookies outlive the
 * session they name: the row expires, is revoked, or belongs to another database entirely.
 * Refusing those on login, refresh and recovery wedged the browser. The correct password
 * was answered `403` before it was ever read, and refresh could not clear the cookies
 * because it was refused the same way, so nothing but deleting cookies by hand got the
 * person back in.
 *
 * A `@Public()` route needs no session, and a cookie that resolves to no live session gives
 * the request no authority, so there is nothing to forge. `SessionGuard` reaches the same
 * verdict and treats it as anonymous, and an anonymous request already passes here. Routes
 * that need a session stay fail-closed, and a LIVE session on a public route is still held
 * to the full check.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		private readonly sessions: SessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<FastifyRequest & { cookies?: Record<string, string> }>();

		if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

		const names = cookieNames(this.config, requestCookieAudience(request));
		const cookies = request.cookies ?? {};
		const hasSession = Boolean(cookies[names.access] ?? cookies[names.refresh]);
		if (!hasSession) return true;

		const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		const cookieToken = cookies[names.csrf];
		const headerValue = request.headers[this.config.cookies.csrfHeader.toLowerCase()];
		const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
		const tokensAgree = Boolean(cookieToken && headerToken && safeEquals(cookieToken, headerToken));

		// Deliberately generic: naming which half was wrong tells an attacker where to aim.
		// Only a public route pays for the lookup below when the pair already failed.
		if (!tokensAgree && !isPublic) throw new CsrfRefusal();

		const session = await this.sessions.resolveLiveSessionFromRequest(request);
		if (!session) {
			if (isPublic) return true;
			throw new CsrfRefusal();
		}

		if (!tokensAgree || !this.sessions.verifyCsrfForSession(session, cookieToken as string)) {
			throw new CsrfRefusal();
		}

		return true;
	}
}
