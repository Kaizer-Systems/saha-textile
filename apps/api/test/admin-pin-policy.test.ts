import { BadRequestException } from '@nestjs/common';
import type { AdminInvite, AuditLog } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminInviteService } from '../src/auth/admin-invite.service';
import { AdminSecurityService } from '../src/auth/admin-security.service';
import type { AuthService } from '../src/auth/auth.service';

/**
 * Weak-PIN policy at the two surfaces that can create one.
 *
 * `packages/core-domain/test/pin-policy.test.ts` proves WHICH PINs are weak. These prove the
 * verdict is actually consulted, at both call sites, and — more importantly — that refusing
 * costs the caller nothing they cannot get back. A policy bolted on carelessly rejects the
 * PIN after burning the invite, or after spending an Argon2 verify on a request that was
 * never going to succeed.
 */

const WEAK = '123456';
const STRONG = '384917';

function buildSecurityService() {
	const audits: AuditLog[] = [];
	const setPinHash = vi.fn(async () => undefined);
	const setPreferredLoginMethod = vi.fn(async () => undefined);
	const verifyPassword = vi.fn(async () => true);

	const auth = {
		verifyPassword,
		hashPassword: async (value: string) => `argon2(${value})`,
		adminAuthRepository: {
			setPinHash,
			setPreferredLoginMethod,
			findAuthStateById: async () => ({
				id: 'adm_admin',
				pinHash: null,
				passwordHash: 'hash',
				preferredLoginMethod: 'password',
				pinLockedUntil: null,
				pinRevalidationRequiredAt: null,
				emailVerified: true,
			}),
		},
	} as unknown as AuthService;

	const sessions = { countActiveForUser: async () => 1, revokeAllForUser: async () => 0 };
	const audit = {
		append: async (entry: AuditLog) => {
			audits.push(entry);
			return entry;
		},
	};

	const service = new AdminSecurityService(auth, sessions as never, audit as never);
	return { service, audits, setPinHash, setPreferredLoginMethod, verifyPassword };
}

const invite: AdminInvite = {
	id: 'inv_1',
	emailNormalized: 'new.admin@example.com',
	role: 'staff',
	permissions: ['catalog.read'],
	invitedByUserId: 'user_admin',
	tokenHash: 'hash(tok)',
	createdAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 3600_000).toISOString(),
	acceptedAt: null,
	revokedAt: null,
};

function buildInviteService() {
	const consume = vi.fn(async () => invite);
	const setPinHash = vi.fn(async () => undefined);

	const auth = {
		normalizeEmail: (email: string) => email.trim().toLowerCase(),
		hash: (value: string) => `hash(${value})`,
		hashPassword: async (value: string) => `argon2(${value})`,
	} as unknown as AuthService;

	const invites = { create: async (i: AdminInvite) => i, consume, listPending: async () => [], revoke: vi.fn() };
	const authUsers = {
		findAuthStateByIdentifier: async () => null,
		setPasswordHash: vi.fn(async () => undefined),
		setPinHash,
		setPreferredLoginMethod: vi.fn(async () => undefined),
	};
	const users = { save: async (user: Record<string, unknown>) => user };
	const audit = { append: async (entry: AuditLog) => entry };
	const notifications = { send: async () => ({ status: 'sent' as const }) };
	const transactions = { withTransaction: async (work: (ctx: object) => Promise<unknown>) => work({}) };

	const service = new AdminInviteService(
		auth,
		invites as never,
		authUsers as never,
		users as never,
		audit as never,
		notifications as never,
		transactions as never,
	);
	return { service, consume, setPinHash };
}

/** Pulls the transport-shaped issues out of the refusal the filter will render. */
const issuesOf = (error: unknown) =>
	((error as BadRequestException).getResponse() as { issues?: Array<{ path?: string; code?: string }> }).issues ?? [];

describe('Security Settings — setPin', () => {
	it('refuses a weak PIN and writes nothing', async () => {
		const { service, setPinHash, audits } = buildSecurityService();

		await expect(service.setPin('user_admin', { currentPassword: 'pw', pin: WEAK }, null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(setPinHash).not.toHaveBeenCalled();
		// A refused change is not a security event to record; the credential never moved.
		expect(audits).toEqual([]);
	});

	it('names the field and a stable machine-readable code, never the PIN', async () => {
		const { service } = buildSecurityService();

		const error = await service.setPin('user_admin', { currentPassword: 'pw', pin: WEAK }, null).catch((e) => e);
		expect(issuesOf(error)).toEqual([{ path: 'pin', message: expect.any(String), code: 'pin_sequential' }]);
		expect(JSON.stringify(issuesOf(error))).not.toContain(WEAK);
	});

	/**
	 * The ordering assertion, and the reason it is worth a test of its own: the strength
	 * verdict is cheap and reveals nothing, the password verify is deliberately expensive.
	 * Checking the PIN first means a caller cannot spend our CPU on Argon2 by submitting
	 * `000000` in a loop.
	 */
	it('does not verify the password for a PIN that can never be accepted', async () => {
		const { service, verifyPassword } = buildSecurityService();

		await service.setPin('user_admin', { currentPassword: 'pw', pin: '000000' }, null).catch(() => undefined);
		expect(verifyPassword).not.toHaveBeenCalled();
	});

	it('accepts a PIN that no rule refuses', async () => {
		const { service, setPinHash } = buildSecurityService();

		await service.setPin('adm_admin', { currentPassword: 'pw', pin: STRONG }, null);
		expect(setPinHash).toHaveBeenCalledWith('adm_admin', `argon2(${STRONG})`);
	});
});

describe('Invite acceptance — optional onboarding PIN', () => {
	/**
	 * The one that matters. `consume` is atomic and single-use, so refusing the PIN after it
	 * would spend the invitation on a failed request — the invitee locked out, and an
	 * administrator reissuing a link because somebody typed a sequence.
	 */
	it('refuses a weak PIN without consuming the invitation', async () => {
		const { service, consume, setPinHash } = buildInviteService();

		await expect(service.accept({ token: 'tok', password: 'CorrectHorse12', pin: WEAK })).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(consume).not.toHaveBeenCalled();
		expect(setPinHash).not.toHaveBeenCalled();
	});

	it('accepts an invitation carrying a strong PIN', async () => {
		const { service, consume, setPinHash } = buildInviteService();

		const user = await service.accept({ token: 'tok', password: 'CorrectHorse12', pin: STRONG });
		expect(consume).toHaveBeenCalledTimes(1);
		expect(setPinHash).toHaveBeenCalledWith(user.id, `argon2(${STRONG})`);
	});

	// PIN setup is skippable (owner lock 2026-07-23), so no PIN must remain the easy path.
	it('leaves an invitation without a PIN entirely unaffected', async () => {
		const { service, consume, setPinHash } = buildInviteService();

		await service.accept({ token: 'tok', password: 'CorrectHorse12' });
		expect(consume).toHaveBeenCalledTimes(1);
		expect(setPinHash).not.toHaveBeenCalled();
	});
});
