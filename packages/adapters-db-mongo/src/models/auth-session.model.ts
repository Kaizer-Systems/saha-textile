import { type Model, Schema, model, models } from 'mongoose';

/**
 * Server-side session (`authSessions`).
 *
 * Only HASHES of the opaque refresh token are stored, so a database read yields nothing
 * a caller could present. `previousRefreshTokenHash` is what makes reuse detection
 * possible: a token that matches the value a session was rotated AWAY from proves the
 * old token leaked, and the entire `refreshFamilyId` is revoked.
 */
export interface AuthSessionDoc {
	_id: string;
	userId: string;
	audience: 'storefront' | 'admin';
	/** Null on storefront; `staff` | `admin` on admin. Legacy `customer` is mapped to null. */
	roleAtLogin: 'staff' | 'admin' | 'customer' | null;
	refreshTokenHash: string;
	refreshFamilyId: string;
	rotationCounter: number;
	previousRefreshTokenHash: string | null;
	replacedBySessionId: string | null;
	/** Session-bound CSRF secret hash — binds a double-submit token to THIS session. */
	csrfSecretHash: string;
	device: { userAgentHash: string | null; ipHash: string | null; country: string | null; label: string | null };
	/** "Remember me": dated cookie + long idle TTL when true, session cookie + short when false. */
	persistent: boolean;
	createdAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
	absoluteExpiresAt: Date;
	revokedAt: Date | null;
	revokeReason: string | null;
}

const AuthSessionSchema = new Schema<AuthSessionDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true },
		audience: { type: String, enum: ['storefront', 'admin'], required: true },
		roleAtLogin: {
			type: String,
			enum: ['staff', 'admin', 'customer', null],
			default: null,
			required: false,
		},
		// Never selected by default: a stray `find()` must not hand back credential material.
		refreshTokenHash: { type: String, required: true, select: false },
		refreshFamilyId: { type: String, required: true },
		rotationCounter: { type: Number, default: 0 },
		previousRefreshTokenHash: { type: String, default: null, select: false },
		replacedBySessionId: { type: String, default: null },
		csrfSecretHash: { type: String, required: true, select: false },
		device: {
			userAgentHash: { type: String, default: null },
			ipHash: { type: String, default: null },
			country: { type: String, default: null },
			label: { type: String, default: null },
		},
		// Default true: rows written before this field existed were all persistent.
		persistent: { type: Boolean, default: true },
		lastSeenAt: { type: Date, required: true },
		expiresAt: { type: Date, required: true },
		absoluteExpiresAt: { type: Date, required: true },
		revokedAt: { type: Date, default: null },
		revokeReason: { type: String, default: null },
	},
	{ collection: 'authSessions', timestamps: { createdAt: true, updatedAt: false } },
);

// Rotation and reuse detection look sessions up by token hash.
AuthSessionSchema.index({ refreshTokenHash: 1 });
AuthSessionSchema.index({ previousRefreshTokenHash: 1 });
// Revoking a compromised family, and listing a user's active sessions.
AuthSessionSchema.index({ refreshFamilyId: 1 });
AuthSessionSchema.index({ userId: 1, audience: 1, revokedAt: 1 });
/**
 * TTL on the ABSOLUTE expiry, not the idle one: a session that is still being refreshed
 * must not be deleted underneath itself, and transient session records are TTL-expired
 * rather than soft-deleted (`DEC-DELETE-RETENTION`).
 */
AuthSessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSessionModel: Model<AuthSessionDoc> =
	(models.AuthSession as Model<AuthSessionDoc>) ?? model<AuthSessionDoc>('AuthSession', AuthSessionSchema);
