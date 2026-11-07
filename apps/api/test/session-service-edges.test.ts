import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionService } from '../src/auth/session.service';
import { cookieNames } from '../src/common/cookies';

const config = {
	nodeEnv: 'test',
	jwt: { refreshSecret: 'refresh-pepper', accessTtlSeconds: 900 },
	cookies: {
		csrfSecret: 'pepper',
		secure: false,
		domain: undefined,
		accessName: 'st_access',
		refreshName: 'st_refresh',
		csrfName: 'st_csrf',
		guestName: 'st_guest',
		signupName: 'st_signup',
	},
} as never;

const names = cookieNames(config, 'storefront');
const future = '2099-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';

const session = (overrides: Record<string, unknown> = {}) =>
	({
		id: 's1',
		userId: 'cus_1',
		audience: 'storefront',
		refreshFamilyId: 'fam',
		persistent: true,
		revokedAt: null,
		expiresAt: future,
		absoluteExpiresAt: future,
		createdAt: '2026-01-01T00:00:00.000Z',
		lastSeenAt: '2026-01-01T00:00:00.000Z',
		device: { label: 'Chrome on Mac', userAgentHash: 'abcdef', ipHash: null, country: null },
		csrfSecretHash: 'stored',
		...overrides,
	}) as never;

const harness = (overrides: Record<string, unknown> = {}) => {
	const auth = {
		verifyToken: vi.fn(async () => ({ sid: 's1', sub: 'cus_1', aud: 'storefront' }) as unknown),
		signAccessToken: vi.fn(async () => 'jwt'),
		issueAccessToken: vi.fn(async () => 'jwt'),
		signToken: vi.fn(async () => 'jwt'),
		...overrides,
	};
	const sessions = {
		findById: vi.fn(async () => session() as unknown),
		findByRefreshTokenHash: vi.fn(async () => session() as unknown),
		findByPreviousRefreshTokenHash: vi.fn(async () => null as unknown),
		updateCsrfSecretHash: vi.fn(async () => session() as unknown),
		revokeFamily: vi.fn(async () => 2),
		revoke: vi.fn(async () => {}),
		rotate: vi.fn(async () => session() as unknown),
		revokeAllForUser: vi.fn(async () => 3),
		updateDeviceLabel: vi.fn(async () => {}),
		listActiveForUser: vi.fn(async () => [] as unknown[]),
		create: vi.fn(async (row: unknown) => row),
	};
	const customerAuth = {
		findAuthStateById: vi.fn(async () => ({ id: 'cus_1', status: 'active', tokenVersion: 1 }) as unknown),
	};
	const adminAuth = {
		findAuthStateById: vi.fn(
			async () =>
				({ id: 'adm_1', status: 'active', role: 'admin', tokenVersion: 1, permissionsVersion: 2 }) as unknown,
		),
	};
	const service = new SessionService(
		config,
		auth as never,
		sessions as never,
		customerAuth as never,
		adminAuth as never,
	);
	return { service, auth, sessions, customerAuth, adminAuth };
};

const request = (cookies: Record<string, string> = {}, headers: Record<string, unknown> = {}) =>
	({ cookies, headers, ip: '1.2.3.4', url: '/auth/storefront/refresh' }) as never;
const reply = () => {
	const value = { setCookie: vi.fn(), clearCookie: vi.fn(), header: vi.fn() };
	value.setCookie.mockReturnValue(value);
	value.clearCookie.mockReturnValue(value);
	value.header.mockReturnValue(value);
	return value;
};

let h: ReturnType<typeof harness>;

beforeEach(() => {
	h = harness();
});

describe('reading a session from a request', () => {
	it('prefers the access cookie', async () => {
		const found = await h.service.resolveLiveSessionFromRequest(
			request({ [names.access]: 'jwt', [names.refresh]: 'r' }),
		);
		expect((found as unknown as { id: string }).id).toBe('s1');
		expect(h.sessions.findByRefreshTokenHash).not.toHaveBeenCalled();
	});

	it('falls back to the refresh cookie when the access claims are incomplete or bad', async () => {
		h.auth.verifyToken.mockResolvedValueOnce({});
		await h.service.resolveLiveSessionFromRequest(request({ [names.access]: 'jwt', [names.refresh]: 'r' }));
		expect(h.sessions.findByRefreshTokenHash).toHaveBeenCalledTimes(1);
		h.auth.verifyToken.mockRejectedValueOnce(new Error('expired'));
		await h.service.resolveLiveSessionFromRequest(request({ [names.access]: 'jwt', [names.refresh]: 'r' }));
		expect(h.sessions.findByRefreshTokenHash).toHaveBeenCalledTimes(2);
		h.auth.verifyToken.mockResolvedValueOnce({ sid: 's1', sub: 'cus_1' });
		await h.service.resolveLiveSessionFromRequest(request({ [names.access]: 'jwt', [names.refresh]: 'r' }));
		expect(h.sessions.findByRefreshTokenHash).toHaveBeenCalledTimes(3);
	});

	it('answers null with no cookies, or a session that is not live', async () => {
		expect(await h.service.resolveLiveSessionFromRequest(request())).toBeNull();
		h.sessions.findByRefreshTokenHash.mockResolvedValue(session({ revokedAt: past }));
		expect(await h.service.resolveLiveSessionFromRequest(request({ [names.refresh]: 'r' }))).toBeNull();
		h.sessions.findById.mockResolvedValue(null);
		expect(await h.service.findLiveById('s1')).toBeNull();
		h.sessions.findById.mockResolvedValue(session());
		expect(await h.service.findLiveById('s1', { userId: 'other' })).toBeNull();
		expect(await h.service.findLiveById('s1', { audience: 'admin' })).toBeNull();
	});

	it('refuses a CSRF rotation for a session that vanished', async () => {
		h.sessions.updateCsrfSecretHash.mockResolvedValue(null);
		await expect(
			h.service.issueCsrfToken(request({ [names.access]: 'jwt' }), reply() as never),
		).rejects.toBeInstanceOf(UnauthorizedException);
	});
});

