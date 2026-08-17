import { OtpChannel, OtpPurpose } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Short-lived challenge/state documents. Grouped in one file because they share the same
 * discipline: hash-only storage, a TTL index so nothing lingers, and atomic single-use
 * consumption.
 */

/**
 * OTP challenge (`otpChallenges`).
 *
 * Owner lock: CSPRNG 6-digit code stored as HMAC-SHA256 with a server pepper, 10-minute
 * expiry, max five attempts, and a SINGLE active challenge per (identifier × purpose) —
 * enforced by the partial unique index below rather than by a read-then-write the
 * application could race.
 */
export interface OtpChallengeDoc {
	_id: string;
	identifier: string;
	purpose: string;
	channel: string;
	codeHash: string;
	userId: string | null;
	attempts: number;
	maxAttempts: number;
	resendCount: number;
	lastSentAt: Date | null;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
	blockedAt: Date | null;
}

const OtpChallengeSchema = new Schema<OtpChallengeDoc>(
	{
		_id: { type: String, required: true },
		identifier: { type: String, required: true },
		// Derived from the contract, never re-listed. The hand-copied version silently went stale
		// the moment `change_contact` was added: every send for a contact change failed schema
		// validation and surfaced as a 500, while the contract, the service and its unit tests
		// all agreed the value was legitimate. A mirror that has to be remembered will not be.
		purpose: { type: String, enum: OtpPurpose.options, required: true },
		channel: { type: String, enum: OtpChannel.options, required: true },
		// The code itself is never stored; only its HMAC, and never selected by default.
		codeHash: { type: String, required: true, select: false },
		userId: { type: String, default: null },
		attempts: { type: Number, default: 0 },
		maxAttempts: { type: Number, default: 5 },
		resendCount: { type: Number, default: 0 },
		lastSentAt: { type: Date, default: null },
		ipHash: { type: String, default: null },
		userAgentHash: { type: String, default: null },
		expiresAt: { type: Date, required: true },
		consumedAt: { type: Date, default: null },
		blockedAt: { type: Date, default: null },
	},
	{ collection: 'otpChallenges', timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * One ACTIVE challenge per (identifier × purpose). Partial so consumed challenges do not
 * block a legitimate re-request; unique so two concurrent sends cannot both create one.
 */
OtpChallengeSchema.index(
	{ identifier: 1, purpose: 1 },
	{ unique: true, partialFilterExpression: { consumedAt: null } },
);
OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallengeModel: Model<OtpChallengeDoc> =
	(models.OtpChallenge as Model<OtpChallengeDoc>) ?? model<OtpChallengeDoc>('OtpChallenge', OtpChallengeSchema);

/**
 * OAuth state (`oauthStates`) — the CSRF/nonce guard for the provider round-trip.
 *
 * `redirectAfterLogin` is stored but must be validated as a relative path or an
 * allowlisted URL at CONSUME time; an unvalidated redirect here is an open-redirect.
 */
export interface OAuthStateDoc {
	_id: string;
	provider: string;
	audience: string;
	stateHash: string;
	nonceHash: string | null;
	codeVerifierHash: string | null;
	redirectAfterLogin: string | null;
	guestCartId: string | null;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
}

const OAuthStateSchema = new Schema<OAuthStateDoc>(
	{
		_id: { type: String, required: true },
		provider: { type: String, enum: ['google', 'facebook'], required: true },
		audience: { type: String, enum: ['storefront', 'admin'], required: true },
		stateHash: { type: String, required: true, select: false },
		nonceHash: { type: String, default: null, select: false },
		codeVerifierHash: { type: String, default: null, select: false },
		redirectAfterLogin: { type: String, default: null },
		guestCartId: { type: String, default: null },
		ipHash: { type: String, default: null },
		userAgentHash: { type: String, default: null },
		expiresAt: { type: Date, required: true },
		consumedAt: { type: Date, default: null },
	},
	{ collection: 'oauthStates', timestamps: { createdAt: true, updatedAt: false } },
);

OAuthStateSchema.index({ stateHash: 1 }, { unique: true });
OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OAuthStateModel: Model<OAuthStateDoc> =
	(models.OAuthState as Model<OAuthStateDoc>) ?? model<OAuthStateDoc>('OAuthState', OAuthStateSchema);
