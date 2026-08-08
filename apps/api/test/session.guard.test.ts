import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionRefusal } from '../src/auth/session-refusal';
import { AUDIENCE_KEY, SessionGuard } from '../src/auth/session.guard';
import type { SessionService } from '../src/auth/session.service';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
});
const names = cookieNames(config);

const contextFor = (cookies: Record<string, string>) =>
	({
		getHandler: () => ({}),
		getClass: () => ({}),
		switchToHttp: () => ({
			getRequest: () => ({ cookies, headers: {} }),
		}),
	}) as unknown as ExecutionContext;

describe('SessionGuard — AuthSession sid binding', () => {
	const reflector = {
		getAllAndOverride: vi.fn(() => undefined),
	} as unknown as Reflector;

	const auth = {
		verifyToken: vi.fn(),
	};
	const authUsers = {
		findAuthStateById: vi.fn(),
	};
	const sessions = {
		findLiveById: vi.fn(),
	};

	const liveSession = {
		id: 'sess_a',
		userId: 'user_a',
		audience: 'storefront',
		revokedAt: null,
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		auth.verifyToken.mockResolvedValue({
			sub: 'user_a',
			sid: 'sess_a',
			aud: 'storefront',
			tokenVersion: 1,
			permissionsVersion: 1,
		});
		authUsers.findAuthStateById.mockResolvedValue({
			id: 'user_a',
			status: 'active',
			role: 'customer',
			permissions: [],
			tokenVersion: 1,
			permissionsVersion: 1,
		});
	});

	it('accepts a live session matching the access-token sid/user/audience', async () => {
		sessions.findLiveById.mockResolvedValue(liveSession);
		const guard = new SessionGuard(
			reflector,
			config,
			auth as never,
			authUsers as never,
			sessions as unknown as SessionService,
		);

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).resolves.toBe(true);
		expect(sessions.findLiveById).toHaveBeenCalledWith('sess_a', { userId: 'user_a', audience: 'storefront' });
	});

	it('rejects immediately when the AuthSession is missing', async () => {
		sessions.findLiveById.mockResolvedValue(null);
		const guard = new SessionGuard(
			reflector,
			config,
			auth as never,
			authUsers as never,
			sessions as unknown as SessionService,
		);

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(UnauthorizedException);
		expect(authUsers.findAuthStateById).not.toHaveBeenCalled();
	});

	it('rejects a revoked session without bumping tokenVersion', async () => {
		sessions.findLiveById.mockResolvedValue(null);
		const guard = new SessionGuard(
			reflector,
			config,
			auth as never,
			authUsers as never,
			sessions as unknown as SessionService,
		);

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(
			'Session is no longer valid',
		);
		expect(authUsers.findAuthStateById).not.toHaveBeenCalled();
	});

	it('rejects sid/user/audience mismatch (findLiveById returns null)', async () => {
		sessions.findLiveById.mockImplementation(async (_id, expected) => {
			expect(expected).toEqual({ userId: 'user_a', audience: 'storefront' });
			return null;
		});
		const guard = new SessionGuard(
			reflector,
			config,
			auth as never,
			authUsers as never,
			sessions as unknown as SessionService,
		);

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(UnauthorizedException);
	});

	/**
	 * Each refusal site carries the reason a client needs to choose between rotating the
	 * access cookie and giving up. Pinned per site because the useful distinction is exactly
	 * "expired, so try rotating" versus "revoked, so stop" — collapsing the two would either
	 * sign people out mid-session or spin an anonymous visitor through a refresh per request.
	 */
	describe('refusal reasons', () => {
		const guardWith = () =>
			new SessionGuard(
				reflector,
				config,
				auth as never,
				authUsers as never,
				sessions as unknown as SessionService,
			);

		const reasonFrom = async (cookies: Record<string, string>) => {
			try {
				await guardWith().canActivate(contextFor(cookies));
				return 'no-throw';
			} catch (error) {
				return (error as SessionRefusal).reason;
			}
		};

		it('reports session_missing when no access cookie is presented', async () => {
			expect(await reasonFrom({})).toBe('session_missing');
		});

		it('reports session_expired when the access cookie will not verify', async () => {
			auth.verifyToken.mockRejectedValue(new Error('expired'));
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('session_expired');
		});

		it('reports session_revoked when the session is no longer live', async () => {
			sessions.findLiveById.mockResolvedValue(null);
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('session_revoked');
		});

		it('reports session_revoked for a stale tokenVersion', async () => {
			sessions.findLiveById.mockResolvedValue(liveSession);
			authUsers.findAuthStateById.mockResolvedValue({
				id: 'user_a',
				status: 'active',
				role: 'customer',
				permissions: [],
				tokenVersion: 2,
				permissionsVersion: 1,
			});
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('session_revoked');
		});

		it('reports permissions_changed for a stale permissionsVersion', async () => {
			sessions.findLiveById.mockResolvedValue(liveSession);
			authUsers.findAuthStateById.mockResolvedValue({
				id: 'user_a',
				status: 'active',
				role: 'customer',
				permissions: [],
				tokenVersion: 1,
				permissionsVersion: 9,
			});
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('permissions_changed');
		});

		it('reports account_inactive when the account is suspended', async () => {
			sessions.findLiveById.mockResolvedValue(liveSession);
			authUsers.findAuthStateById.mockResolvedValue({
				id: 'user_a',
				status: 'suspended',
				role: 'customer',
				permissions: [],
				tokenVersion: 1,
				permissionsVersion: 1,
			});
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('account_inactive');
		});

		/**
		 * The audience boundary must stay invisible. An admin cookie probing a storefront
		 * surface has to be answered exactly as if no cookie were sent at all, or the reason
		 * itself becomes the probe that the audience check exists to prevent.
		 */
		it('reports session_missing — not a distinct reason — for a foreign audience', async () => {
			sessions.findLiveById.mockResolvedValue(liveSession);
			(reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
				key === AUDIENCE_KEY ? 'admin' : undefined,
			);

			const foreign = await reasonFrom({ [names.access]: 'jwt' });
			(reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);

			expect(foreign).toBe('session_missing');
			expect(foreign).toBe(await reasonFrom({}));
		});
	});
});
