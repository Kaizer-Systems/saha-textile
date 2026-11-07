import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	SetMetadata,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SessionService } from './session.service';

export const ROTATES_SESSION_KEY = 'rotatesSession';

/**
 * Marks a handler that consumes a refresh token, so `RefreshReuseGuard` inspects it.
 *
 * Opt-in rather than global because the check costs a database lookup: running it on every
 * request that merely carries a session cookie would add one to the hot path of the whole
 * API to protect two routes.
 */
export const RotatesSession = () => SetMetadata(ROTATES_SESSION_KEY, true);

/**
 * Detects a replayed refresh token before anything else can reject the request.
 *
 * Registered ahead of `CsrfGuard`, and the ordering is the point. Reuse detection used to
 * live inside the refresh use case, which runs after CSRF — so an attacker presenting a
 * stolen refresh cookie WITHOUT a matching CSRF token was refused with a 403 and the
 * refresh family was never revoked. The block held; the alarm never sounded, the legitimate
 * session kept working, and no security event was recorded. That is the wrong response to
 * the one signal that unambiguously means a token has leaked.
 *
 * The guard is deliberately narrow: it returns immediately unless the handler is marked
 * `@RotatesSession()`, so it adds nothing to any other route.
 */
@Injectable()
export class RefreshReuseGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly sessions: SessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const rotates = this.reflector.getAllAndOverride<boolean>(ROTATES_SESSION_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (!rotates) return true;

		const http = context.switchToHttp();
		const request = http.getRequest<FastifyRequest>();
		const reply = http.getResponse<FastifyReply>();

		if (await this.sessions.revokeFamilyIfRefreshReused(request, reply)) {
			// Deliberately the same generic message the rest of the auth surface uses. The
			// caller learns their session is gone, not that they tripped reuse detection.
			throw new UnauthorizedException('Session revoked');
		}

		return true;
	}
}
