import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionAudience } from '@saha-textile/contracts';

import { AUDIENCE_KEY } from '../auth/session.guard';
import type { RequestWithCookieAudience } from './cookies';

/**
 * Records which session's cookies a request is about, from the route's `@Audience`, before any
 * other guard reads a cookie. Routes without an audience (catalog, cart, `/auth/csrf`) are
 * storefront routes. Never refuses anything: it only decides which cookie names apply, and the
 * session guard still checks the token's own audience against the route.
 */
@Injectable()
export class CookieAudienceGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const audience = this.reflector.getAllAndOverride<SessionAudience | undefined>(AUDIENCE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		const request = context.switchToHttp().getRequest<RequestWithCookieAudience>();
		request.cookieAudience = audience === 'admin' ? 'admin' : 'storefront';
		return true;
	}
}
