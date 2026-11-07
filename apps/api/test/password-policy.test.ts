import { BadRequestException } from '@nestjs/common';
import type { AdminInvite, AuditLog } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminInviteService } from '../src/auth/admin-invite.service';
import { AdminSecurityService } from '../src/auth/admin-security.service';
import { AuthService } from '../src/auth/auth.service';

/**
 * Weak-password policy at the surfaces that can set one.
 *
 * `packages/core-domain/test/password-policy.test.ts` proves WHICH passwords are weak. These
 * prove the verdict is consulted, and — the part worth a test of its own — that refusing costs
 * the caller nothing they cannot get back. A policy bolted on carelessly rejects the password
 * after burning a single-use token, or after spending an Argon2 verify on a request that was
 * never going to succeed.
 *
 * The storefront registration ordering, which is anti-enumeration rather than economy, is
 * proven over HTTP in `apps/api/e2e/session-rotation.mjs` where both a known and an unknown
 * address can be submitted against the same live handler.
 */

const WEAK = 'Password1234';
const STRONG = 'harbour-tram-19';

function buildAuthService(consumed: unknown = { userId: 'user_1', audience: 'admin' }) {
	const resets = { create: vi.fn(), consume: vi.fn().mockResolvedValue(consumed) };
	const customerAuth = { setPasswordHash: vi.fn().mockResolvedValue(undefined) };
	const adminAuth = { setPasswordHash: vi.fn().mockResolvedValue(undefined) };
	const authPort = { hashPassword: vi.fn().mockResolvedValue('$argon2id$hash') };

	const service = new AuthService(
		{
			jwt: { refreshSecret: 'p' },
			cookies: { csrfSecret: 'p' },
			otp: { ttlSeconds: 600, maxAttempts: 5 },
		} as never,
		authPort as never,
		customerAuth as never,
		adminAuth as never,
		{} as never,
		{} as never,
		{} as never,
		resets as never,
		{} as never,
		{} as never,
		{ send: vi.fn() } as never,
	);

	return { service, resets, customerAuth, adminAuth };
}

const invite: AdminInvite = {
	id: 'inv_1',
	emailNormalized: 'new.admin@example.com',
	role: 'staff',
	permissions: [],
	invitedByUserId: 'user_admin',
	tokenHash: 'hash(tok)',
	createdAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 3600_000).toISOString(),
	acceptedAt: null,
	revokedAt: null,
};

function buildInviteService() {
	const consume = vi.fn(async () => invite);
	const auth = {
		normalizeEmail: (email: string) => email.trim().toLowerCase(),
		hash: (value: string) => `hash(${value})`,
		hashPassword: async (value: string) => `argon2(${value})`,
	} as unknown as AuthService;

	const service = new AdminInviteService(
		auth,
		{ create: vi.fn(), consume, listPending: vi.fn(), revoke: vi.fn() } as never,
		{
			findAuthStateByIdentifier: async () => null,
			setPasswordHash: vi.fn(async () => undefined),
			setPinHash: vi.fn(async () => undefined),
			setPreferredLoginMethod: vi.fn(async () => undefined),
		} as never,
		{ save: async (user: Record<string, unknown>) => user } as never,
		{ append: async (entry: AuditLog) => entry } as never,
		{ send: async () => ({ status: 'sent' as const }) } as never,
		{ withTransaction: async (work: (ctx: object) => Promise<unknown>) => work({}) } as never,
	);
	return { service, consume };
}

function buildSecurityService() {
	const setPasswordHash = vi.fn(async () => undefined);
	const verifyPassword = vi.fn(async () => true);
	const auth = {
		verifyPassword,
		hashPassword: async (value: string) => `argon2(${value})`,
		adminAuthRepository: {
			setPasswordHash,
			findAuthStateById: async () => ({ id: 'user_admin', pinHash: null, passwordHash: 'hash' }),
		},
	} as unknown as AuthService;

	const service = new AdminSecurityService(
		auth,
		{ revokeAllForUser: async () => 0 } as never,
		{ append: async (entry: AuditLog) => entry } as never,
	);
	return { service, setPasswordHash, verifyPassword };
}

const issuesOf = (error: unknown) =>
	((error as BadRequestException).getResponse() as { issues?: Array<{ path?: string; code?: string }> }).issues ?? [];

describe('Password reset — completePasswordReset', () => {
	/**
	 * The one that matters here. The recovery token is atomic and single-use, and its owner is
	 * by definition somebody who CANNOT sign in. Refusing the password after consuming it would
	 * strand them entirely: no session, and a spent link.
	 */
	it('refuses a weak password without consuming the recovery token', async () => {
		const { service, resets, adminAuth } = buildAuthService();

		await expect(service.completePasswordReset('tok', WEAK, 'admin')).rejects.toBeInstanceOf(BadRequestException);
		expect(resets.consume).not.toHaveBeenCalled();
		expect(adminAuth.setPasswordHash).not.toHaveBeenCalled();
	});

	it('names the field and a stable machine-readable code, never the password', async () => {
		const { service } = buildAuthService();

		const error = await service.completePasswordReset('tok', WEAK, 'admin').catch((e) => e);
		expect(issuesOf(error)).toEqual([{ path: 'password', message: expect.any(String), code: 'password_common' }]);
		expect(JSON.stringify(issuesOf(error))).not.toContain(WEAK);
	});

	it('consumes the token for a password the policy accepts', async () => {
		const { service, resets, adminAuth } = buildAuthService();

		await service.completePasswordReset('tok', STRONG, 'admin');
		expect(resets.consume).toHaveBeenCalledTimes(1);
		expect(adminAuth.setPasswordHash).toHaveBeenCalledTimes(1);
	});
});

describe('Invite acceptance — initial password', () => {
	it('refuses a weak password without consuming the invitation', async () => {
		const { service, consume } = buildInviteService();

		await expect(service.accept({ token: 'tok', password: WEAK })).rejects.toBeInstanceOf(BadRequestException);
		expect(consume).not.toHaveBeenCalled();
	});

	it('accepts an invitation whose password the policy allows', async () => {
		const { service, consume } = buildInviteService();

		await service.accept({ token: 'tok', password: STRONG });
		expect(consume).toHaveBeenCalledTimes(1);
	});
});

describe('Security Settings — changePassword', () => {
	it('refuses a weak new password and writes nothing', async () => {
		const { service, setPasswordHash } = buildSecurityService();

		await expect(
			service.changePassword('user_admin', { currentPassword: 'pw', newPassword: WEAK }, null),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(setPasswordHash).not.toHaveBeenCalled();
	});

	// Same economy as the PIN path: the verdict is cheap and non-secret, Argon2 is not.
	it('does not verify the current password for a new one that can never be accepted', async () => {
		const { service, verifyPassword } = buildSecurityService();

		await service
			.changePassword('user_admin', { currentPassword: 'pw', newPassword: 'aaaaaaaaaaaa' }, null)
			.catch(() => undefined);
		expect(verifyPassword).not.toHaveBeenCalled();
	});

	it('accepts a new password the policy allows', async () => {
		const { service, setPasswordHash } = buildSecurityService();

		await service.changePassword('user_admin', { currentPassword: 'pw', newPassword: STRONG }, null);
		expect(setPasswordHash).toHaveBeenCalledWith('user_admin', `argon2(${STRONG})`);
	});
});
