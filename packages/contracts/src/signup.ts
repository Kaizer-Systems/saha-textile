import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { SessionInfo } from './session';
import { Customer } from './customer';

/**
 * Verified-before-creation signup (`DEC-SIGNUP-VERIFICATION`, owner lock 2026-08-16).
 *
 * ## The one idea this whole file exists to enforce
 *
 * A customer row is created only after its email AND phone have been proven by OTP. There is
 * therefore no unverified-account state, which removes an entire class of takeover: nobody
 * can register an address they do not control and wait for the real owner to arrive and be
 * handed the attacker's account.
 *
 * The verified state has to live somewhere before the account exists, and that somewhere is
 * SERVER-SIDE — a pending-signup document keyed to the session. The client never asserts what
 * is verified; it asks what the server already knows. If the browser could say "this email is
 * verified", an attacker would verify their own address, submit the victim's, and receive a
 * pre-verified account on somebody else's mailbox. Every response below therefore reports
 * state rather than accepting it, and `FinaliseSignupRequest` carries no identifiers at all.
 */

/** Which field of a pending signup an action addresses. */
export const SignupField = z.enum(['email', 'phone']);
export type SignupField = z.infer<typeof SignupField>;

/**
 * How the pending signup began, which decides what the form shows.
 *
 * `password` collects one. `google` and `facebook` do not — a social signup has no password
 * until the customer deliberately sets one from their account page.
 */
export const SignupOrigin = z.enum(['password', 'google', 'facebook']);
export type SignupOrigin = z.infer<typeof SignupOrigin>;

/**
 * Per-field verification state, as the FORM needs to render it.
 *
 * `value` is echoed back so a reload or a second tab shows what the server holds rather than
 * whatever the last keystroke left in the DOM. `verified` is the server's answer and the only
 * one that counts. `locked` means the value may not be edited at all — true only for a Google
 * email, which Google itself asserts and we will not let a form overwrite.
 */
export const SignupFieldState = z.object({
	value: z.string().nullable().default(null),
	verified: z.boolean().default(false),
	locked: z.boolean().default(false),
	/** Sends remaining for this field on this pending signup. Drives the disabled state. */
	sendsRemaining: z.number().int().nonnegative(),
	/** When a resend becomes available (progressive backoff), or null when it already is. */
	resendAvailableAt: IsoDateTime.nullable().default(null),
});
export type SignupFieldState = z.infer<typeof SignupFieldState>;

/**
 * The pending signup as the browser may see it.
 *
 * Deliberately excludes the provider subject, the OTP hashes and the session binding: the
 * form needs to know what to render, not what the server is holding it to.
 */
export const PendingSignupState = z.object({
	origin: SignupOrigin,
	email: SignupFieldState,
	phone: SignupFieldState,
	displayName: z.string().nullable().default(null),
	/** True once both fields are verified — the only condition that permits finalisation. */
	complete: z.boolean().default(false),
	/** Sliding TTL: extended by each verification or send, capped absolutely. */
	expiresAt: IsoDateTime,
});
export type PendingSignupState = z.infer<typeof PendingSignupState>;

/**
 * `POST /auth/storefront/signup/start`
 *
 * Replaces the old `POST /auth/storefront/register`, which created an account from an email
 * and a password with no verification at all. Leaving that route in place beside this one
 * would have left the unverified door open next to the locked one.
 */
export const StartSignupRequest = z.object({
	email: z.email().optional(),
	phone: z.string().min(6).max(20).optional(),
	displayName: z.string().min(1).max(120).optional(),
	/** Marketing consent is explicit and defaults OFF; social signup never implies it. */
	marketingOptIn: z.boolean().default(false),
	/** Carried so the guest cart survives a multi-step signup and merges at creation. */
	guestCartId: Id.optional(),
});
export type StartSignupRequest = z.infer<typeof StartSignupRequest>;

/**
 * `PATCH /auth/storefront/signup/field`
 *
 * Editing a verified field is allowed and simply clears that field's verified flag. Locking a
 * typo'd address in would buy nothing: the verification is bound server-side to the value, so
 * a changed value is already unverified by construction.
 */