describe('refresh reuse', () => {
	it('does nothing with no cookie, or a token that was never rotated away', async () => {
		expect(await h.service.revokeFamilyIfRefreshReused(request(), reply() as never)).toBe(false);
		expect(await h.service.revokeFamilyIfRefreshReused(request({ [names.refresh]: 'r' }), reply() as never)).toBe(
			false,
		);
	});

	it('revokes the family and clears cookies', async () => {
		h.sessions.findByPreviousRefreshTokenHash.mockResolvedValue(session());
		const response = reply();
		expect(await h.service.revokeFamilyIfRefreshReused(request({ [names.refresh]: 'r' }), response as never)).toBe(
			true,
		);
		expect(h.sessions.revokeFamily).toHaveBeenCalledTimes(1);
	});
});

describe('refresh', () => {
	const run = (
		cookies: Record<string, string> = { [names.refresh]: 'r' },
		headers: Record<string, unknown> = {},
		audience = 'storefront',
	) =>
		h.service.refresh({ request: request(cookies, headers), reply: reply() as never, audience: audience as never });

	it('needs a token', async () => {
		await expect(run({})).rejects.toThrow('No refresh token');
	});

	it('refuses a reused token', async () => {
		h.sessions.findByPreviousRefreshTokenHash.mockResolvedValue(session());
		await expect(run()).rejects.toThrow('Session revoked');
	});

	it.each([
		['a missing session', null],
		['a revoked session', session({ revokedAt: past })],
		['the wrong audience', session({ audience: 'admin' })],
	])('refuses %s', async (_label, found) => {
		h.sessions.findByRefreshTokenHash.mockResolvedValue(found);
		await expect(run()).rejects.toThrow('Invalid session');
	});

	it.each([
		['absolute', { absoluteExpiresAt: past }],
		['idle', { expiresAt: past }],
	])('expires a session past its %s limit', async (_label, overrides) => {
		h.sessions.findByRefreshTokenHash.mockResolvedValue(session(overrides));
		await expect(run()).rejects.toThrow('Session expired');
		expect(h.sessions.revoke).toHaveBeenCalledTimes(1);
	});

	it('treats a lost rotation as a replay', async () => {
		h.sessions.rotate.mockResolvedValue(null);
		await expect(run()).rejects.toThrow('Session revoked');
		expect(h.sessions.revokeFamily).toHaveBeenCalledTimes(1);
	});

	it('stops a disabled account renewing itself', async () => {
		h.customerAuth.findAuthStateById.mockResolvedValue({ id: 'cus_1', status: 'disabled' });
		await expect(run()).rejects.toThrow('Account is not active');
		h.customerAuth.findAuthStateById.mockResolvedValue(null);
		await expect(run()).rejects.toThrow('Account is not active');
		expect(h.sessions.revokeAllForUser).toHaveBeenCalledTimes(2);
	});

	it('rotates and keeps a good device label', async () => {
		const result = await run({ [names.refresh]: 'r' }, { 'user-agent': 'Mozilla/5.0' });
		expect(result.csrfToken).toEqual(expect.any(String));
		expect(h.sessions.updateDeviceLabel).not.toHaveBeenCalled();
	});

	it('fills in a missing device label from an array header', async () => {
		h.sessions.rotate.mockResolvedValue(session({ device: { label: null, userAgentHash: 'abcdef' } }));
		const agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
		const result = await run({ [names.refresh]: 'r' }, { 'user-agent': [agent] });
		expect(h.sessions.updateDeviceLabel).toHaveBeenCalledTimes(1);
		expect((result.session as unknown as { device: { label: string } }).device.label).not.toBeNull();
	});

	it('copes with no user agent at all', async () => {
		await expect(run()).resolves.toBeDefined();
	});

	it('renews an admin session from the admin record', async () => {
		const adminNames = cookieNames(config, 'admin');
		const row = session({ audience: 'admin', userId: 'adm_1' });
		h.sessions.findByRefreshTokenHash.mockResolvedValue(row);
		h.sessions.rotate.mockResolvedValue(row);
		await expect(run({ [adminNames.refresh]: 'r' }, {}, 'admin')).resolves.toBeDefined();
		h.adminAuth.findAuthStateById.mockResolvedValue({ status: 'disabled' });
		await expect(run({ [adminNames.refresh]: 'r' }, {}, 'admin')).rejects.toThrow('Account is not active');
		h.adminAuth.findAuthStateById.mockResolvedValue(null);
		await expect(run({ [adminNames.refresh]: 'r' }, {}, 'admin')).rejects.toThrow('Account is not active');
	});
});

