import { z } from 'zod';

import { AdminRole, AdminUserId, AdminUserStatus } from './admin-role';
import { OtpChannel, OtpPurpose } from './auth';
import { Id, IsoDateTime } from './common';
import { CustomerId, CustomerStatus } from './customer';
import { SessionAudience } from './session';

/**
 * SERVER-INTERNAL auth entity shapes. These model persistence documents used by
 * core-domain repository ports and DB adapters. They store HASHES only (never
 * plaintext codes/tokens) and must never be returned by a public endpoint.
 */

/**
 * OTP challenge entity (`otpChallenges`) — owner lock 2026-07-05: 6-digit CSPRNG
 * code stored as `HMAC-SHA256(code, server-pepper)`; single active challenge per
 * (identifier, purpose); TTL 600s; max 5 attempts; consumed atomically.
 */
export const OtpChallenge = z.object({
	id: Id,
	/** Normalized destination identity (email or E.164 phone). */
	identifier: z.string().min(1),
	purpose: OtpPurpose,
	channel: OtpChannel,
	/** HMAC hash of the code — plaintext is never stored or logged. */
	codeHash: z.string().min(1),
	userId: Id.nullable().default(null),
	attempts: z.number().int().nonnegative().default(0),
	maxAttempts: z.number().int().positive().default(5),
	resendCount: z.number().int().nonnegative().default(0),
	lastSentAt: IsoDateTime.nullable().default(null),
	ipHash: z.string().nullable().default(null),
	userAgentHash: z.string().nullable().default(null),
	createdAt: IsoDateTime,
	/** TTL index target — expired challenges are rejected then auto-purged. */
	expiresAt: IsoDateTime,
	consumedAt: IsoDateTime.nullable().default(null),
	blockedAt: IsoDateTime.nullable().default(null),
});
export type OtpChallenge = z.infer<typeof OtpChallenge>;

/** OAuth state entity (`oauthStates`) — provider CSRF/state/nonce validation (auth plan §7.6). */
export const OAuthState = z.object({
	id: Id,
	provider: z.enum(['google', 'facebook']),
	audience: SessionAudience,
	stateHash: z.string().min(1),
	nonceHash: z.string().nullable().default(null),
	codeVerifierHash: z.string().nullable().default(null),
	/** Relative path or strict-allowlist URL only — validated at consume time. */
	redirectAfterLogin: z.string().nullable().default(null),
	guestCartId: Id.nullable().default(null),
	ipHash: z.string().nullable().default(null),
	userAgentHash: z.string().nullable().default(null),
	createdAt: IsoDateTime,
	expiresAt: IsoDateTime,
	consumedAt: IsoDateTime.nullable().default(null),
});
export type OAuthState = z.infer<typeof OAuthState>;

/** Password reset token entity (`passwordResetTokens`) — hash only; single-use; TTL. */
export const PasswordResetToken = z.object({
	id: Id,
	userId: Id,
	tokenHash: z.string().min(1),
	audience: SessionAudience,
	ipHash: z.string().nullable().default(null),
	userAgentHash: z.string().nullable().default(null),
	createdAt: IsoDateTime,
	expiresAt: IsoDateTime,
	consumedAt: IsoDateTime.nullable().default(null),
});
export type PasswordResetToken = z.infer<typeof PasswordResetToken>;

/** Email verification token entity (`emailVerificationTokens`) — separate from OTP login. */
export const EmailVerificationToken = z.object({
	id: Id,
	userId: Id,
	emailNormalized: z.string().min(1),
	tokenHash: z.string().min(1),
	createdAt: IsoDateTime,
	expiresAt: IsoDateTime,
	consumedAt: IsoDateTime.nullable().default(null),
});
export type EmailVerificationToken = z.infer<typeof EmailVerificationToken>;

/** Admin invite entity (`adminInvites`) — controlled staff/admin creation; no self-registration. */
export const AdminInvite = z.object({
	id: Id,
	emailNormalized: z.string().min(1),
	role: AdminRole,
	permissions: z.array(z.string()).default([]),
	invitedByUserId: Id,
	tokenHash: z.string().min(1),
	createdAt: IsoDateTime,
	expiresAt: IsoDateTime,
	acceptedAt: IsoDateTime.nullable().default(null),
	revokedAt: IsoDateTime.nullable().default(null),
});
export type AdminInvite = z.infer<typeof AdminInvite>;

