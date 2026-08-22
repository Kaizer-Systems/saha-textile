import { OAuthProvider, SignupOrigin } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * A signup that has been started but not yet earned an account
 * (`DEC-SIGNUP-VERIFICATION`, owner lock 2026-08-16).
 *
 * ## Why this collection exists at all
 *
 * No customer row is created until its email AND phone are proven by OTP, so the proof has to
 * live somewhere in the meantime — and that somewhere must be the SERVER. If the browser held
 * "email verified: true", an attacker would verify an address they own, submit the victim's,
 * and be handed a pre-verified account on somebody else's mailbox. Every value the finalise
 * step uses is read from this document; the request that finalises carries no identifiers at
 * all.
 *
 * ## What it is not
 *
 * Not a customer, and not a reservation. A pending row does NOT hold the email or phone
 * against anyone else — uniqueness belongs to the `customers` collection alone. Reserving
 * would let one caller park thousands of addresses in fifteen-minute blocks and stall real
 * signups, which is a denial of service dressed as a safety feature. Two people may hold the
 * same pending address; the loser finds out at finalisation, where the unique index decides.
 *
 * Deliberately NOT a Schema Nebula node: it is machinery with a TTL, not part of the ratified
 * data model. See `RUNTIME_ONLY_COLLECTIONS` in `collection-names.ts`.
 */
export interface PendingSignupFieldState {
	value: string | null;
	verified: boolean;
	/** True only for a Google email, which the provider asserts and a form may not overwrite. */
	locked: boolean;
	/** Sends made for this field, driving both the remaining budget and the resend backoff. */
	sends: number;
	lastSentAt: Date | null;
}

export interface PendingSignupDoc {
	_id: string;
	/**
	 * The session this signup belongs to.
	 *
	 * Unique, so opening the form in a second tab continues one signup rather than starting a
	 * rival that would race the first to the same address.
	 */
	sessionKey: string;
	origin: string;
	email: PendingSignupFieldState;
	phone: PendingSignupFieldState;
	displayName: string | null;
	marketingOptIn: boolean;
	/** Captured at the start so a guest cart survives a multi-step signup and merges at creation. */
	guestCartId: string | null;
	/**
	 * Provider identity, held server-side for exactly the reason the verified values are:
	 * a client that could re-post a subject at finalisation could post somebody else's.
	 */
	provider: string | null;
	providerSubject: string | null;
	createdAt: Date;
	/**
	 * Sliding expiry, extended by each verification or send and capped by `absoluteExpiresAt`.
	 *
	 * A fixed fifteen minutes would guillotine somebody in the middle of typing a code that is
	 * still valid — the code outliving its own container is a worse experience than either
	 * limit alone suggests.
	 */
	expiresAt: Date;
	absoluteExpiresAt: Date;
}

const fieldState = () =>
	new Schema<PendingSignupFieldState>(
		{
			value: { type: String, default: null },
			verified: { type: Boolean, default: false },
			locked: { type: Boolean, default: false },
			sends: { type: Number, default: 0 },
			lastSentAt: { type: Date, default: null },
		},
		{ _id: false },
	);

const PendingSignupSchema = new Schema<PendingSignupDoc>(
	{
		_id: { type: String, required: true },
		sessionKey: { type: String, required: true },
		origin: { type: String, enum: SignupOrigin.options, required: true },
		email: { type: fieldState(), required: true },
		phone: { type: fieldState(), required: true },
		displayName: { type: String, default: null },
		marketingOptIn: { type: Boolean, default: false },
		guestCartId: { type: String, default: null },
		provider: { type: String, enum: [...OAuthProvider.options, null], default: null },
		providerSubject: { type: String, default: null },
		expiresAt: { type: Date, required: true },
		absoluteExpiresAt: { type: Date, required: true },
	},
	{ collection: COLLECTION_NAMES.PendingSignup, timestamps: { createdAt: true, updatedAt: false } },
);

/** One live signup per session; a second tab joins it rather than competing with it. */
PendingSignupSchema.index({ sessionKey: 1 }, { unique: true });

/**
 * Mongo deletes the row once the sliding window closes.
 *
 * Abandonment is the common case — people change their minds halfway through a form — so
 * cleanup has to be automatic rather than a job somebody remembers to run. Note there is
 * deliberately NO unique index on the email or phone: see the class comment.
 */
PendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PendingSignupModel: Model<PendingSignupDoc> =
	(models.PendingSignup as Model<PendingSignupDoc>) ?? model<PendingSignupDoc>('PendingSignup', PendingSignupSchema);
