import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionGuard } from '../src/auth/session.guard';
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
});