/**
 * Mongo-backed rate-limit entity (`authRateLimits`) — atomic `$inc` counters
 * until a hot store (Redis) takes over; audit stays in Mongo.
 */
/**
 * What a rate-limit counter is keyed BY, and what it counts.
 *
 * Both named so the `authRateLimits` schema is built from them instead of repeating them. The
 * cost of the repetition is not theoretical: `otpChallenges.purpose` drifted from its contract
 * exactly this way and produced a 500 that only a live request could reveal.
 */
export const AuthRateLimitScope = z.enum(['ip', 'email', 'phone', 'user', 'provider']);
export type AuthRateLimitScope = z.infer<typeof AuthRateLimitScope>;

export const AuthRateLimitAction = z.enum([
	'login',
	'pin_login',
	'otp_request',
	'otp_verify',
	'password_reset',
	'oauth_start',
	'refresh',
]);
export type AuthRateLimitAction = z.infer<typeof AuthRateLimitAction>;

export const AuthRateLimit = z.object({
	id: Id,
	/** Composite key, e.g. `ip:<hash>` / `email:<hash>`. */
	key: z.string().min(1),
	scope: AuthRateLimitScope,
	action: AuthRateLimitAction,
	count: z.number().int().nonnegative().default(0),
	firstSeenAt: IsoDateTime,
	lastSeenAt: IsoDateTime,
	expiresAt: IsoDateTime,
	blockedUntil: IsoDateTime.nullable().default(null),
});
export type AuthRateLimit = z.infer<typeof AuthRateLimit>;

/**
 * SERVER-INTERNAL authentication state for one storefront customer.
 *
 * Never returned by an endpoint. Operator credential state is `AdminUserAuthState`.
 * `passwordHash` is joined from `passwordCredentials` at the adapter boundary.
 */
export const CustomerAuthState = z.object({
	id: CustomerId,
	email: z.string().nullable().default(null),
	emailVerified: z.boolean().default(false),
	status: CustomerStatus,
	/** argon2id hash, or null for an account that has only OAuth/OTP identities. */
	passwordHash: z.string().nullable().default(null),
	tokenVersion: z.number().int().nonnegative().default(0),
	failedLoginAttempts: z.number().int().nonnegative().default(0),
});
export type CustomerAuthState = z.infer<typeof CustomerAuthState>;

/**
 * SERVER-INTERNAL authentication state for one back-office operator.
 *
 * The public projection is `AdminUser` / `AdminUserProfile`. `tokenVersion` and
 * `permissionsVersion` are the fast-invalidation counters.
 */
export const AdminUserAuthState = z.object({
	id: AdminUserId,
	email: z.string().nullable().default(null),
	emailVerified: z.boolean().default(false),
	username: z.string().nullable().default(null),
	role: AdminRole,
	status: AdminUserStatus,
	/** argon2id hash, or null until invite acceptance sets a password. */
	passwordHash: z.string().nullable().default(null),
	/** argon2id hash of the six-digit admin PIN. */
	pinHash: z.string().nullable().default(null),
	preferredLoginMethod: z.enum(['password', 'pin']).default('password'),
	permissions: z.array(z.string()).default([]),
	tokenVersion: z.number().int().nonnegative().default(0),
	permissionsVersion: z.number().int().nonnegative().default(0),
	failedLoginAttempts: z.number().int().nonnegative().default(0),
	failedPinAttempts: z.number().int().nonnegative().default(0),
	pinLockedUntil: IsoDateTime.nullable().default(null),
	/**
	 * Set when a privileged password reset has suspended PIN use.
	 *
	 * Distinct from `pinLockedUntil`, which is the five-failure brute-force lock and expires
	 * on its own after fifteen minutes. This one has no expiry: it clears only when the
	 * administrator authenticates once with the new password. The PIN hash is deliberately
	 * NOT deleted — the owner decision requires an explicit, auditable revalidation state
	 * rather than a silent credential removal.
	 */
	pinRevalidationRequiredAt: IsoDateTime.nullable().default(null),
});
export type AdminUserAuthState = z.infer<typeof AdminUserAuthState>;
