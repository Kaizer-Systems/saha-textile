import { describe, expect, it } from 'vitest';

import { AuthService } from '../src/auth/auth.service';
import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';
import { loadConfig } from '../src/config/app-config';

/**
 * Setting a password from inside a session.
 *
 * This is the route out of the social-only corner: an account with no password cannot disconnect
 * its only provider, so this is how it earns a second way in. That makes it a route worth
 * attacking — a stolen session reaching it would mint a PERMANENT credential on somebody else's
 * account, one that survives the session being revoked.
 *
 * So the cases below are about proof, not about hashing: no proof, wrong proof, proof of the
 * wrong KIND, and the one nobody thinks of — that succeeding must not sign the caller out of the
 * screen they are standing on, while still evicting everyone else.
 */

const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });

const PRINCIPAL = { userId: 'cus_1', sessionId: 'sess_1', audience: 'storefront' } as never;
const STRONG = 'a-perfectly-adequate-passphrase';

type Harness = {
	controller: StorefrontAuthController;
	written: string[];
	revokedOthers: number;
	revokedAll: number;
};

/**
 * @param passwordHash `null` models a social signup that has never set one.
 * @param acceptOtp the code `verifyOtp` will accept, if any.
 */
function harness(options: { passwordHash: string | null; acceptOtp?: string }): Harness {
	const state = {
		id: 'cus_1',
		status: 'active',
		tokenVersion: 0,
		passwordHash: options.passwordHash,
	};
	const result: Harness = { controller: null as never, written: [], revokedOthers: 0, revokedAll: 0 };

	const customerAuth = {
		findAuthStateById: async () => state,
		setPasswordHash: async (_id: string, hash: string) => {
			result.written.push(hash);
			state.passwordHash = hash;
		},
	};

	const auth = {
		customerAuthRepository: customerAuth,
		/** The name `assertStepUp` reads off `this`. Same object, both spellings. */
		customerAuth,
		/**
		 * The REAL step-up rule, borrowed from the service and run against these fakes.
		 *
		 * The rule used to be a private method on the controller and was tested through it. It
		 * moved to `AuthService` when the contact-change routes needed the same check, and a stub
		 * here would have quietly ended the coverage: the cases below would keep passing against
		 * any rule at all. Binding the real function keeps them pointed at the thing that decides.
		 */
		assertStepUp: AuthService.prototype.assertStepUp,
		// Deliberately trivial: the argon2 adapter has its own coverage, and a real KDF here would
		// make the suite slow without testing anything this route owns.
		verifyPassword: async (subject: { passwordHash: string | null }, plain: string) =>
			subject.passwordHash === `hashed:${plain}`,
		hashPassword: async (plain: string) => `hashed:${plain}`,
		verifyOtp: async ({ code }: { code: string }) =>
			options.acceptOtp && code === options.acceptOtp ? { userId: 'cus_1' } : null,
		publicCustomer: async () => ({
			id: 'cus_1',
			email: 'probe@example.test',
			phone: '+919900000000',
			emailVerified: true,
			phoneVerified: true,
		}),
	};

	const sessions = {
		revokeOtherSessions: async () => {
			result.revokedOthers += 1;
			return 2;
		},
		revokeAllForUser: async () => {
			result.revokedAll += 1;
			return 3;
		},
	};

	const oauth = { listIdentities: async () => [] };

	result.controller = new StorefrontAuthController(
		auth as never,
		sessions as never,
		{} as never,
		{} as never,
		oauth as never,
		config,
	);
	return result;
}

describe('POST /auth/storefront/password/set', () => {
	it('refuses without a session', async () => {
		const { controller } = harness({ passwordHash: 'hashed:old-password-value' });

		await expect(controller.setPassword({ newPassword: STRONG }, undefined)).rejects.toThrow();
	});

	it('refuses when no proof is offered at all', async () => {
		const { controller, written } = harness({ passwordHash: 'hashed:old-password-value' });

		await expect(controller.setPassword({ newPassword: STRONG }, PRINCIPAL)).rejects.toThrow();
		expect(written).toEqual([]);
	});

	it('refuses a wrong current password', async () => {
		const { controller, written } = harness({ passwordHash: 'hashed:old-password-value' });

		await expect(
			controller.setPassword({ newPassword: STRONG, password: 'not-the-current-one' }, PRINCIPAL),
		).rejects.toThrow();
		expect(written).toEqual([]);
	});

	/**
	 * The proof of the wrong KIND. An account WITH a password must not be able to step up with a
	 * code instead — that would let anyone who can read the inbox bypass the password entirely,
	 * which is the weaker of the two and exactly why the server picks.
	 */
	it('refuses an OTP when the account has a password', async () => {
		const { controller, written } = harness({ passwordHash: 'hashed:old-password-value', acceptOtp: '123456' });

		await expect(controller.setPassword({ newPassword: STRONG, otpCode: '123456' }, PRINCIPAL)).rejects.toThrow();
		expect(written).toEqual([]);
	});

	it('accepts the current password and writes the new hash', async () => {
		const result = harness({ passwordHash: 'hashed:old-password-value' });

		const view = await result.controller.setPassword(
			{ newPassword: STRONG, password: 'old-password-value' },
			PRINCIPAL,
		);

		expect(result.written).toEqual([`hashed:${STRONG}`]);
		expect(view.passwordSet).toBe(true);
		expect(result.revokedAll).toBe(0);
	});

	/** The social-only path: no password, so a code is the only proof available. */
	it('lets a social-only account set its first password with a code', async () => {
		const { controller, written } = harness({ passwordHash: null, acceptOtp: '123456' });

		const view = await controller.setPassword({ newPassword: STRONG, otpCode: '123456' }, PRINCIPAL);

		expect(written).toEqual([`hashed:${STRONG}`]);
		expect(view.passwordSet).toBe(true);
	});

	it('refuses a wrong code on a social-only account', async () => {
		const { controller, written } = harness({ passwordHash: null, acceptOtp: '123456' });

		await expect(controller.setPassword({ newPassword: STRONG, otpCode: '000000' }, PRINCIPAL)).rejects.toThrow();
		expect(written).toEqual([]);
	});

	it('refuses a password the policy rejects, even with valid proof', async () => {
		const { controller, written } = harness({ passwordHash: 'hashed:old-password-value' });

		await expect(
			controller.setPassword({ newPassword: 'password1234', password: 'old-password-value' }, PRINCIPAL),
		).rejects.toThrow();
		expect(written).toEqual([]);
	});

	/**
	 * Other devices go; THIS one stays.
	 *
	 * A full revoke would sign the person out of the screen they just used, which reads as the
	 * change having failed. `password/reset` is the one that revokes everything, because it
	 * answers a suspected compromise and cannot trust any session — including the caller's.
	 */
	it('signs other devices out but keeps the session that just proved itself', async () => {
		const result = harness({ passwordHash: 'hashed:old-password-value' });

		await result.controller.setPassword({ newPassword: STRONG, password: 'old-password-value' }, PRINCIPAL);

		expect(result.revokedOthers).toBe(1);
		expect(result.revokedAll).toBe(0);
	});
});
