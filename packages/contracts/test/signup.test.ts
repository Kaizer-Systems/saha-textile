import { describe, expect, it } from 'vitest';

import {
	FinaliseSignupRequest,
	OAuthVerifyResponse,
	SignupErrorCode,
	SignupOtpVerifyRequest,
	SignupOtpVerifyResponse,
	StartSignupRequest,
} from '../src/index';

describe('verified-before-creation signup contracts', () => {
	/**
	 * The security property of the whole flow, asserted at the schema.
	 *
	 * Finalisation carries no email, no phone and no provider id. The server finalises from
	 * the values it verified and stored, so a caller cannot name identifiers at the one moment
	 * an account is minted. A field added here later would silently reopen that hole, which is
	 * why the shape is pinned rather than merely documented.
	 */
	it('finalisation accepts no identifiers at all', () => {
		const parsed = FinaliseSignupRequest.parse({
			password: 'a-sufficiently-long-password',
			email: 'attacker-supplied@example.test',
			phone: '+919000000000',
			providerSubject: 'sub_injected',
		});

		expect(parsed).toEqual({ password: 'a-sufficiently-long-password' });
		expect(parsed).not.toHaveProperty('email');
		expect(parsed).not.toHaveProperty('phone');
		expect(parsed).not.toHaveProperty('providerSubject');
	});

	/** Social signups finalise with no password; one is set later, deliberately. */
	it('permits finalisation with no password for the social paths', () => {
		expect(FinaliseSignupRequest.parse({})).toEqual({});
	});

	it('holds the 12-character password floor when one is supplied', () => {
		expect(FinaliseSignupRequest.safeParse({ password: 'short' }).success).toBe(false);
	});

	/** Marketing consent is opt-IN. An omitted field must never read as agreement. */
	it('defaults marketing consent to off', () => {
		expect(StartSignupRequest.parse({ email: 'shopper@example.test' }).marketingOptIn).toBe(false);
	});

	it('accepts only a six-digit code', () => {
		const base = { field: 'email' as const };
		expect(SignupOtpVerifyRequest.safeParse({ ...base, code: '123456' }).success).toBe(true);
		expect(SignupOtpVerifyRequest.safeParse({ ...base, code: '1234' }).success).toBe(false);
		expect(SignupOtpVerifyRequest.safeParse({ ...base, code: '12345a' }).success).toBe(false);
	});

	/**
	 * Disclosure defaults to silence.
	 *
	 * A response that omits these fields must not read as "an account exists" or as "it is
	 * usable" — the safe reading of an absent answer is the one that reveals nothing and grants
	 * nothing.
	 */
	it('defaults the disclosure fields to revealing nothing', () => {
		const state = {
			origin: 'password' as const,
			email: { value: null, verified: false, locked: false, sendsRemaining: 5, resendAvailableAt: null },
			phone: { value: null, verified: false, locked: false, sendsRemaining: 5, resendAvailableAt: null },
			displayName: null,
			complete: false,
			expiresAt: '2026-08-16T00:15:00.000Z',
		};
		const parsed = SignupOtpVerifyResponse.parse({ state });
		expect(parsed.existingAccount).toBe(false);
	});

	/**
	 * A verified provider token yields a session OR a signup, never both — and a matching
	 * email alone can only ever yield the signup branch. That is "never auto-link" expressed
	 * where a controller cannot forget it.
	 */
	it('models the social outcome as exactly two states', () => {
		expect(OAuthVerifyResponse.safeParse({ outcome: 'signed_in' }).success).toBe(true);
		expect(OAuthVerifyResponse.safeParse({ outcome: 'signup_required' }).success).toBe(true);
		expect(OAuthVerifyResponse.safeParse({ outcome: 'linked_by_email' }).success).toBe(false);
	});

	/** Codes are public API for the UI; renaming one silently breaks a screen's handling. */
	it('keeps the refusal codes stable', () => {
		expect(SignupErrorCode.options).toEqual([
			'signup_expired',
			'signup_incomplete',
			'otp_send_limit_reached',
			'otp_invalid',
			'signup_identifier_taken',
			'account_not_accessible',
			'signup_identifier_conflict',
			'oauth_provider_unavailable',
			'oauth_state_invalid',
			'oauth_token_invalid',
			'oauth_identity_conflict',
			'step_up_required',
			'last_credential',
		]);
	});
});
