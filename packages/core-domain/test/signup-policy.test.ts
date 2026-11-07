import { describe, expect, it } from 'vitest';

import {
	credentialsAfterRemoval,
	isAccountEnterable,
	mayDiscloseExistence,
	mayRemoveCredential,
	resendDelaySeconds,
	resolveSignupTarget,
	stepUpMethodFor,
} from '../src/auth/signup-policy';

describe('disclosure', () => {
	/**
	 * The anti-enumeration rule, stated as a test so it cannot drift per call site.
	 *
	 * Existence is disclosed to someone who has proven control and to nobody else. An
	 * unauthenticated caller who could ask "is this registered?" could ask it a million times.
	 */
	it('reveals nothing without proof of control, and answers once there is', () => {
		expect(mayDiscloseExistence({ proofOfControl: false })).toBe(false);
		expect(mayDiscloseExistence({ proofOfControl: true })).toBe(true);
	});
});

describe('account enterability', () => {
	/**
	 * Proving control of an address is not the same as being allowed in. A disabled account
	 * stays shut to its own owner until support intervenes, which is the point of disabling it.
	 */
	it('admits active and pending accounts only', () => {
		expect(isAccountEnterable('active')).toBe(true);
		expect(isAccountEnterable('pending')).toBe(true);
		expect(isAccountEnterable('disabled')).toBe(false);
		expect(isAccountEnterable('locked')).toBe(false);
		expect(isAccountEnterable('deleted')).toBe(false);
	});
});

describe('resolving a completed signup', () => {
	it('creates when neither identifier is known', () => {
		expect(resolveSignupTarget({ emailOwnerId: null, phoneOwnerId: null })).toEqual({ kind: 'create' });
	});

	it('returns the existing account when one identifier matches', () => {
		expect(resolveSignupTarget({ emailOwnerId: 'cus_1', phoneOwnerId: null })).toEqual({
			kind: 'existing',
			customerId: 'cus_1',
		});
		expect(resolveSignupTarget({ emailOwnerId: null, phoneOwnerId: 'cus_2' })).toEqual({
			kind: 'existing',
			customerId: 'cus_2',
		});
	});

	it('returns the existing account when both identifiers agree', () => {
		expect(resolveSignupTarget({ emailOwnerId: 'cus_1', phoneOwnerId: 'cus_1' })).toEqual({
			kind: 'existing',
			customerId: 'cus_1',
		});
	});

	/**
	 * The case worth stopping for. Both identifiers are verified, so both are trustworthy —
	 * which is precisely why picking one would hand somebody a stranger's account on the
	 * strength of the other. There is no safe guess, so there is no guess.
	 */
	it('refuses to choose when two proven identifiers name different accounts', () => {
		expect(resolveSignupTarget({ emailOwnerId: 'cus_1', phoneOwnerId: 'cus_2' })).toEqual({ kind: 'conflict' });
	});
});

describe('step-up method', () => {
	it('prefers a password when one exists, and falls back to OTP when none does', () => {
		expect(stepUpMethodFor({ passwordSet: true })).toBe('password');
		expect(stepUpMethodFor({ passwordSet: false })).toBe('otp');
	});
});

describe('credential removal', () => {
	const base = {
		passwordSet: false,
		emailVerified: true,
		phoneVerified: true,
		linkedProviders: ['google'] as const,
	};

	/**
	 * The property that makes disconnect safe for a social signup that never set a password:
	 * a verified email or phone can receive a one-time code, so it IS a login path.
	 */
	it('counts a verified email and phone as usable credentials', () => {
		expect(credentialsAfterRemoval({ ...base, removing: { kind: 'provider', provider: 'google' } })).toBe(2);
		expect(mayRemoveCredential({ ...base, removing: { kind: 'provider', provider: 'google' } })).toBe(true);
	});

	it('refuses the removal that would leave nothing behind', () => {
		expect(
			mayRemoveCredential({
				passwordSet: false,
				emailVerified: false,
				phoneVerified: false,
				linkedProviders: ['google'],
				removing: { kind: 'provider', provider: 'google' },
			}),
		).toBe(false);
	});

	it('leaves the other provider in place when one is removed', () => {
		expect(
			credentialsAfterRemoval({
				passwordSet: false,
				emailVerified: false,
				phoneVerified: false,
				linkedProviders: ['google', 'facebook'],
				removing: { kind: 'provider', provider: 'google' },
			}),
		).toBe(1);
	});

	it('handles removing the password itself', () => {
		expect(
			credentialsAfterRemoval({
				passwordSet: true,
				emailVerified: false,
				phoneVerified: false,
				linkedProviders: [],
				removing: { kind: 'password' },
			}),
		).toBe(0);
	});
});

describe('resend backoff', () => {
	/**
	 * Rising delays rather than a cliff: a real person requesting one resend waits nothing,
	 * and an automated caller is throttled long before any hard ceiling is involved.
	 */
	it('lets the first send through immediately and slows each retry', () => {
		expect(resendDelaySeconds(0)).toBe(0);
		expect(resendDelaySeconds(1)).toBe(30);
		expect(resendDelaySeconds(2)).toBe(120);
		expect(resendDelaySeconds(3)).toBe(600);
		expect(resendDelaySeconds(4)).toBe(3600);
	});

	it('holds at the longest delay rather than growing without bound', () => {
		expect(resendDelaySeconds(99)).toBe(3600);
	});

	it('treats a negative count as a first send rather than throwing', () => {
		expect(resendDelaySeconds(-1)).toBe(0);
	});
});