export const UpdateSignupFieldRequest = z.object({
	field: SignupField,
	value: z.string().min(1).max(254),
});
export type UpdateSignupFieldRequest = z.infer<typeof UpdateSignupFieldRequest>;

/**
 * `POST /auth/storefront/signup/otp/request`
 *
 * The response is the pending state, never a delivery report. Whether a code was actually
 * dispatched is not the caller's business — see the anti-enumeration note on
 * `SignupOtpVerifyResponse`.
 */
export const SignupOtpRequestBody = z.object({ field: SignupField });
export type SignupOtpRequestBody = z.infer<typeof SignupOtpRequestBody>;

/** `POST /auth/storefront/signup/otp/verify` */
export const SignupOtpVerifyRequest = z.object({
	field: SignupField,
	code: z.string().regex(/^\d{6}$/, 'must be a 6-digit code'),
});
export type SignupOtpVerifyRequest = z.infer<typeof SignupOtpVerifyRequest>;

/**
 * What a successful verification revealed.
 *
 * `existingAccount` is the disclosure rule in one field. Before verification the server tells
 * nobody whether an address is registered — that would hand an attacker a customer list. AFTER
 * verification the caller has PROVEN they control the address, so telling them is safe and
 * useful, and they are offered the choice the flow needs: sign in to what already exists, or
 * start over with a different identifier.
 *
 * `accountUsable` distinguishes an account they may enter from one they may not: proving
 * control of an address attached to a disabled or locked account must not open it.
 */
export const SignupOtpVerifyResponse = z.object({
	state: PendingSignupState,
	existingAccount: z.boolean().default(false),
	accountUsable: z.boolean().default(true),
});
export type SignupOtpVerifyResponse = z.infer<typeof SignupOtpVerifyResponse>;

/**
 * `POST /auth/storefront/signup/finalise`
 *
 * Carries NO email, phone or provider id, and that absence is the security property. The
 * server uses the values it verified and stored; a request that could name its own
 * identifiers could name somebody else's.
 */
export const FinaliseSignupRequest = z.object({
	/** Absent on the social paths, which set a password later from the account page. */
	password: z.string().min(12).max(256).optional(),
});
export type FinaliseSignupRequest = z.infer<typeof FinaliseSignupRequest>;

export const SignupResultResponse = z.object({
	customer: Customer,
	session: SessionInfo,
});
export type SignupResultResponse = z.infer<typeof SignupResultResponse>;

/**
 * Stable refusal codes for the whole signup and social surface.
 *
 * Public and stable so a screen can act on them without parsing prose, and deliberately
 * coarse where being precise would leak. `signup_identifier_taken` is only ever returned
 * AFTER proof of control; the pre-proof paths answer generically and say nothing at all.
 */
export const SignupErrorCode = z.enum([
	/** No pending signup for this session, or its sliding TTL ran out mid-flow. */
	'signup_expired',
	/** Both fields must be verified before an account can exist. */
	'signup_incomplete',
	/** Per-destination or per-flood send budget spent. */
	'otp_send_limit_reached',
	/** Wrong or expired code. Never says which. */
	'otp_invalid',
	/** Proven control, and the address already belongs to a usable account. */
	'signup_identifier_taken',
	/** Proven control, but the account cannot be entered — disabled or locked. */
	'account_not_accessible',
	/** Two proven identifiers resolving to different accounts; the server will not guess. */
	'signup_identifier_conflict',
	/** Provider configuration absent or invalid — fails closed rather than half-working. */
	'oauth_provider_unavailable',
	/** State missing, replayed, expired, or bound to another browser. */
	'oauth_state_invalid',
	/** Signature, issuer, audience, nonce, expiry, app binding or revocation check failed. */
	'oauth_token_invalid',
	/** This provider identity is already linked to a different customer. */
	'oauth_identity_conflict',
	/** Linking or unlinking needs fresh proof: a password when set, otherwise an OTP. */
	'step_up_required',
	/** Removing this would leave the account with no way back in. */
	'last_credential',
]);
export type SignupErrorCode = z.infer<typeof SignupErrorCode>;
