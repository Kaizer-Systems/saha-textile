import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ROTATES_SESSION_KEY, RefreshReuseGuard, RotatesSession } from '../src/auth/refresh-reuse.guard';
import type { SessionService } from '../src/auth/session.service';

/**
 * The guard that makes refresh-token reuse detection independent of CSRF.
 *
 * Reuse detection used to live inside the refresh use case, which runs after `CsrfGuard`.
 * An attacker presenting a stolen refresh cookie without a matching CSRF token was refused
 * with a 403 and the family was never revoked — blocked, but silent: the legitimate session
 * kept working and no security event was recorded. These cases pin the two properties that
 * fixes it, plus the one that keeps it cheap.
 */
function contextFor(handler: () => void): ExecutionContext {
	return {
		getHandler: () => handler,
		getClass: () => class {},
		switchToHttp: () => ({
			getRequest: () => ({ cookies: {} }),
			getResponse: () => ({}),
		}),
	} as unknown as ExecutionContext;
}

/** A handler carrying the marker, as the decorator applies it in a controller. */
function rotatingHandler(): () => void {
	const handler = () => undefined;
	RotatesSession()({}, 'refresh', { value: handler });
	return handler;
}

function guardWith(revokeFamilyIfRefreshReused: () => Promise<boolean>): RefreshReuseGuard {
	return new RefreshReuseGuard(new Reflector(), { revokeFamilyIfRefreshReused } as unknown as SessionService);
}

describe('RefreshReuseGuard', () => {
	it('refuses a request whose refresh token was already rotated away', async () => {
		const guard = guardWith(() => Promise.resolve(true));

		await expect(guard.canActivate(contextFor(rotatingHandler()))).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('allows a rotation whose token is current', async () => {
		const guard = guardWith(() => Promise.resolve(false));

		await expect(guard.canActivate(contextFor(rotatingHandler()))).resolves.toBe(true);
	});

	// The check costs a database lookup. Running it on every request that merely carries a
	// session cookie would put it on the hot path of the whole API to protect two routes.
	it('does not look anything up for a handler that does not rotate a session', async () => {
		const detect = vi.fn(() => Promise.resolve(true));
		const guard = guardWith(detect);

		await expect(guard.canActivate(contextFor(() => undefined))).resolves.toBe(true);
		expect(detect).not.toHaveBeenCalled();
	});

	it('marks a handler through the decorator rather than a hand-written string', () => {
		const handler = rotatingHandler();
		expect(new Reflector().get(ROTATES_SESSION_KEY, handler)).toBe(true);
	});
});
