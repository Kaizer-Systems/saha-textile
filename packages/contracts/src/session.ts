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

/**
 * One row of "where am I signed in?" — what a device list may show its owner.
 *
 * A strict subtraction from `AuthSession`, and every omission is deliberate. The refresh
 * hashes, the previous-token hash and the CSRF secret hash are credential material: publishing
 * them would hand a reader the fingerprints reuse detection is built on. `device.userAgentHash`
 * and `device.ipHash` go for the reason the audit read model drops the same pair — an unsalted
 * digest of an IPv4 address falls to exhaustive search in seconds, so publishing the hash is
 * publishing the address that hashing it was meant to avoid.
 *
 * What remains is what a person actually needs in order to recognise a session and decide
 * whether to end it: a label, a country, when it started, when it was last used, and when it
 * dies on its own.
 */
export const SessionSummary = z.object({
	id: Id,
	audience: SessionAudience,
	/** Human-recognisable device hint. Null until a labelling strategy exists. */
	label: z.string().nullable().default(null),
	/** Coarse location only — never a raw address, and never its hash. */
	country: z.string().nullable().default(null),
	createdAt: IsoDateTime,
	lastSeenAt: IsoDateTime,
	/** Idle expiry. */
	expiresAt: IsoDateTime,
	/** Hard ceiling; a session cannot outlive this however active it is. */
	absoluteExpiresAt: IsoDateTime,
	/**
	 * True for the session making the request.
	 *
	 * Without it a device list is a list of indistinguishable rows and the owner cannot tell
	 * which one signing out will end the page they are looking at.
	 */
	current: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** `GET /auth/{audience}/sessions` — the caller's own live sessions, newest first. */
export const SessionListResponse = z.object({ items: z.array(SessionSummary) });
export type SessionListResponse = z.infer<typeof SessionListResponse>;

/** `POST /auth/{audience}/sessions/revoke-others` — how many were ended. */
export const SessionRevokeResponse = z.object({ revoked: z.number().int().nonnegative() });
export type SessionRevokeResponse = z.infer<typeof SessionRevokeResponse>;

/**
 * Projects a stored session onto the read model.
 *
 * Beside the schema on purpose, so the subtraction happens in the one place it is explained.
 * A controller mapping this inline is a controller where the next field added to `AuthSession`
 * — the next hash, most likely — silently becomes public.
 */
export function toSessionSummary(session: AuthSession, currentSessionId: string): SessionSummary {
	return {
		id: session.id,
		audience: session.audience,
		label: session.device.label,
		country: session.device.country,
		createdAt: session.createdAt,
		lastSeenAt: session.lastSeenAt,
		expiresAt: session.expiresAt,
		absoluteExpiresAt: session.absoluteExpiresAt,
		current: session.id === currentSessionId,
	};
}
