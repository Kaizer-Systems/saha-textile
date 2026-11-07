import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/auth.service';

/**
 * Admin password recovery start.
 *
 * The properties under test are the ones an attacker probes: that a customer account and a
 * disabled account are refused exactly like a real one, that lookup accepts a username as
 * well as an email, and that recovery issues a hash-only TOKEN rather than an OTP challenge
 * — the owner lock marks admin OTP login `DO NOT BUILD AS LOGIN`.
 */
function buildService(authState: unknown, consumed: unknown = null) {
	const resets = { create: vi.fn().mockResolvedValue(undefined), consume: vi.fn().mockResolvedValue(consumed) };
	const notifications = { send: vi.fn().mockResolvedValue({ status: 'sent' }) };
	const otps = { upsertActive: vi.fn() };
	const customerAuth = {
		findAuthStateByEmail: vi.fn(),
		setPasswordHash: vi.fn().mockResolvedValue(undefined),
	};
	const adminAuth = {
		findAuthStateByIdentifier: vi.fn().mockResolvedValue(authState),
		setPasswordHash: vi.fn().mockResolvedValue(undefined),
		setPinRevalidationRequired: vi.fn().mockResolvedValue(undefined),
		clearPinLock: vi.fn().mockResolvedValue(undefined),
		setPinHash: vi.fn().mockResolvedValue(undefined),
		recordFailedPinAttempt: vi.fn().mockResolvedValue(1),
		lockPinUntil: vi.fn().mockResolvedValue(undefined),
	};
	const authPort = { hashPassword: vi.fn().mockResolvedValue('$argon2id$hash'), verifyPassword: vi.fn() };

	const service = new AuthService(
		{
			jwt: { refreshSecret: 'test-pepper' },
			cookies: { csrfSecret: 'test-pepper' },
			otp: { ttlSeconds: 600, maxAttempts: 5 },
		} as never,
		authPort as never,
		customerAuth as never,
		adminAuth as never,
		{} as never,
		{} as never,
		otps as never,
		resets as never,
		{} as never,
		{} as never,
		notifications as never,
	);

	return { service, resets, notifications, otps, customerAuth, adminAuth, authPort };
}

const ADMIN = { id: 'user_admin', email: 'Operator@Example.com', role: 'admin', status: 'active' };

describe('AuthService.startAdminPasswordReset', () => {
	it('issues a hash-only token and mails the plaintext exactly once', async () => {
		const { service, resets, notifications } = buildService(ADMIN);
		await service.startAdminPasswordReset('operator');

		expect(resets.create).toHaveBeenCalledTimes(1);
		const stored = resets.create.mock.calls[0]![0] as Record<string, unknown>;
		const sent = notifications.send.mock.calls[0]![0] as { variables: Record<string, string>; destination: string };

		// The persisted row must not contain anything that can be presented as a credential.
		expect(Object.keys(stored)).not.toContain('token');
		expect(String(stored.tokenHash)).toHaveLength(64);
		expect(String(stored.tokenHash)).not.toBe(sent.variables.token);
		expect(stored.audience).toBe('admin');
		expect(stored.consumedAt).toBeNull();
		// Address is normalized, so a mixed-case identifier still reaches the same mailbox.
		expect(sent.destination).toBe('operator@example.com');
	});

	it('never creates an OTP challenge — recovery is a token, not a login code', async () => {
		const { service, otps } = buildService(ADMIN);
		await service.startAdminPasswordReset('operator');
		expect(otps.upsertActive).not.toHaveBeenCalled();
	});

	it('expires the token within the hour', async () => {
		const { service, resets } = buildService(ADMIN);
		await service.startAdminPasswordReset('operator');
		const stored = resets.create.mock.calls[0]![0] as { createdAt: string; expiresAt: string };
		const lifetimeMinutes = (Date.parse(stored.expiresAt) - Date.parse(stored.createdAt)) / 60_000;
		expect(lifetimeMinutes).toBeLessThanOrEqual(60);
		expect(lifetimeMinutes).toBeGreaterThan(0);
	});

	for (const [label, state] of [
		['an unknown identifier', null],
		['a customer-only address', null],
		['a disabled account', { ...ADMIN, status: 'disabled' }],
		['an admin with no email address', { ...ADMIN, email: null }],
	] as const) {
		it(`sends nothing for ${label}, and does so silently`, async () => {
			const { service, resets, notifications } = buildService(state);
			// Resolves rather than throwing: the controller answers generically, so any
			// thrown error would become an observable difference between cases.
			await expect(service.startAdminPasswordReset('operator')).resolves.toBeUndefined();
			expect(resets.create).not.toHaveBeenCalled();
			expect(notifications.send).not.toHaveBeenCalled();
		});
	}
});

