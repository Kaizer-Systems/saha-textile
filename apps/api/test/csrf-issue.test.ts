import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { AuthSession } from '@saha-textile/contracts';

import { SessionService } from '../src/auth/session.service';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});
const names = cookieNames(config);

function hash(value: string): string {
	return createHmac('sha256', 'c'.repeat(32)).update(value).digest('hex');
}

function liveSession(csrfToken: string): AuthSession {
	const now = Date.now();
	return {
		id: 'sess_a',
		userId: 'user_a',
		audience: 'storefront',
		roleAtLogin: 'customer',
		refreshTokenHash: 'r',
		refreshFamilyId: 'fam_a',
		rotationCounter: 0,
		previousRefreshTokenHash: null,
		replacedBySessionId: null,
		csrfSecretHash: hash(csrfToken),
		device: { userAgentHash: null, ipHash: null, country: null, label: null },
		createdAt: new Date(now).toISOString(),
		lastSeenAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 60_000).toISOString(),
		absoluteExpiresAt: new Date(now + 3_600_000).toISOString(),
		revokedAt: null,
		revokeReason: null,
	};
}

describe('GET /auth/csrf policy B — preserve active session token', () => {
	it('preserves a still-valid session-bound CSRF cookie (no rotation)', async () => {
		const token = 'existing-csrf-token-value';
		const session = liveSession(token);
		const updateCsrfSecretHash = vi.fn();
		const sessions = {
			findById: vi.fn(async () => session),
			updateCsrfSecretHash,
		};
		const auth = {
			verifyToken: vi.fn(async () => ({
				sub: 'user_a',
				sid: 'sess_a',
				aud: 'storefront',
			})),
		};
		const service = new SessionService(config, auth as never, sessions as never, {} as never);
		const setCookie = vi.fn().mockReturnThis();
		const reply = { setCookie } as never;
		const request = {
			cookies: { [names.access]: 'jwt', [names.csrf]: token },
		} as never;

		const issued = await service.issueCsrfToken(request, reply);
		expect(issued).toBe(token);
		expect(updateCsrfSecretHash).not.toHaveBeenCalled();
		expect(setCookie).toHaveBeenCalledWith(names.csrf, token, expect.any(Object));
	});

	it('recovers by rotating when the readable cookie is missing for a live session', async () => {
		const session = liveSession('old-token');
		const updateCsrfSecretHash = vi.fn(async (_id: string, nextHash: string) => ({
			...session,
			csrfSecretHash: nextHash,
		}));
		const sessions = {
			findById: vi.fn(async () => session),
			updateCsrfSecretHash,
		};
		const auth = {
			verifyToken: vi.fn(async () => ({
				sub: 'user_a',
				sid: 'sess_a',
				aud: 'storefront',
			})),
		};
		const service = new SessionService(config, auth as never, sessions as never, {} as never);
		const setCookie = vi.fn().mockReturnThis();
		const reply = { setCookie } as never;
		const request = { cookies: { [names.access]: 'jwt' } } as never;

		const issued = await service.issueCsrfToken(request, reply);
		expect(issued).toBeTruthy();
		expect(issued).not.toBe('old-token');
		expect(updateCsrfSecretHash).toHaveBeenCalledOnce();
		const nextHash = updateCsrfSecretHash.mock.calls[0]?.[1] as string;
		expect(service.verifyCsrfForSession({ csrfSecretHash: nextHash }, issued)).toBe(true);
	});

	it('issues an unbound token for anonymous pre-session callers', async () => {
		const sessions = {
			findById: vi.fn(),
			findByRefreshTokenHash: vi.fn(),
			updateCsrfSecretHash: vi.fn(),
		};
		const auth = { verifyToken: vi.fn() };
		const service = new SessionService(config, auth as never, sessions as never, {} as never);
		const setCookie = vi.fn().mockReturnThis();
		const reply = { setCookie } as never;
		const request = { cookies: {} } as never;

		const issued = await service.issueCsrfToken(request, reply);
		expect(issued).toBeTruthy();
		expect(sessions.updateCsrfSecretHash).not.toHaveBeenCalled();
		expect(setCookie).toHaveBeenCalledWith(names.csrf, issued, expect.any(Object));
	});
});
