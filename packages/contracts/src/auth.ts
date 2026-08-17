import { z } from 'zod';

import { Id } from './common';
import { Customer } from './customer';
import { SessionInfo } from './session';

/**
 * Password policy floor (owner lock 2026-06-29): minimum 12 characters for BOTH
 * storefront and admin. Length only — the common-password denylist is a domain
 * policy check, not a schema regex: `evaluatePassword` in
 * `packages/core-domain/src/auth/password-policy.ts`, enforced by the API on every
 * path that sets a password. A refusal returns `validation_failed` with a
 * `password_*` issue code.
 *
 * Strength deliberately does NOT live here. This schema is shared with the browser,
 * and a client is the one place credential policy must never be enforced.
 */
export const Password = z.string().min(12).max(256);
export type Password = z.infer<typeof Password>;

/** 6-digit OTP code (owner lock 2026-07-05: CSPRNG, HMAC-stored, single-active, TTL 600s). */
export const OtpCode = z.string().regex(/^\d{6}$/, 'must be a 6-digit code');
export type OtpCode = z.infer<typeof OtpCode>;

/**
 * What an OTP challenge is for (`otpChallenges.purpose`).
 *
 * A purpose is part of the lookup key, so it is what stops a code minted for one thing being
 * spent on another. `change_contact` is its own value rather than borrowing `register` for
 * exactly that reason: the two would collide on the same address — a signup code could confirm
 * somebody's contact change, and a contact-change send would overwrite a live signup challenge.
 */
export const OtpPurpose = z.enum(['login', 'register', 'verify_email', 'reset_password', 'step_up', 'change_contact']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;

/** Channel an OTP is delivered on (channel-direct via NotificationPort — no provider OTP widget). */
export const OtpChannel = z.enum(['email', 'sms', 'whatsapp']);
export type OtpChannel = z.infer<typeof OtpChannel>;

/** `POST /auth/storefront/register` */
export const RegisterStorefrontRequest = z.object({
	email: z.email(),
	password: Password,
	displayName: z.string().min(1).max(120).optional(),
	marketingOptIn: z.boolean().optional(),
	guestCartId: Id.optional(),
});
export type RegisterStorefrontRequest = z.infer<typeof RegisterStorefrontRequest>;

/**
 * An email address or a phone number, as the person typed it.
 *
 * Both are login credentials under `DEC-SIGNUP-VERIFICATION` — both are OTP-verified before an
 * account exists, so either identifies its owner exactly as well as the other. Validated only
 * for shape here; which column it resolves against is the server's decision, and a caller must
 * not be able to steer that by claiming a value is "an email".
 */
export const CustomerIdentifier = z
	.string()
	.trim()
	.min(3)
	.max(254)
	.refine((value) => value.includes('@') || /^\+?[0-9]{6,20}$/.test(value), {
		message: 'must be an email address or a phone number',
	});
export type CustomerIdentifier = z.infer<typeof CustomerIdentifier>;

/** `POST /auth/storefront/login/password` */
export const PasswordLoginRequest = z.object({
	/**
	 * Email or phone. `email` is retained as an accepted alias so an older client keeps working
	 * through the transition; the server reads `identifier` when both are present.
	 */
	identifier: CustomerIdentifier.optional(),
	email: z.email().optional(),
	/** Login accepts any length (legacy passwords may predate policy); policy applies on set/change. */
	password: z.string().min(1).max(256),
	rememberMe: z.boolean().optional(),
	guestCartId: Id.optional(),
});
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequest>;

/** `POST /auth/storefront/login/email-otp/request` — response is ALWAYS generic (anti-enumeration lock). */
export const EmailOtpRequest = z.object({
	identifier: CustomerIdentifier.optional(),
	email: z.email().optional(),
	purpose: z.enum(['login', 'register']),
});
export type EmailOtpRequest = z.infer<typeof EmailOtpRequest>;

/** `POST /auth/storefront/login/email-otp/verify` — single-use; consumes the challenge. */
export const EmailOtpVerifyRequest = z.object({
	identifier: CustomerIdentifier.optional(),
	email: z.email().optional(),
	code: OtpCode,
	/** Same "remember me" the password path takes — the choice belongs to the sign-in, not the proof. */
	rememberMe: z.boolean().optional(),
	guestCartId: Id.optional(),
});
export type EmailOtpVerifyRequest = z.infer<typeof EmailOtpVerifyRequest>;

/** `POST /auth/storefront/password/forgot` — response is ALWAYS generic (anti-enumeration). */
export const PasswordForgotRequest = z.object({
	identifier: CustomerIdentifier.optional(),
	email: z.email().optional(),
});
export type PasswordForgotRequest = z.infer<typeof PasswordForgotRequest>;

/** `POST /auth/storefront/password/reset` — revokes all sessions on success. */
export const PasswordResetRequest = z.object({
	token: z.string().min(1),
	newPassword: Password,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

/**
 * `POST /auth/storefront/password/set` — set or change the password of the SIGNED-IN account.
 *
 * Distinct from `password/reset`, which is unauthenticated and spends a mailed token. This one
 * needs a live session PLUS fresh credential proof, because a stolen session must not be able to
 * mint a permanent new way in. Same freshness rule as connect/disconnect: the current password
 * when one is set, otherwise a one-time code — which is the path every social-only account takes
 * to acquire its first password.
 */
export const SetPasswordRequest = z.object({
	newPassword: Password,
	/** Freshness proof. Exactly one applies, decided by whether a password already exists. */
	password: z.string().min(1).max(256).optional(),
	otpCode: z
		.string()
		.regex(/^\d{6}$/)
		.optional(),
});
export type SetPasswordRequest = z.infer<typeof SetPasswordRequest>;

/**
 * `POST /auth/storefront/activate` — admin-minted activation token → first password.
 *
 * Same transport shape as password reset; the handler also promotes `pending` → `active`
 * and marks email verified when an email is present.
 */
export const ActivateCustomerRequest = PasswordResetRequest;
export type ActivateCustomerRequest = z.infer<typeof ActivateCustomerRequest>;

/**
 * Generic accepted response for enumeration-safe endpoints (OTP request, forgot
 * password): identical whether or not the account exists (owner lock 2026-07-02).
 */
export const GenericAcceptedResponse = z.object({
	message: z.string().min(1),
});
export type GenericAcceptedResponse = z.infer<typeof GenericAcceptedResponse>;

/**
 * Browser auth success response. Cookies carry the session — this body NEVER
 * contains access or refresh tokens (cookie-session lock 2026-06-29).
 */
export const AuthSessionResponse = z.object({
	user: Customer,
	session: SessionInfo,
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponse>;

/** `GET /auth/csrf` response — token also set as the readable `st_csrf` cookie (double-submit). */
export const CsrfTokenResponse = z.object({
	csrfToken: z.string().min(1),
});
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponse>;

/**
 * Redeems an email-verification token.
 *
 * Previously an anonymous `z.object({ token })` inline in the route decorator — the only
 * request in the auth family that was not already a named contract, and therefore the one
 * shape no client could import.
 */
export const EmailVerificationRequest = z.object({
	token: z.string().min(1),
});
export type EmailVerificationRequest = z.infer<typeof EmailVerificationRequest>;