const ADMIN_TOKEN_ROW = { userId: 'user_admin', audience: 'admin', consumedAt: '2026-08-02T10:00:00.000Z' };

describe('AuthService.completePasswordReset audience binding', () => {
	it('accepts a token issued for the admin surface', async () => {
		const { service, adminAuth } = buildService(ADMIN, ADMIN_TOKEN_ROW);
		await expect(service.completePasswordReset('tok', 'a-long-enough-password', 'admin')).resolves.toEqual({
			userId: 'user_admin',
		});
		expect(adminAuth.setPasswordHash).toHaveBeenCalledWith('user_admin', '$argon2id$hash');
	});

	it('refuses a storefront token presented to the admin surface, and changes nothing', async () => {
		const { service, adminAuth } = buildService(ADMIN, { ...ADMIN_TOKEN_ROW, audience: 'storefront' });
		await expect(service.completePasswordReset('tok', 'a-long-enough-password', 'admin')).resolves.toBeNull();
		// The password must NOT have been changed — a cross-audience token is not authorization.
		expect(adminAuth.setPasswordHash).not.toHaveBeenCalled();
	});

	it('still consumes a mismatched token so it cannot be retried elsewhere', async () => {
		const { service, resets } = buildService(ADMIN, { ...ADMIN_TOKEN_ROW, audience: 'storefront' });
		await service.completePasswordReset('tok', 'a-long-enough-password', 'admin');
		expect(resets.consume).toHaveBeenCalledTimes(1);
	});

	it('stays backward compatible when no audience is required', async () => {
		const { service, customerAuth } = buildService(ADMIN, { ...ADMIN_TOKEN_ROW, audience: 'storefront' });
		await expect(service.completePasswordReset('tok', 'a-long-enough-password')).resolves.toEqual({
			userId: 'user_admin',
		});
		expect(customerAuth.setPasswordHash).toHaveBeenCalled();
	});
});

describe('PIN revalidation after a privileged reset', () => {
	const pinned = { ...ADMIN, pinHash: '$argon2id$pin', pinLockedUntil: null, pinRevalidationRequiredAt: null };

	it('records the suspension without deleting the PIN', async () => {
		const { service, adminAuth } = buildService(pinned);
		await service.requirePinRevalidation('user_admin');

		expect(adminAuth.setPinRevalidationRequired).toHaveBeenCalledTimes(1);
		// The hash is kept: the owner decision is an auditable state change, not a silent
		// credential deletion. Clearing it here would destroy the operator's second login
		// method with no record of why.
		expect(adminAuth.setPinHash).not.toHaveBeenCalled();
	});

	it('refuses a correct PIN while revalidation is outstanding', async () => {
		const { service, authPort } = buildService(pinned);
		const outcome = await service.verifyAdminPin(
			{ ...pinned, pinRevalidationRequiredAt: '2026-08-02T10:00:00.000Z' } as never,
			'135790',
		);

		expect(outcome).toBe('revalidation_required');
		// Short-circuits before the hash comparison: knowing the PIN is irrelevant here.
		expect(authPort.verifyPassword).not.toHaveBeenCalled();
	});

	it('takes precedence over the expiring brute-force lock', async () => {
		const { service } = buildService(pinned);
		const outcome = await service.verifyAdminPin(
			{
				...pinned,
				pinRevalidationRequiredAt: '2026-08-02T10:00:00.000Z',
				pinLockedUntil: '2000-01-01T00:00:00.000Z',
			} as never,
			'135790',
		);
		// The fifteen-minute lock has long expired; the suspension must not expire with it.
		expect(outcome).toBe('revalidation_required');
	});

	it('allows the PIN again once the suspension is cleared', async () => {
		const { service, authPort } = buildService(pinned);
		authPort.verifyPassword.mockResolvedValue(true);
		const outcome = await service.verifyAdminPin({ ...pinned, pinRevalidationRequiredAt: null } as never, '135790');
		expect(outcome).toBe('ok');
	});
});
