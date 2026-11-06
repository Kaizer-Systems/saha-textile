import { HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/auth.service';

const harness = (overrides: { csrfSecret?: string; fixedCode?: string } = {}) => {
	const authPort = {
		verifyPassword: vi.fn(async () => true),
		hashPassword: vi.fn(async () => 'hashed'),
	};
	const customerAuth = {
		findAuthStateByIdentifier: vi.fn(async () => null as unknown),
		findAuthStateByEmail: vi.fn(async () => 'by-email' as unknown),
		findAuthStateById: vi.fn(async () => null as unknown),
		setPasswordHash: vi.fn(async () => {}),
		setStatus: vi.fn(async () => {}),
		markEmailVerified: vi.fn(async () => {}),
	};
	const adminAuth = {
		findAuthStateByIdentifier: vi.fn(async () => 'admin-state' as unknown),
		findAuthStateById: vi.fn(async () => 'admin-state' as unknown),
		setPasswordHash: vi.fn(async () => {}),
		clearPinLock: vi.fn(async () => {}),
		recordFailedPinAttempt: vi.fn(async () => 1),
		lockPinUntil: vi.fn(async () => {}),
	};
	const customers = {
		findById: vi.fn(async () => ({ id: 'cus_1', email: 'a@example.test', phone: '+91' }) as unknown),
	};
	const adminUsers = { findById: vi.fn(async () => ({ id: 'adm_1' }) as unknown) };
	const otps = {
		upsertActive: vi.fn(async () => {}),
		findActive: vi.fn(async () => null as unknown),
		incrementAttempts: vi.fn(async () => 1),
		consume: vi.fn(async () => true),
	};
	const resets = { create: vi.fn(async () => {}), consume: vi.fn(async () => null as unknown) };
	const verifications = { create: vi.fn(async () => {}), consume: vi.fn(async () => null as unknown) };
	const rateLimits = { peek: vi.fn(async () => 0), hit: vi.fn(async () => 1), reset: vi.fn(async () => {}) };
	const notifications = { send: vi.fn(async () => ({})) };
	const service = new AuthService(
		{
			jwt: { refreshSecret: 'refresh-pepper' },
			cookies: { csrfSecret: overrides.csrfSecret },
			otp: { ttlSeconds: 600, maxAttempts: 2, localFixedCode: overrides.fixedCode },
			auth: {},
			storefrontOrigin: 'https://shop.test',
			adminOrigin: 'https://admin.test',
		} as never,
		authPort as never,
		customerAuth as never,
		adminAuth as never,
		customers as never,
		adminUsers as never,
		otps as never,
		resets as never,
		verifications as never,
		rateLimits as never,
		notifications as never,
	);
	return {
		service,
		authPort,
		customerAuth,
		adminAuth,
		customers,
		adminUsers,
		otps,
		resets,
		verifications,
		rateLimits,
		notifications,
	};
};

let h: ReturnType<typeof harness>;

beforeEach(() => {
	h = harness({ csrfSecret: 'pepper' });
});

describe('hashing', () => {
	it('falls back to the refresh secret as pepper', () => {
		expect(harness().service.hash('x')).not.toBe(h.service.hash('x'));
		expect(harness().service.hash('x')).toBe(harness().service.hash('x'));
	});
});

describe('rate limits', () => {
	it('reads an action with both scopes, and counts only when allowed', async () => {
		const scopes = { identifier: 'a@example.test', ip: '1.2.3.4' };
		expect((await h.service.consumeRateLimit('otp_request', scopes)).allowed).toBe(true);
		expect(h.rateLimits.hit).toHaveBeenCalledTimes(2);
		h.rateLimits.peek.mockResolvedValue(10_000);
		expect((await h.service.consumeRateLimit('otp_request', scopes)).allowed).toBe(false);
		expect(h.rateLimits.hit).toHaveBeenCalledTimes(2);
	});

	it('skips the identifier when there is none, or the action has no such budget', async () => {
		await h.service.checkRateLimit('otp_request', { ip: '1.2.3.4' });
		expect(h.rateLimits.peek).toHaveBeenCalledTimes(1);
		h.rateLimits.peek.mockClear();
		await h.service.checkRateLimit('admin_pin_login', { identifier: 'x', ip: '1.2.3.4' });
		expect(h.rateLimits.peek).toHaveBeenCalledTimes(1);
		await h.service.recordRateLimitFailure('otp_request', { ip: '1.2.3.4' });
		await h.service.recordRateLimitFailure('admin_pin_login', { identifier: 'x', ip: '1.2.3.4' });
		expect(h.rateLimits.hit).toHaveBeenCalledTimes(2);
	});

	it('handles an action with no address budget', async () => {
		const policy = (await import('@saha-textile/core-domain')).AUTH_RATE_LIMIT_POLICY;
		const action = Object.keys(policy).find((key) => !policy[key as keyof typeof policy].ip);
		if (action) {
			await h.service.checkRateLimit(action as never, { identifier: 'x', ip: '1.2.3.4' });
			await h.service.recordRateLimitFailure(action as never, { identifier: 'x', ip: '1.2.3.4' });
		}
		const original = policy.otp_request;
		(policy as Record<string, unknown>)['otp_request'] = { ...original, ip: undefined };
		await h.service.checkRateLimit('otp_request', { identifier: 'x', ip: '1.2.3.4' });
		await h.service.recordRateLimitFailure('otp_request', { identifier: 'x', ip: '1.2.3.4' });
		(policy as Record<string, unknown>)['otp_request'] = original;
		expect(h.rateLimits.hit).toHaveBeenCalled();
	});

	it('clears only a budget that exists', async () => {
		await h.service.clearRateLimitIdentifier('admin_pin_login', 'x');
		expect(h.rateLimits.reset).not.toHaveBeenCalled();
		await h.service.clearRateLimitIdentifier('otp_request', 'x');
		expect(h.rateLimits.reset).toHaveBeenCalledTimes(1);
	});
});

describe('passwords', () => {
	it('spends the same effort for an unknown account', async () => {
		expect(await h.service.verifyPassword(null, 'p')).toBe(false);
		h.authPort.verifyPassword.mockRejectedValueOnce(new Error('bad hash'));
		expect(await h.service.verifyPassword({ passwordHash: null } as never, 'p')).toBe(false);
		expect(h.authPort.verifyPassword).toHaveBeenCalledTimes(2);
	});

	it('checks a real hash', async () => {
		expect(await h.service.verifyPassword({ passwordHash: 'h' } as never, 'p')).toBe(true);
		expect(await h.service.hashPassword('p')).toBe('hashed');
	});
});

describe('one-time codes', () => {
	it('stores only a hash and sends the code', async () => {
		await h.service.issueOtp({ identifier: 'a@example.test', purpose: 'login', channel: 'email', userId: 'cus_1' });
		const stored = (h.otps.upsertActive.mock.calls[0] as unknown as [{ codeHash: string; userId: string }])[0];
		const sent = (h.notifications.send.mock.calls[0] as unknown as [{ variables: { code: string } }])[0];
		expect(sent.variables.code).toMatch(/^\d{6}$/);
		expect(stored.codeHash).toBe(h.service.hash(sent.variables.code));
		expect(stored.userId).toBe('cus_1');
	});

	it('uses the fixed local code and no user', async () => {
		const local = harness({ fixedCode: '123456' });
		await local.service.issueOtp({ identifier: 'a', purpose: 'login', channel: 'email' });
		expect(
			(local.notifications.send.mock.calls[0] as unknown as [{ variables: { code: string } }])[0].variables.code,
		).toBe('123456');
		expect((local.otps.upsertActive.mock.calls[0] as unknown as [{ userId: unknown }])[0].userId).toBeNull();
	});

	const challenge = (overrides: Record<string, unknown> = {}) => ({
		id: 'o1',
		userId: 'cus_1',
		attempts: 0,
		maxAttempts: 2,
		codeHash: harness({ csrfSecret: 'pepper' }).service.hash('111111'),
		...overrides,
	});
	const verify = (code = '111111') => h.service.verifyOtp({ identifier: 'a', purpose: 'login', code });

	it('refuses with no challenge, or too many attempts', async () => {
		expect(await verify()).toBeNull();
		h.otps.findActive.mockResolvedValue(challenge({ attempts: 2 }));
		expect(await verify()).toBeNull();
		h.otps.findActive.mockResolvedValue(challenge());
		h.otps.incrementAttempts.mockResolvedValue(3);
		expect(await verify()).toBeNull();
	});

	it('refuses a wrong code, and a code that lost the race', async () => {
		h.otps.findActive.mockResolvedValue(challenge());
		expect(await verify('222222')).toBeNull();
		h.otps.consume.mockResolvedValue(false);
		expect(await verify()).toBeNull();
	});

	it('accepts the right code', async () => {
		h.otps.findActive.mockResolvedValue(challenge());
		expect(await verify()).toEqual({ userId: 'cus_1' });
	});
});

describe('password reset', () => {
	const ok = 'Strong-Pass-123!';

	it('starts only for an active account with an email', async () => {
		await h.service.startPasswordReset('a', 'storefront');
		h.customerAuth.findAuthStateByIdentifier.mockResolvedValue({ status: 'disabled', email: 'a@example.test' });
		await h.service.startPasswordReset('a', 'storefront');
		h.customerAuth.findAuthStateByIdentifier.mockResolvedValue({ status: 'active', email: null });
		await h.service.startPasswordReset('a', 'storefront');
		expect(h.resets.create).not.toHaveBeenCalled();
		h.customerAuth.findAuthStateByIdentifier.mockResolvedValue({
			id: 'cus_1',
			status: 'active',
			email: 'A@Example.test',
		});
		await h.service.startPasswordReset(' a ', 'storefront');
		expect(h.resets.create).toHaveBeenCalledTimes(1);
	});

	it('refuses a token it cannot use', async () => {
		expect(await h.service.completePasswordReset('t', ok)).toBeNull();
		h.resets.consume.mockResolvedValue({ userId: 'cus_1', audience: 'storefront' });
		expect(await h.service.completePasswordReset('t', ok, 'admin')).toBeNull();
	});

	it('sets the password for the right kind of account', async () => {
		h.resets.consume.mockResolvedValue({ userId: 'cus_1', audience: 'storefront' });
		await h.service.completePasswordReset('t', ok);
		expect(h.customerAuth.setPasswordHash).toHaveBeenCalledTimes(1);
		h.resets.consume.mockResolvedValue({ userId: 'adm_1', audience: 'admin' });
		await h.service.completePasswordReset('t', ok, 'admin');
		expect(h.adminAuth.setPasswordHash).toHaveBeenCalledTimes(1);
	});
});

describe('activation', () => {
	const ok = 'Strong-Pass-123!';
	const token = () => h.resets.consume.mockResolvedValue({ userId: 'cus_1', audience: 'storefront' });

	it('refuses a bad token or a deleted or missing account', async () => {
		expect(await h.service.activateCustomer('t', ok)).toBeNull();
		token();
		expect(await h.service.activateCustomer('t', ok)).toBeNull();
		h.customerAuth.findAuthStateById.mockResolvedValue({ status: 'deleted' });
		expect(await h.service.activateCustomer('t', ok)).toBeNull();
	});

	it.each(['pending', 'disabled'])('activates a %s account and verifies its email', async (status) => {
		token();
		h.customerAuth.findAuthStateById.mockResolvedValue({ status, email: 'A@Example.test' });
		expect(await h.service.activateCustomer('t', ok)).toEqual({ userId: 'cus_1' });
		expect(h.customerAuth.setStatus).toHaveBeenCalledWith('cus_1', 'active');
		expect(h.customerAuth.markEmailVerified).toHaveBeenCalledWith('cus_1', 'a@example.test');
	});

	it('leaves an active account as it is, and skips a missing email', async () => {
		token();
		h.customerAuth.findAuthStateById.mockResolvedValue({ status: 'active', email: null });
		await h.service.activateCustomer('t', ok);
		expect(h.customerAuth.setStatus).not.toHaveBeenCalled();
		expect(h.customerAuth.markEmailVerified).not.toHaveBeenCalled();
	});
});

describe('email verification', () => {
	it('sends a link', async () => {
		await h.service.issueEmailVerification('cus_1', 'A@Example.test');
		expect(
			(h.verifications.create.mock.calls[0] as unknown as [{ emailNormalized: string }])[0].emailNormalized,
		).toBe('a@example.test');
		expect(h.notifications.send).toHaveBeenCalledTimes(1);
	});

	it('refuses a bad token and an admin token', async () => {
		expect(await h.service.completeEmailVerification('t')).toBe(false);
		h.verifications.consume.mockResolvedValue({ userId: 'adm_1', emailNormalized: 'a@example.test' });
		expect(await h.service.completeEmailVerification('t')).toBe(false);
		expect(h.customerAuth.markEmailVerified).not.toHaveBeenCalled();
	});

	it('marks a customer verified', async () => {
		h.verifications.consume.mockResolvedValue({ userId: 'cus_1', emailNormalized: 'a@example.test' });
		expect(await h.service.completeEmailVerification('t')).toBe(true);
	});
});

describe('admin PIN', () => {
	const user = (overrides: Record<string, unknown> = {}) =>
		({ id: 'adm_1', pinHash: 'h', pinLockedUntil: null, pinRevalidationRequiredAt: null, ...overrides }) as never;

	it('explains why a PIN cannot be used', async () => {
		expect(await h.service.verifyAdminPin(user({ pinRevalidationRequiredAt: 'x' }), '1')).toBe(
			'revalidation_required',
		);
		expect(await h.service.verifyAdminPin(user({ pinLockedUntil: '2099-01-01T00:00:00.000Z' }), '1')).toBe(
			'locked',
		);
		expect(await h.service.verifyAdminPin(user({ pinHash: null }), '1')).toBe('invalid');
	});

	it('lets a past lock expire and clears it on success', async () => {
		expect(await h.service.verifyAdminPin(user({ pinLockedUntil: '2000-01-01T00:00:00.000Z' }), '1')).toBe('ok');
		expect(h.adminAuth.clearPinLock).toHaveBeenCalledWith('adm_1');
	});

	it('counts a wrong PIN and locks at the limit', async () => {
		h.authPort.verifyPassword.mockResolvedValue(false);
		expect(await h.service.verifyAdminPin(user(), '1')).toBe('invalid');
		h.adminAuth.recordFailedPinAttempt.mockResolvedValue(5);
		expect(await h.service.verifyAdminPin(user(), '1')).toBe('locked');
		expect(h.adminAuth.lockPinUntil).toHaveBeenCalledTimes(1);
	});
});

describe('lookups', () => {
	it('normalises what it looks up', async () => {
		expect(await h.service.findAuthUserByEmail(' A@Example.test ')).toBe('by-email');
		expect(h.customerAuth.findAuthStateByEmail).toHaveBeenCalledWith('a@example.test');
		await h.service.findCustomerByIdentifier(' +91 ');
		expect(h.customerAuth.findAuthStateByIdentifier).toHaveBeenCalledWith('+91');
		await h.service.findAuthUserByIdentifier(' Admin ');
		expect(h.adminAuth.findAuthStateByIdentifier).toHaveBeenCalledWith('admin');
	});

	it('reads the right population by id', async () => {
		expect(await h.service.findAuthUserById('adm_1')).toBe('admin-state');
		await h.service.findAuthUserById('cus_1');
		expect(h.customerAuth.findAuthStateById).toHaveBeenCalledWith('cus_1');
		expect(await h.service.publicUser('adm_1')).toEqual({ id: 'adm_1' });
		expect(((await h.service.publicUser('cus_1')) as { id: string }).id).toBe('cus_1');
	});

	it('refuses an account that is gone', async () => {
		h.customers.findById.mockResolvedValue(null);
		await expect(h.service.publicCustomer('x')).rejects.toBeInstanceOf(UnauthorizedException);
		h.adminUsers.findById.mockResolvedValue(null);
		await expect(h.service.publicAdminUser('x')).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('exposes its repositories', () => {
		expect(h.service.customerRepository).toBe(h.customers);
		expect(h.service.customerAuthRepository).toBe(h.customerAuth);
		expect(h.service.adminAuthRepository).toBe(h.adminAuth);
		expect(h.service.adminUserRepository).toBe(h.adminUsers);
	});
});

describe('step-up', () => {
	it('uses a password when one is set', async () => {
		h.customerAuth.findAuthStateById.mockResolvedValue({ passwordHash: 'h' });
		await expect(h.service.assertStepUp('cus_1', {})).rejects.toBeInstanceOf(HttpException);
		await expect(h.service.assertStepUp('cus_1', { password: 'p' })).resolves.toBeUndefined();
		h.authPort.verifyPassword.mockResolvedValue(false);
		await expect(h.service.assertStepUp('cus_1', { password: 'p' })).rejects.toBeInstanceOf(HttpException);
	});

	it('uses a code otherwise, trying each channel', async () => {
		await expect(h.service.assertStepUp('cus_1', {})).rejects.toBeInstanceOf(HttpException);
		await expect(h.service.assertStepUp('cus_1', { otpCode: '1' })).rejects.toBeInstanceOf(HttpException);
		expect(h.otps.findActive).toHaveBeenCalledTimes(2);
		h.customers.findById.mockResolvedValue({ email: null, phone: '+91' });
		h.otps.findActive.mockResolvedValue({
			id: 'o',
			userId: null,
			attempts: 0,
			maxAttempts: 2,
			codeHash: h.service.hash('1'),
		});
		await expect(h.service.assertStepUp('cus_1', { otpCode: '1' })).resolves.toBeUndefined();
	});
});
