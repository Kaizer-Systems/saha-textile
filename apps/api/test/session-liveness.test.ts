import { describe, expect, it } from 'vitest';

import type { AuthSession } from '@saha-textile/contracts';

import { SessionService } from '../src/auth/session.service';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
});

function session(overrides: Partial<AuthSession> = {}): AuthSession {
	const now = Date.now();
	return {
		id: 'sess_1',
		userId: 'user_1',
		audience: 'storefront',
		roleAtLogin: null,
		refreshTokenHash: 'r',
		refreshFamilyId: 'fam_1',
		rotationCounter: 0,
		previousRefreshTokenHash: null,
		replacedBySessionId: null,
		csrfSecretHash: 'c',
		device: { userAgentHash: null, ipHash: null, country: null, label: null },
		createdAt: new Date(now).toISOString(),
		lastSeenAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 60_000).toISOString(),
		absoluteExpiresAt: new Date(now + 3_600_000).toISOString(),
		revokedAt: null,
		revokeReason: null,
		...overrides,
	};
}

describe('admin idle vs soft-lock', () => {
	it('keeps admin server idle longer than the 15-minute soft-lock UI window', async () => {
		const { ADMIN_IDLE_TTL_SECONDS } = await import('../src/auth/session.service');
		const softLockSeconds = 15 * 60;
		expect(ADMIN_IDLE_TTL_SECONDS).toBeGreaterThan(softLockSeconds);
		expect(ADMIN_IDLE_TTL_SECONDS).toBe(60 * 60);
	});
});

describe('SessionService.isLiveSession', () => {
	const service = new SessionService(config, {} as never, {} as never, {} as never, {} as never);

	it('accepts a live matching session', () => {
		expect(service.isLiveSession(session(), { userId: 'user_1', audience: 'storefront' })).toBe(true);
	});

	it('rejects missing sessions', () => {
		expect(service.isLiveSession(null)).toBe(false);
	});

	it('rejects revoked sessions', () => {
		expect(service.isLiveSession(session({ revokedAt: new Date().toISOString(), revokeReason: 'logout' }))).toBe(
			false,
		);
	});

	it('rejects idle-expired sessions', () => {
		expect(service.isLiveSession(session({ expiresAt: new Date(Date.now() - 1).toISOString() }))).toBe(false);
	});

	it('rejects absolute-expired sessions', () => {
		expect(service.isLiveSession(session({ absoluteExpiresAt: new Date(Date.now() - 1).toISOString() }))).toBe(
			false,
		);
	});

	it('rejects user mismatch', () => {
		expect(service.isLiveSession(session(), { userId: 'user_other' })).toBe(false);
	});

	it('rejects audience mismatch', () => {
		expect(service.isLiveSession(session(), { audience: 'admin' })).toBe(false);
	});
});
