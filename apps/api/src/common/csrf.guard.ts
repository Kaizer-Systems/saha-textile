import { timingSafeEqual } from 'node:crypto';

import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { SessionService } from '../auth/session.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { cookieNames } from './cookies';

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
 * also echo a value only same-origin script can read — the CSRF cookie — in a header.
 * A cross-site page can make the browser send cookies, but the same-origin policy stops
 * it reading one, so it cannot produce the header.
 *
 * Enforced only when a SESSION cookie is present: a request with no session has nothing
 * to forge, and requiring a token there would break legitimate public reads and the
 * approved non-browser clients that use bearer auth (which are immune by construction,
 * because a browser never attaches an Authorization header on its own).
 *
 * `SameSite=lax` on the session cookie is the first line of defence; this is the second.
 * Neither is trusted alone.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		private readonly sessions: SessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<FastifyRequest & { cookies?: Record<string, string> }>();

		if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

		const names = cookieNames(this.config);
		const cookies = request.cookies ?? {};
		const hasSession = Boolean(cookies[names.access] ?? cookies[names.refresh]);
		if (!hasSession) return true;

		const cookieToken = cookies[names.csrf];
		const headerValue = request.headers[this.config.cookies.csrfHeader.toLowerCase()];
		const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

		if (!cookieToken || !headerToken || !safeEquals(cookieToken, headerToken)) {
			// Deliberately generic: naming which half was wrong tells an attacker where to aim.
			throw new ForbiddenException('CSRF validation failed');
		}

		/**
		 * Second stage: the token must belong to THIS session.
		 *
		 * Cookie/header agreement alone stops cross-site forgery but not a token lifted
		 * from another session and replayed with stolen session cookies. `csrfSecretHash`
		 * is stored per session precisely so that pairing can be checked.
		 */
		const session = await this.sessions.findByRefreshCookie(request);
		if (session && !this.sessions.verifyCsrfForSession(session, cookieToken)) {
			throw new ForbiddenException('CSRF validation failed');
		}

		return true;
	}
}
