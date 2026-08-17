import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * A change of email or phone that has been started but not yet proven.
 *
 * The account keeps its current value — and keeps signing in with it — until a code sent to the
 * NEW one comes back. That is the security matrix's "retain old address until new one is
 * verified", and it is what stops a briefly-stolen session from taking the recovery channel with
 * it permanently.
 *
 * There is deliberately NO unique index on `newValue`: uniqueness of an email or a phone belongs
 * to the `customers` collection and is settled at the swap. Reserving it here would let one
 * account park addresses in fifteen-minute blocks against everybody else, which is a denial of
 * service wearing a safety feature's clothes.
 *
 * Deliberately NOT a Schema Nebula node — see `RUNTIME_ONLY_COLLECTIONS` in `collection-names.ts`.
 */
export interface PendingContactChangeDoc {
	_id: string;
	/**
	 * The account this change belongs to.
	 *
	 * Unique, so starting a second change replaces the first rather than leaving two in flight
	 * competing to be "the" pending value.
	 */
	customerId: string;
	field: 'email' | 'phone';
	newValue: string;
	/** Sends made for this change, driving both the remaining budget and the resend backoff. */
	sends: number;
	lastSentAt: Date | null;
	createdAt: Date;
	/**
	 * Sliding expiry, extended by each send and capped by `absoluteExpiresAt`.
	 *
	 * Mirrors `pendingSignups`: a fixed window would guillotine somebody halfway through typing
	 * a code that is itself still valid.
	 */
	expiresAt: Date;
	absoluteExpiresAt: Date;
}

const PendingContactChangeSchema = new Schema<PendingContactChangeDoc>(
	{
		_id: { type: String, required: true },
		customerId: { type: String, required: true },
		field: { type: String, enum: ['email', 'phone'], required: true },
		newValue: { type: String, required: true },
		sends: { type: Number, default: 0 },
		lastSentAt: { type: Date, default: null },
		expiresAt: { type: Date, required: true },
		absoluteExpiresAt: { type: Date, required: true },
	},
	{ collection: COLLECTION_NAMES.PendingContactChange, timestamps: { createdAt: true, updatedAt: false } },
);

/** One change in flight per account; starting another replaces it. */
PendingContactChangeSchema.index({ customerId: 1 }, { unique: true });

/**
 * Mongo deletes the row once the sliding window closes.
 *
 * Abandonment is the common case — people start changing an address and think better of it — so
 * cleanup has to be automatic rather than a job somebody remembers to run.
 */
PendingContactChangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PendingContactChangeModel: Model<PendingContactChangeDoc> =
	(models.PendingContactChange as Model<PendingContactChangeDoc>) ??
	model<PendingContactChangeDoc>('PendingContactChange', PendingContactChangeSchema);
