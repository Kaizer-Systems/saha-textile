import { z } from 'zod';

import { Id } from './common';
import { SessionInfo } from './session';
import { User } from './user';

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

/** What an OTP challenge is for (`otpChallenges.purpose`). */
export const OtpPurpose = z.enum(['login', 'register', 'verify_email', 'reset_password', 'step_up']);
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

/** `POST /auth/storefront/login/password` */
export const PasswordLoginRequest = z.object({
	email: z.email(),
	/** Login accepts any length (legacy passwords may predate policy); policy applies on set/change. */
	password: z.string().min(1).max(256),
	rememberMe: z.boolean().optional(),
	guestCartId: Id.optional(),
});
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequest>;

/** `POST /auth/storefront/login/email-otp/request` — response is ALWAYS generic (anti-enumeration lock). */
export const EmailOtpRequest = z.object({
	email: z.email(),
	purpose: z.enum(['login', 'register']),
});
export type EmailOtpRequest = z.infer<typeof EmailOtpRequest>;

/** `POST /auth/storefront/login/email-otp/verify` — single-use; consumes the challenge. */
export const EmailOtpVerifyRequest = z.object({
	email: z.email(),
	code: OtpCode,
	guestCartId: Id.optional(),
});
export type EmailOtpVerifyRequest = z.infer<typeof EmailOtpVerifyRequest>;

/** `POST /auth/storefront/password/forgot` — response is ALWAYS generic (anti-enumeration). */
export const PasswordForgotRequest = z.object({
	email: z.email(),
});
export type PasswordForgotRequest = z.infer<typeof PasswordForgotRequest>;

/** `POST /auth/storefront/password/reset` — revokes all sessions on success. */
export const PasswordResetRequest = z.object({
	token: z.string().min(1),
	newPassword: Password,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

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
	user: User,
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
