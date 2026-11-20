import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthSession } from '@saha-textile/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionRefusal } from '../src/auth/session-refusal';
import { ALLOW_WHILE_LOCKED_KEY, SessionGuard } from '../src/auth/session.guard';
import {
	ADMIN_IDLE_TTL_SECONDS,
	ADMIN_LOCK_AFTER_SECONDS,
	ADMIN_LOCK_GRACE_SECONDS,
	isAdminSessionLocked,
	SessionService,
} from '../src/auth/session.service';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

/**
 * The admin's 15-minute lock is held by the server (owner, 2026-11-20): a reload, a new tab or a
 * sleeping laptop comes back to the lock until the PIN or password is entered.
 */
const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
const minutesAgo = (m: number, now = Date.now()) => new Date(now - m * 60_000).toISOString();

const adminSession = (over: Partial<AuthSession> = {}): AuthSession =>
	({
		id: 'sess_admin',
		userId: 'adm_1',
		audience: 'admin',
		revokedAt: null,
		createdAt: minutesAgo(30),
		lastSeenAt: minutesAgo(1),
		lastActiveAt: minutesAgo(1),
		lockedAt: null,
		expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
		absoluteExpiresAt: new Date(Date.now() + 7_200_000).toISOString(),
		persistent: false,
		...over,
	}) as AuthSession;

describe('isAdminSessionLocked', () => {
	const now = Date.parse('2026-11-20T12:00:00.000Z');

	it('is locked once the lock was put up, however recent the activity', () => {
		expect(
			isAdminSessionLocked(adminSession({ lockedAt: minutesAgo(1, now), lastActiveAt: minutesAgo(0, now) }), now),
		).toBe(true);
	});

	it('locks after 15 minutes without activity, plus the grace', () => {
		const limit = ADMIN_LOCK_AFTER_SECONDS / 60 + ADMIN_LOCK_GRACE_SECONDS / 60;
		expect(isAdminSessionLocked(adminSession({ lastActiveAt: minutesAgo(10, now) }), now)).toBe(false);
		expect(isAdminSessionLocked(adminSession({ lastActiveAt: minutesAgo(limit - 0.1, now) }), now)).toBe(false);
		expect(isAdminSessionLocked(adminSession({ lastActiveAt: minutesAgo(limit + 0.1, now) }), now)).toBe(true);
	});

	it('falls back to the last refresh for sessions written before the lock was held', () => {
		expect(isAdminSessionLocked(adminSession({ lastActiveAt: null, lastSeenAt: minutesAgo(5, now) }), now)).toBe(
			false,
		);
		expect(isAdminSessionLocked(adminSession({ lastActiveAt: null, lastSeenAt: minutesAgo(40, now) }), now)).toBe(
			true,
		);
	});

	it('never locks a shop session', () => {
		expect(isAdminSessionLocked(adminSession({ audience: 'storefront', lockedAt: minutesAgo(1, now) }), now)).toBe(
			false,
		);
	});
});

