import { HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthController } from '../src/auth/admin-auth.controller';

const principal = { userId: 'adm_1', sessionId: 's1' } as never;
const session = { audience: 'admin', expiresAt: 'e', absoluteExpiresAt: 'a', userId: 'adm_1' };
const user = {
	id: 'adm_1',
	role: 'admin',
	status: 'active',
	tokenVersion: 1,
	permissionsVersion: 1,
	permissions: ['a.b'],
};

const harness = () => {
	const adminRepo = {
		recordSuccessfulLogin: vi.fn(async () => {}),
		findAuthStateById: vi.fn(async () => user as unknown),
	};
	const auth = {
		checkRateLimit: vi.fn(async () => ({ allowed: true }) as unknown),
		consumeRateLimit: vi.fn(async () => ({ allowed: true }) as unknown),
		recordRateLimitFailure: vi.fn(async () => {}),
		clearRateLimitIdentifier: vi.fn(async () => {}),
		findAuthUserByIdentifier: vi.fn(async () => user as unknown),
		verifyPassword: vi.fn(async () => true),
		verifyAdminPin: vi.fn(async () => 'ok' as string),
		adminAuthRepository: adminRepo,
		adminUserRepository: {
			findById: vi.fn(async () => ({ id: 'adm_1', status: 'active', displayName: 'Old', phone: '1' }) as unknown),
			save: vi.fn(async (row: unknown) => row),
		},
		publicAdminUser: vi.fn(async () => ({ id: 'adm_1' })),
		startAdminPasswordReset: vi.fn(async () => {}),
		completePasswordReset: vi.fn(async () => ({ userId: 'adm_1' }) as unknown),
		requirePinRevalidation: vi.fn(async () => {}),
	};
	const sessions = {
		issueCsrfToken: vi.fn(async () => 'token'),
		establish: vi.fn(async () => ({ session })),
		refresh: vi.fn(async () => ({ session })),
		revoke: vi.fn(async () => {}),
		revokeAllForUser: vi.fn(async () => {}),
		clearCookies: vi.fn(),
		findLiveById: vi.fn(async () => ({ expiresAt: 'live-e', absoluteExpiresAt: 'live-a' }) as unknown),
		listOwnSessions: vi.fn(async () => ({ items: [] })),
		revokeOwnSession: vi.fn(async () => ({ wasCurrent: false })),
		revokeOtherSessions: vi.fn(async () => 1),
	};
	const invites = {
		create: vi.fn(async () => ({
			id: 'i',
			emailNormalized: 'a@example.test',
			role: 'staff',
			expiresAt: 'x',
			tokenHash: 'secret',
		})),
		listPending: vi.fn(async () => [
			{ id: 'i', emailNormalized: 'a@example.test', role: 'staff', expiresAt: 'x', tokenHash: 'secret' },
		]),
		revoke: vi.fn(async () => {}),
		accept: vi.fn(async () => ({ id: 'adm_2', role: 'staff' })),
	};
	const security = {
		setPin: vi.fn(async () => {}),
		settings: vi.fn(async () => 'settings'),
		removePin: vi.fn(async () => {}),
		changePassword: vi.fn(async () => {}),
	};
	const roles = { findById: vi.fn(async () => null as unknown) };
	const assignments = { listActiveForUser: vi.fn(async () => [] as unknown[]) };
	const controller = new AdminAuthController(
		auth as never,
		sessions as never,
		invites as never,
		security as never,
		roles as never,
		assignments as never,
	);
	return { controller, auth, adminRepo, sessions, invites, security, roles, assignments };
};

const request = (id: unknown = 'req-1') => ({ ip: '1.2.3.4', id }) as never;
const reply = () => ({ setCookie: vi.fn(), header: vi.fn() }) as never;
const statusOf = async (work: Promise<unknown>) =>
	((await work.catch((caught: unknown) => caught)) as HttpException).getStatus();

let h: ReturnType<typeof harness>;

beforeEach(() => {
	h = harness();
});

