import { describe, expect, it, vi } from 'vitest';

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

const harness = (overrides: Record<string, unknown> = {}, settings: unknown = config) => {
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
		settings as never,
		auth as never,
		sessions as never,
		customerAuth as never,
		adminAuth as never,
	);
	return { service, auth, sessions, customerAuth, adminAuth };
};

const request = (cookies: Record<string, string> = {}, headers: Record<string, unknown> = {}) =>
	({ cookies, headers, ip: '1.2.3.4', url: '/auth/storefront/refresh' }) as never;

const resetDaysAgo = (days: number) => {
	const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
	return {
		settings: {
			...(config as object),
			cookies: { ...(config as { cookies: object }).cookies, sessionsResetAt: at },
		},
		day: at.slice(0, 10),
	};
};

describe('the signed-out notice after a key leak', () => {
	it('shows nothing without a recent reset, or without a refresh cookie', async () => {
		expect(await harness().service.signedOutNotice(request({ [names.refresh]: 'token' }))).toBeNull();
		const { settings } = resetDaysAgo(2);
		expect(await harness({}, settings).service.signedOutNotice(request())).toBeNull();
	});

	it('shows the day when the browser’s session no longer matches, and nothing when it still does', async () => {
		const { settings, day } = resetDaysAgo(2);
		const stale = harness({}, settings);
		stale.sessions.findByRefreshTokenHash.mockResolvedValue(null);
		expect(await stale.service.signedOutNotice(request({ [names.refresh]: 'token' }))).toBe(day);
		const fresh = harness({}, settings);
		expect(await fresh.service.signedOutNotice(request({ [names.refresh]: 'token' }))).toBeNull();
	});
});

describe('sessions found by their refresh cookie: the remaining cases', () => {
	it('finds none without a cookie or for an unknown token, and the session for a known one', async () => {
		const { service, sessions } = harness();
		expect(await service.findByRefreshCookie(request())).toBeNull();
		expect(await service.findByRefreshCookie(request({ [names.refresh]: 'token' }))).toMatchObject({ id: 's1' });
		sessions.findByRefreshTokenHash.mockResolvedValue(null);
		expect(await service.findByRefreshCookie(request({ [names.refresh]: 'token' }))).toBeNull();
	});

	it('resolves no session from an unknown refresh token when there is no access cookie', async () => {
		const { service, sessions } = harness();
		sessions.findByRefreshTokenHash.mockResolvedValue(null);
		expect(await service.resolveLiveSessionFromRequest(request({ [names.refresh]: 'token' }))).toBeNull();
	});

	it('keeps an admin’s idle expiry from now when the last activity cannot be read', () => {
		const { service } = harness();
		const now = Date.parse('2026-11-24T10:00:00.000Z');
		const next = (service as unknown as { nextIdleExpiry(current: unknown, nowMs: number): string }).nextIdleExpiry(
			session({ audience: 'admin', persistent: false, lastActiveAt: 'not a date' }),
			now,
		);
		expect(Date.parse(next)).toBeGreaterThan(now);
	});
});