describe('SessionGuard and the lock', () => {
	const names = cookieNames(config);
	const flags: Record<string, boolean | undefined> = {};
	const reflector = {
		getAllAndOverride: vi.fn((key: string) => flags[key]),
	} as unknown as Reflector;
	const auth = { verifyToken: vi.fn() };
	const adminAuth = { findAuthStateById: vi.fn() };
	const sessions = { findLiveById: vi.fn(), lockAdminSession: vi.fn(async () => {}) };
	const guard = () =>
		new SessionGuard(
			reflector,
			config,
			auth as never,
			{ findAuthStateById: vi.fn() } as never,
			adminAuth as never,
			{ findById: vi.fn() } as never,
			{ listActiveForUser: vi.fn(async (): Promise<unknown[]> => []) } as never,
			sessions as unknown as SessionService,
		);
	const context = () =>
		({
			getHandler: () => ({}),
			getClass: () => ({}),
			switchToHttp: () => ({ getRequest: () => ({ cookies: { [names.access]: 'jwt' }, headers: {} }) }),
		}) as unknown as ExecutionContext;

	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of Object.keys(flags)) delete flags[key];
		auth.verifyToken.mockResolvedValue({
			sub: 'adm_1',
			sid: 'sess_admin',
			aud: 'admin',
			tokenVersion: 1,
			permissionsVersion: 2,
		});
		adminAuth.findAuthStateById.mockResolvedValue({
			id: 'adm_1',
			status: 'active',
			tokenVersion: 1,
			permissionsVersion: 2,
			role: 'admin',
			permissions: [],
		});
	});

	it('lets an active session through', async () => {
		sessions.findLiveById.mockResolvedValue(adminSession());
		await expect(guard().canActivate(context())).resolves.toBe(true);
		expect(sessions.lockAdminSession).not.toHaveBeenCalled();
	});

	it('refuses every ordinary admin route behind the lock, with its own reason', async () => {
		sessions.findLiveById.mockResolvedValue(adminSession({ lockedAt: minutesAgo(2) }));
		const refusal = (await guard()
			.canActivate(context())
			.catch((e: unknown) => e)) as SessionRefusal;
		expect(refusal.reason).toBe('session_locked');
		expect(refusal.getStatus()).toBe(401);
		// Already locked: nothing more is written.
		expect(sessions.lockAdminSession).not.toHaveBeenCalled();
	});

	it('writes the lock down when inactivity alone put it up, so a later activity signal cannot undo it', async () => {
		const idle = adminSession({ lastActiveAt: minutesAgo(30) });
		sessions.findLiveById.mockResolvedValue(idle);
		await expect(guard().canActivate(context())).rejects.toMatchObject({ reason: 'session_locked' });
		expect(sessions.lockAdminSession).toHaveBeenCalledWith(idle);
	});

	it('lets the routes marked for it through while locked (who am I, resume, lock)', async () => {
		flags[ALLOW_WHILE_LOCKED_KEY] = true;
		sessions.findLiveById.mockResolvedValue(adminSession({ lockedAt: minutesAgo(2) }));
		await expect(guard().canActivate(context())).resolves.toBe(true);
	});
});

describe('SessionService lock helpers', () => {
	const repo = {
		setLock: vi.fn(async () => {}),
		markActive: vi.fn(async () => {}),
	};
	const service = new SessionService(config, {} as never, repo as never, {} as never, {} as never);

	beforeEach(() => vi.clearAllMocks());

	it('locks once and keeps the first lock time', async () => {
		await service.lockAdminSession(adminSession());
		expect(repo.setLock).toHaveBeenCalledWith('sess_admin', expect.any(String));
		await service.lockAdminSession(adminSession({ lockedAt: minutesAgo(3) }));
		expect(repo.setLock).toHaveBeenCalledTimes(1);
	});

	it('unlocks and counts the proof as activity in one update', async () => {
		await service.unlockAdminSession('sess_admin');
		expect(repo.setLock).toHaveBeenCalledWith('sess_admin', null, expect.any(String));
	});

	it('records activity', async () => {
		await service.markAdminActive('sess_admin');
		expect(repo.markActive).toHaveBeenCalledWith('sess_admin', expect.any(String));
	});

	it('never lets a background refresh keep a locked session alive past an hour after the last activity', () => {
		const now = Date.parse('2026-11-20T12:00:00.000Z');
		const expiry = (s: AuthSession) => Date.parse(service['nextIdleExpiry'](s, now));
		// Active a minute ago: a full hour from now (the normal sliding window).
		expect(expiry(adminSession({ lastActiveAt: minutesAgo(1, now) }))).toBe(
			now + ADMIN_IDLE_TTL_SECONDS * 1000 - 60_000,
		);
		// Locked and idle for 50 minutes: only 10 minutes are left, however often it refreshes.
		expect(expiry(adminSession({ lastActiveAt: minutesAgo(50, now) }))).toBe(now + 10 * 60_000);
		// A shop session keeps its own window.
		expect(
			expiry(adminSession({ audience: 'storefront', persistent: true, lastActiveAt: minutesAgo(50, now) })),
		).toBeGreaterThan(now + ADMIN_IDLE_TTL_SECONDS * 1000);
	});
});