describe('needs a session', () => {
	it('refuses every signed-in route without one', async () => {
		const calls: Array<() => unknown> = [
			() => h.controller.setPin({} as never, undefined, request()),
			() => h.controller.securitySettings(undefined),
			() => h.controller.removePin({} as never, undefined, request()),
			() => h.controller.changePassword({} as never, undefined, request(), reply()),
			() => h.controller.me(undefined),
			() => h.controller.updateProfile(undefined, {} as never),
			() => h.controller.listSessions(undefined),
			() => h.controller.revokeSession('s', undefined, reply()),
			() => h.controller.revokeOtherSessions(undefined),
			() => h.controller.createInvite({} as never, undefined, request()),
			() => h.controller.revokeInvite('i', undefined, request()),
			() => h.controller.resume({} as never, undefined, request(), reply()),
		];
		for (const call of calls) {
			await expect(Promise.resolve().then(call)).rejects.toBeInstanceOf(UnauthorizedException);
		}
	});
});

describe('password login', () => {
	const body = { identifier: 'Admin@Example.test', password: 'p' } as never;

	it('issues the CSRF token', async () => {
		expect(await h.controller.issueCsrfToken(request(), reply())).toEqual({ csrfToken: 'token' });
	});

	it('states a network limit and hides an account limit', async () => {
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, scope: 'ip', retryAfterSeconds: 3 });
		expect(await statusOf(h.controller.login(body, request(), reply()))).toBe(429);
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, scope: 'identifier' });
		expect(await statusOf(h.controller.login(body, request(), reply()))).toBe(401);
	});

	it.each([
		['an unknown person', { found: null, valid: false }],
		['a wrong password', { found: user, valid: false }],
		['a disabled account', { found: { ...user, status: 'disabled' }, valid: true }],
	])('gives one answer for %s', async (_label, { found, valid }) => {
		h.auth.findAuthUserByIdentifier.mockResolvedValue(found);
		h.auth.verifyPassword.mockResolvedValue(valid);
		expect(await statusOf(h.controller.login(body, request(), reply()))).toBe(401);
		expect(h.auth.recordRateLimitFailure).toHaveBeenCalledWith('admin_login', {
			identifier: 'admin@example.test',
			ip: '1.2.3.4',
		});
	});

	it('opens an admin session and clears the budget', async () => {
		const result = await h.controller.login(body, request(), reply());
		expect(result.session).toEqual({ audience: 'admin', expiresAt: 'e', refreshExpiresAt: 'a' });
		expect(h.auth.clearRateLimitIdentifier).toHaveBeenCalledWith('admin_login', 'admin@example.test');
		expect(h.sessions.establish).toHaveBeenCalledWith(
			expect.objectContaining({ audience: 'admin', persistent: true }),
		);
	});
});

describe('PIN login', () => {
	const body = { identifier: 'a', pin: '123456' } as never;

	it('answers 429 past the address ceiling', async () => {
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 1 });
		expect(await statusOf(h.controller.pinLogin(body, request(), reply()))).toBe(429);
	});

	it('refuses a stranger or a disabled account', async () => {
		h.auth.findAuthUserByIdentifier.mockResolvedValue(null);
		expect(await statusOf(h.controller.pinLogin(body, request(), reply()))).toBe(401);
		h.auth.findAuthUserByIdentifier.mockResolvedValue({ ...user, status: 'disabled' });
		expect(await statusOf(h.controller.pinLogin(body, request(), reply()))).toBe(401);
		expect(h.auth.recordRateLimitFailure).toHaveBeenCalledTimes(2);
	});

	it.each([
		['revalidation_required', 'PIN use is suspended', 0],
		['locked', 'temporarily locked', 0],
		['wrong', 'Invalid credentials', 1],
	])('explains %s', async (outcome, message, failures) => {
		h.auth.verifyAdminPin.mockResolvedValue(outcome);
		await expect(h.controller.pinLogin(body, request(), reply())).rejects.toThrow(message);
		expect(h.auth.recordRateLimitFailure).toHaveBeenCalledTimes(failures);
	});

	it('opens a session', async () => {
		expect((await h.controller.pinLogin(body, request(), reply())).user).toEqual({ id: 'adm_1' });
		expect(h.adminRepo.recordSuccessfulLogin).toHaveBeenCalledTimes(1);
	});
});