describe('establishing a session', () => {
	const establish = (headers: Record<string, unknown>) =>
		h.service.establish({
			user: { id: 'cus_1', role: null, tokenVersion: 1, permissionsVersion: 0 },
			audience: 'storefront',
			request: request({}, headers),
			reply: reply() as never,
			persistent: true,
		});

	it('reads a user agent given as a list, and copes with none', async () => {
		await establish({ 'user-agent': ['Mozilla/5.0'] });
		await establish({});
		const device = (h.sessions.create.mock.calls[1] as unknown as [{ device: { userAgentHash: unknown } }])[0]
			.device;
		expect(device.userAgentHash).toBeNull();
	});
});

describe('revoking', () => {
	it('uses the refresh cookie when there is one', async () => {
		await h.service.revoke(request({ [names.refresh]: 'r' }), reply() as never);
		expect(h.sessions.revoke).toHaveBeenCalledWith('s1', 'logout', expect.any(String));
		h.sessions.findByRefreshTokenHash.mockResolvedValue(null);
		await h.service.revoke(request({ [names.refresh]: 'r' }), reply() as never, 'logout_all');
		expect(h.sessions.revoke).toHaveBeenCalledTimes(1);
	});

	it('falls back to the access cookie, and survives a bad one', async () => {
		await h.service.revoke(request({ [names.access]: 'jwt' }), reply() as never);
		expect(h.sessions.revoke).toHaveBeenCalledTimes(1);
		h.auth.verifyToken.mockResolvedValueOnce({});
		await h.service.revoke(request({ [names.access]: 'jwt' }), reply() as never);
		expect(h.sessions.revoke).toHaveBeenCalledTimes(1);
		h.auth.verifyToken.mockRejectedValueOnce(new Error('expired'));
		await expect(h.service.revoke(request({ [names.access]: 'jwt' }), reply() as never)).resolves.toBeUndefined();
	});

	it('still clears cookies with nothing to revoke', async () => {
		await expect(h.service.revoke(request(), reply() as never)).resolves.toBeUndefined();
	});

	it('counts and revokes everything for a user', async () => {
		h.sessions.listActiveForUser.mockResolvedValue([session(), session()]);
		expect(await h.service.countActiveForUser('cus_1', 'storefront')).toBe(2);
		expect(await h.service.revokeAllForUser('cus_1', 'logout_all')).toBe(3);
	});
});

describe('own sessions', () => {
	const principal = { userId: 'cus_1', sessionId: 's1', audience: 'storefront' } as never;

	it('lists newest first, marks the current one, and names an old row', async () => {
		h.sessions.listActiveForUser.mockResolvedValue([
			session({
				id: 's0',
				createdAt: '2025-01-01T00:00:00.000Z',
				device: { label: null, userAgentHash: 'abcdef', country: null },
			}),
			session(),
		]);
		const { items } = await h.service.listOwnSessions(principal);
		expect(items.map((row) => row.id)).toEqual(['s1', 's0']);
		expect(items[0]?.current).toBe(true);
		expect(items[1]?.label).toEqual(expect.any(String));
	});

	it('revokes only what is the caller’s own', async () => {
		expect(await h.service.revokeOwnSession(principal, 's1')).toEqual({ wasCurrent: true });
		h.sessions.findById.mockResolvedValue(session({ id: 's2' }));
		expect(await h.service.revokeOwnSession(principal, 's2')).toEqual({ wasCurrent: false });
		for (const found of [
			null,
			session({ revokedAt: past }),
			session({ userId: 'x' }),
			session({ audience: 'admin' }),
		]) {
			h.sessions.findById.mockResolvedValue(found);
			await expect(h.service.revokeOwnSession(principal, 's1')).rejects.toBeInstanceOf(NotFoundException);
		}
	});

	it('keeps the current session when revoking the rest', async () => {
		h.sessions.listActiveForUser.mockResolvedValue([session(), session({ id: 's2' })]);
		expect(await h.service.revokeOtherSessions(principal)).toBe(1);
		expect(h.sessions.revoke).toHaveBeenCalledWith('s2', 'logout_all', expect.any(String));
	});

	it('finds by the refresh cookie', async () => {
		expect(await h.service.findByRefreshCookie(request())).toBeNull();
		expect(await h.service.findByRefreshCookie(request({ [names.refresh]: 'r' }))).toBeDefined();
	});
});
