import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/** Which browser app a session belongs to. Admin cookies must never authorize storefront-only flows and vice versa. */
export const SessionAudience = z.enum(['storefront', 'admin']);
export type SessionAudience = z.infer<typeof SessionAudience>;

/** Why a server-side session was revoked (audited; reuse detection revokes the whole refresh family). */
export const SessionRevokeReason = z.enum([
	'logout',
	'logout_all',
	'password_changed',
	'pin_changed',
	'role_changed',
	'reuse_detected',
	'disabled_user',
	'admin_action',
]);
export type SessionRevokeReason = z.infer<typeof SessionRevokeReason>;

/**
 * Claims carried by the short-lived access JWT (httpOnly cookie).
 * `tokenVersion` / `permissionsVersion` let password/role changes invalidate old JWTs quickly.
 */
export const AccessTokenClaims = z.object({
	iss: z.string().min(1),
	aud: SessionAudience,
	sub: Id,
	/** Server-side session id (`authSessions`). */
	sid: Id,
	role: z.enum(['customer', 'staff', 'admin']),
	tokenVersion: z.number().int().nonnegative(),
	permissionsVersion: z.number().int().nonnegative(),
	jti: z.string().min(1),
	iat: z.number().int(),
	exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

/** Public session metadata returned to browsers. NEVER contains token values — cookies carry the session. */
export const SessionInfo = z.object({
	audience: SessionAudience,
	expiresAt: IsoDateTime,
	refreshExpiresAt: IsoDateTime,
});
export type SessionInfo = z.infer<typeof SessionInfo>;

/** Anonymized device/context info attached to a session (hashes only — raw IP/UA are never stored). */
export const SessionDeviceInfo = z.object({
	userAgentHash: z.string().nullable().default(null),
	ipHash: z.string().nullable().default(null),
	country: z.string().nullable().default(null),
	label: z.string().nullable().default(null),
});
export type SessionDeviceInfo = z.infer<typeof SessionDeviceInfo>;

/**
 * Server-side session entity (`authSessions` collection) — SERVER-INTERNAL shape.
 * Refresh tokens are opaque high-entropy values; only their hashes are persisted.
 * Never expose this shape through a public endpoint.
 */
export const AuthSession = z.object({
	id: Id,
	userId: Id,
	audience: SessionAudience,
	roleAtLogin: z.enum(['customer', 'staff', 'admin']),
	/** HMAC hash of the current opaque refresh token (never the token itself). */
	refreshTokenHash: z.string().min(1),
	/** Rotation family — reuse detection revokes every session sharing this id. */
	refreshFamilyId: Id,
	rotationCounter: z.number().int().nonnegative().default(0),
	previousRefreshTokenHash: z.string().nullable().default(null),
	replacedBySessionId: Id.nullable().default(null),
	/** Session-bound CSRF secret hash (double-submit validation). */
	csrfSecretHash: z.string().min(1),
	device: SessionDeviceInfo.default({ userAgentHash: null, ipHash: null, country: null, label: null }),
	createdAt: IsoDateTime,
	lastSeenAt: IsoDateTime,
	/** Idle expiry (admin shorter than storefront). */
	expiresAt: IsoDateTime,
	absoluteExpiresAt: IsoDateTime,
	revokedAt: IsoDateTime.nullable().default(null),
	revokeReason: SessionRevokeReason.nullable().default(null),
});
export type AuthSession = z.infer<typeof AuthSession>;