describe('credentials', () => {
	it('sets and removes a PIN with the request id, or none', async () => {
		await h.controller.setPin({ pin: '1' } as never, principal, request());
		expect(h.security.setPin).toHaveBeenLastCalledWith('adm_1', { pin: '1' }, 'req-1');
		await h.controller.setPin({ pin: '1' } as never, principal, request(7));
		expect(h.security.setPin).toHaveBeenLastCalledWith('adm_1', { pin: '1' }, null);
		await h.controller.removePin({ currentPassword: 'p' } as never, principal, request());
		expect(h.security.removePin).toHaveBeenCalledWith('adm_1', 'p', 'req-1');
		expect(await h.controller.securitySettings(principal)).toBe('settings');
	});

	it('clears cookies after a password change', async () => {
		await h.controller.changePassword({} as never, principal, request(), reply());
		expect(h.sessions.clearCookies).toHaveBeenCalledTimes(1);
	});

	it('starts recovery only within budget, answering alike', async () => {
		const sent = await h.controller.forgotPassword({ identifier: ' A@Example.test ' } as never, request());
		expect(h.auth.startAdminPasswordReset).toHaveBeenCalledWith('a@example.test');
		h.auth.consumeRateLimit.mockResolvedValue({ allowed: false });
		expect(await h.controller.forgotPassword({ identifier: 'a' } as never, request())).toEqual(sent);
		expect(h.auth.startAdminPasswordReset).toHaveBeenCalledTimes(1);
	});

	it('completes recovery, suspending the PIN', async () => {
		await h.controller.resetPassword({ token: 't', newPassword: 'n' } as never, reply());
		expect(h.auth.requirePinRevalidation).toHaveBeenCalledWith('adm_1');
		expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('adm_1', 'password_changed');
		h.auth.completePasswordReset.mockResolvedValue(null);
		expect(await statusOf(h.controller.resetPassword({ token: 't', newPassword: 'n' } as never, reply()))).toBe(
			401,
		);
	});
});

describe('session routes', () => {
	it('refreshes and logs out', async () => {
		expect((await h.controller.refresh(request(), reply())).session.audience).toBe('admin');
		await h.controller.logout(request(), reply());
		expect(h.sessions.revoke).toHaveBeenCalledTimes(1);
	});

	it('reads the operator and the live session', async () => {
		const me = await h.controller.me(principal);
		expect(me).toMatchObject({
			permissions: ['a.b'],
			session: { expiresAt: 'live-e', refreshExpiresAt: 'live-a' },
		});
	});

	it('estimates the session when it cannot be read, and refuses a missing account', async () => {
		h.sessions.findLiveById.mockResolvedValue(null);
		expect((await h.controller.me(principal)).session.expiresAt).toEqual(expect.any(String));
		h.adminRepo.findAuthStateById.mockResolvedValue(null);
		await expect(h.controller.me(principal)).rejects.toThrow('Account not found');
	});

	it('joins role grants, skipping a role that is gone', async () => {
		h.assignments.listActiveForUser.mockResolvedValue([
			{ roleId: 'r1', revokedAt: null },
			{ roleId: 'r2', revokedAt: null },
		]);
		h.roles.findById
			.mockResolvedValueOnce({ id: 'r1', baseRole: 'staff', permissions: ['c.d'] })
			.mockResolvedValueOnce(null);
		expect((await h.controller.me(principal)).permissions).toEqual(expect.arrayContaining(['a.b', 'c.d']));
	});

	it('falls back to the embedded grants when roles cannot be read', async () => {
		h.assignments.listActiveForUser.mockRejectedValue(new Error('no mongo'));
		expect((await h.controller.me(principal)).permissions).toEqual(['a.b']);
	});

	it('updates a profile, keeping the phone unless one is sent', async () => {
		expect(await h.controller.updateProfile(principal, { displayName: 'New' } as never)).toMatchObject({
			displayName: 'New',
			phone: '1',
		});
		expect(await h.controller.updateProfile(principal, { displayName: 'New', phone: null } as never)).toMatchObject(
			{ phone: null },
		);
	});

	it('refuses a profile edit on an inactive account', async () => {
		h.auth.adminUserRepository.findById.mockResolvedValue(null);
		await expect(h.controller.updateProfile(principal, {} as never)).rejects.toThrow('not active');
		h.auth.adminUserRepository.findById.mockResolvedValue({ status: 'disabled' });
		await expect(h.controller.updateProfile(principal, {} as never)).rejects.toThrow('not active');
	});

	it('lists and revokes own sessions', async () => {
		expect(await h.controller.listSessions(principal)).toEqual({ items: [] });
		await h.controller.revokeSession('s', principal, reply());
		expect(h.sessions.clearCookies).not.toHaveBeenCalled();
		h.sessions.revokeOwnSession.mockResolvedValue({ wasCurrent: true });
		await h.controller.revokeSession('s', principal, reply());
		expect(h.sessions.clearCookies).toHaveBeenCalledTimes(1);
		expect(await h.controller.revokeOtherSessions(principal)).toEqual({ revoked: 1 });
	});
});

