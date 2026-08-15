import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	const customerAuth = {
		findAuthStateById: vi.fn(),
	};
	const adminAuth = {
		findAuthStateById: vi.fn(),
	};
	const sessions = {
		findLiveById: vi.fn(),
	};
	/**
	 * No assignments by default, which is the state every existing account is in. That is what
	 * makes these suites assert the EQUIVALENCE: with nothing assigned, the guard must behave
	 * exactly as it did before assignments existed.
	 */
	const roles = {
		findById: vi.fn(),
	};
	const assignments = {
		// Typed explicitly: `async () => []` infers `never[]`, so a mocked assignment would
		// fail typecheck while vitest ran it happily.
		listActiveForUser: vi.fn(async (): Promise<unknown[]> => []),
	};

	const liveSession = {
		id: 'sess_a',
		userId: 'cus_a',
		audience: 'storefront',
		revokedAt: null,
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	};

	const guardWith = () =>
		new SessionGuard(
			reflector,
			config,
			auth as never,
			customerAuth as never,
			adminAuth as never,
			roles as never,
			assignments as never,
			sessions as unknown as SessionService,
		);

	beforeEach(() => {
		vi.clearAllMocks();
		auth.verifyToken.mockResolvedValue({
			sub: 'cus_a',
			sid: 'sess_a',
			aud: 'storefront',
			tokenVersion: 1,
			permissionsVersion: 0,
		});
		customerAuth.findAuthStateById.mockResolvedValue({
			id: 'cus_a',
			status: 'active',
			tokenVersion: 1,
		});
	});

	it('accepts a live session matching the access-token sid/user/audience', async () => {
		sessions.findLiveById.mockResolvedValue(liveSession);
		const guard = guardWith();

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).resolves.toBe(true);
		expect(sessions.findLiveById).toHaveBeenCalledWith('sess_a', { userId: 'cus_a', audience: 'storefront' });
	});

	it('rejects immediately when the AuthSession is missing', async () => {
		sessions.findLiveById.mockResolvedValue(null);
		const guard = guardWith();

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(UnauthorizedException);
		expect(customerAuth.findAuthStateById).not.toHaveBeenCalled();
	});

	it('rejects a revoked session without bumping tokenVersion', async () => {
		sessions.findLiveById.mockResolvedValue(null);
		const guard = guardWith();

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(
			'Session is no longer valid',
		);
		expect(customerAuth.findAuthStateById).not.toHaveBeenCalled();
	});

	it('rejects sid/user/audience mismatch (findLiveById returns null)', async () => {
		sessions.findLiveById.mockImplementation(async (_id, expected) => {
			expect(expected).toEqual({ userId: 'cus_a', audience: 'storefront' });
			return null;
		});
		const guard = guardWith();

		await expect(guard.canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(UnauthorizedException);
	});

	/**
	 * Each refusal site carries the reason a client needs to choose between rotating the
	 * access cookie and giving up. Pinned per site because the useful distinction is exactly
	 * "expired, so try rotating" versus "revoked, so stop" — collapsing the two would either
	 * sign people out mid-session or spin an anonymous visitor through a refresh per request.
	 */
	describe('refusal reasons', () => {
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
			customerAuth.findAuthStateById.mockResolvedValue({
				id: 'cus_a',
				status: 'active',
				tokenVersion: 2,
			});
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('session_revoked');
		});

		it('reports permissions_changed for a stale permissionsVersion on admin sessions', async () => {
			sessions.findLiveById.mockResolvedValue({
				...liveSession,
				userId: 'adm_a',
				audience: 'admin',
			});
			auth.verifyToken.mockResolvedValue({
				sub: 'adm_a',
				sid: 'sess_a',
				aud: 'admin',
				tokenVersion: 1,
				permissionsVersion: 1,
			});
			adminAuth.findAuthStateById.mockResolvedValue({
				id: 'adm_a',
				status: 'active',
				role: 'staff',
				permissions: [],
				tokenVersion: 1,
				permissionsVersion: 9,
			});
			expect(await reasonFrom({ [names.access]: 'jwt' })).toBe('permissions_changed');
		});

		it('reports account_inactive when the account is suspended', async () => {
			sessions.findLiveById.mockResolvedValue(liveSession);
			customerAuth.findAuthStateById.mockResolvedValue({
				id: 'cus_a',
				status: 'disabled',
				tokenVersion: 1,
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

	/**
	 * Effective permissions (auth pass 5c.2). Two sources exist during the migration from
	 * embedded grants to explicit assignments, and the union is what makes introducing
	 * assignments incapable of taking access away.
	 */
	describe('effective permissions', () => {
		const PERMISSION_KEY = 'auth:permissions';

		/** Makes the route demand a permission; everything else stays unrequired. */
		const requiring = (...permissions: string[]) => {
			(reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
				key === PERMISSION_KEY ? permissions : undefined,
			);
		};

		const staffUser = (permissions: string[]) => ({
			id: 'adm_a',
			status: 'active',
			role: 'staff',
			permissions,
			tokenVersion: 1,
			permissionsVersion: 1,
		});

		beforeEach(() => {
			sessions.findLiveById.mockResolvedValue({
				...liveSession,
				userId: 'adm_a',
				audience: 'admin',
			});
			auth.verifyToken.mockResolvedValue({
				sub: 'adm_a',
				sid: 'sess_a',
				aud: 'admin',
				tokenVersion: 1,
				permissionsVersion: 1,
			});
			assignments.listActiveForUser.mockResolvedValue([]);
		});

		afterEach(() => {
			(reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
		});

		/**
		 * The cost claim. No route requires a permission today, so the common path must not
		 * have grown two queries — the resolution is conditional, not eager.
		 */
		it('does not touch roles or assignments when no permission is required', async () => {
			customerAuth.findAuthStateById.mockResolvedValue(undefined);
			adminAuth.findAuthStateById.mockResolvedValue(staffUser(['admin_user.index']));

			await expect(guardWith().canActivate(contextFor({ [names.access]: 'jwt' }))).resolves.toBe(true);

			expect(assignments.listActiveForUser).not.toHaveBeenCalled();
			expect(roles.findById).not.toHaveBeenCalled();
		});

		/** Equivalence: with nothing assigned, the embedded grants decide exactly as before. */
		it('honours an embedded grant with no assignments at all', async () => {
			adminAuth.findAuthStateById.mockResolvedValue(staffUser(['admin_user.index']));
			requiring('admin_user.index');

			await expect(guardWith().canActivate(contextFor({ [names.access]: 'jwt' }))).resolves.toBe(true);
		});

		it('refuses when neither source grants the permission', async () => {
			adminAuth.findAuthStateById.mockResolvedValue(staffUser([]));
			requiring('admin_user.index');

			await expect(guardWith().canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(
				'Insufficient permissions',
			);
		});

		it('honours a permission that only an active assignment grants', async () => {
			adminAuth.findAuthStateById.mockResolvedValue(staffUser([]));
			assignments.listActiveForUser.mockResolvedValue([
				{ id: 'ura_1', userId: 'adm_a', roleId: 'r1', revokedAt: null },
			]);
			roles.findById.mockResolvedValue({ id: 'r1', baseRole: 'staff', permissions: ['admin_user.index'] });
			requiring('admin_user.index');

			await expect(guardWith().canActivate(contextFor({ [names.access]: 'jwt' }))).resolves.toBe(true);
		});

		/**
		 * The escalation guard, at the layer that enforces it. A surviving admin-tier
		 * assignment must not hand a demoted operator their old authority back.
		 */
		it('refuses a permission from a role above the holder’s tier', async () => {
			adminAuth.findAuthStateById.mockResolvedValue(staffUser([]));
			assignments.listActiveForUser.mockResolvedValue([
				{ id: 'ura_1', userId: 'adm_a', roleId: 'r1', revokedAt: null },
			]);
			roles.findById.mockResolvedValue({ id: 'r1', baseRole: 'admin', permissions: ['role.destroy'] });
			requiring('role.destroy');

			await expect(guardWith().canActivate(contextFor({ [names.access]: 'jwt' }))).rejects.toThrow(
				'Insufficient permissions',
			);
		});

		it('survives an assignment whose role has been deleted', async () => {
			adminAuth.findAuthStateById.mockResolvedValue(staffUser(['admin_user.index']));
			assignments.listActiveForUser.mockResolvedValue([
				{ id: 'ura_1', userId: 'adm_a', roleId: 'gone', revokedAt: null },
			]);
			roles.findById.mockResolvedValue(null);
			requiring('admin_user.index');

			await expect(guardWith().canActivate(contextFor({ [names.access]: 'jwt' }))).resolves.toBe(true);
		});
	});
});