describe('invites', () => {
	it('creates one without returning the token', async () => {
		const created = await h.controller.createInvite({} as never, principal, request());
		expect(created).not.toHaveProperty('tokenHash');
		expect(h.invites.create).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'req-1' }));
		await h.controller.createInvite({} as never, principal, request(5));
		expect(h.invites.create).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: null }));
	});

	it('lists them without the token', async () => {
		expect(JSON.stringify(await h.controller.listInvites())).not.toContain('secret');
	});

	it('revokes and accepts', async () => {
		await h.controller.revokeInvite('i', principal, request());
		expect(h.invites.revoke).toHaveBeenLastCalledWith('i', 'adm_1', 'req-1');
		await h.controller.revokeInvite('i', principal, request(5));
		expect(h.invites.revoke).toHaveBeenLastCalledWith('i', 'adm_1', null);
		expect(await h.controller.acceptInvite({} as never)).toEqual({ userId: 'adm_2', role: 'staff' });
	});
});

describe('quick resume', () => {
	const pin = { pin: '123456' } as never;
	const password = { password: 'p' } as never;

	it('refuses an inactive account', async () => {
		h.adminRepo.findAuthStateById.mockResolvedValue(null);
		await expect(h.controller.resume(pin, principal, request(), reply())).rejects.toThrow('not active');
		h.adminRepo.findAuthStateById.mockResolvedValue({ ...user, status: 'disabled' });
		await expect(h.controller.resume(pin, principal, request(), reply())).rejects.toThrow('not active');
	});

	it('respects both limits', async () => {
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 1 });
		expect(await statusOf(h.controller.resume(pin, principal, request(), reply()))).toBe(429);
		expect(await statusOf(h.controller.resume(password, principal, request(), reply()))).toBe(429);
	});

	it.each([
		['revalidation_required', 'PIN use is suspended'],
		['locked', 'temporarily locked'],
		['wrong', 'Invalid credentials'],
	])('explains %s', async (outcome, message) => {
		h.auth.verifyAdminPin.mockResolvedValue(outcome);
		await expect(h.controller.resume(pin, principal, request(), reply())).rejects.toThrow(message);
	});

	it('counts a wrong password', async () => {
		h.auth.verifyPassword.mockResolvedValue(false);
		await expect(h.controller.resume(password, principal, request(), reply())).rejects.toThrow(
			'Invalid credentials',
		);
		expect(h.auth.recordRateLimitFailure).toHaveBeenCalledWith('admin_login', { ip: '1.2.3.4' });
	});

	it('resumes with either proof', async () => {
		expect((await h.controller.resume(pin, principal, request(), reply())).session.audience).toBe('admin');
		expect((await h.controller.resume(password, principal, request(), reply())).session.audience).toBe('admin');
		expect(h.sessions.refresh).toHaveBeenCalledTimes(2);
	});
});
