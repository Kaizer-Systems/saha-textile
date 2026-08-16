import type {
	PendingSignup,
	PendingSignupField,
	PendingSignupFieldName,
	PendingSignupRepository,
} from '@saha-textile/core-domain';

import {
	PendingSignupModel,
	type PendingSignupDoc,
	type PendingSignupFieldState,
} from '../models/pending-signup.model';

/**
 * Mongo-backed pending signups (`DEC-SIGNUP-VERIFICATION`).
 *
 * Every mutation is a single atomic `findOneAndUpdate`. Read-modify-write would let two tabs
 * interleave — one recording a send while the other records a verification — and lose whichever
 * update landed first. The document is small and short-lived, so there is no reason to take
 * that risk for a marginal saving.
 */
export class MongoPendingSignupRepository implements PendingSignupRepository {
	async start(pending: PendingSignup): Promise<PendingSignup> {
		// Upsert on the session: starting over replaces the abandoned attempt rather than
		// colliding with it. Someone who walked away should not be refused by their own ghost.
		//
		// `_id` goes in `$setOnInsert`, never `$set`: Mongo rejects any update that touches the
		// immutable id, so including it would make every RESTART fail while a first attempt
		// succeeded — a bug that only appears for the returning user.
		const { _id, ...mutable } = toDoc(pending);
		const doc = await PendingSignupModel.findOneAndUpdate(
			{ sessionKey: pending.sessionKey },
			{ $set: mutable, $setOnInsert: { _id } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		)
			.lean<PendingSignupDoc>()
			.exec();
		return toDomain(doc);
	}

	async findBySessionKey(sessionKey: string): Promise<PendingSignup | null> {
		const doc = await PendingSignupModel.findOne({ sessionKey }).lean<PendingSignupDoc>().exec();
		return doc ? toDomain(doc) : null;
	}

	async setFieldValue(id: string, field: PendingSignupFieldName, value: string): Promise<PendingSignup | null> {
		// Verified is cleared in the SAME update as the value. Two writes would leave a window in
		// which a new address wore the old address's proof.
		return this.update(id, {
			[`${field}.value`]: value,
			[`${field}.verified`]: false,
		});
	}

	async recordSend(
		id: string,
		field: PendingSignupFieldName,
		sentAt: string,
		expiresAt: string,
	): Promise<PendingSignup | null> {
		const doc = await PendingSignupModel.findOneAndUpdate(
			{ _id: id },
			{
				$inc: { [`${field}.sends`]: 1 },
				$set: { [`${field}.lastSentAt`]: new Date(sentAt), expiresAt: new Date(expiresAt) },
			},
			{ new: true },
		)
			.lean<PendingSignupDoc>()
			.exec();
		return doc ? toDomain(doc) : null;
	}

	async markVerified(id: string, field: PendingSignupFieldName, expiresAt: string): Promise<PendingSignup | null> {
		return this.update(id, { [`${field}.verified`]: true, expiresAt: new Date(expiresAt) });
	}

	async attachProvider(
		id: string,
		provider: 'google' | 'facebook',
		subject: string,
		expiresAt: string,
	): Promise<PendingSignup | null> {
		return this.update(id, { provider, providerSubject: subject, expiresAt: new Date(expiresAt) });
	}

	/**
	 * Reads and deletes in one step.
	 *
	 * The single-use guarantee. Two finalise requests racing the same proof would otherwise both
	 * read a live record and both mint an account; here the loser gets `null` and is told the
	 * signup expired — which is the truth from its point of view.
	 */
	async consume(id: string): Promise<PendingSignup | null> {
		const doc = await PendingSignupModel.findOneAndDelete({ _id: id }).lean<PendingSignupDoc>().exec();
		return doc ? toDomain(doc) : null;
	}

	async deleteBySessionKey(sessionKey: string): Promise<boolean> {
		const result = await PendingSignupModel.deleteOne({ sessionKey }).exec();
		return (result.deletedCount ?? 0) > 0;
	}

	private async update(id: string, set: Record<string, unknown>): Promise<PendingSignup | null> {
		const doc = await PendingSignupModel.findOneAndUpdate({ _id: id }, { $set: set }, { new: true })
			.lean<PendingSignupDoc>()
			.exec();
		return doc ? toDomain(doc) : null;
	}
}

function toDocField(field: PendingSignupField): PendingSignupFieldState {
	return {
		value: field.value,
		verified: field.verified,
		locked: field.locked,
		sends: field.sends,
		lastSentAt: field.lastSentAt ? new Date(field.lastSentAt) : null,
	};
}

function toDomainField(state: PendingSignupFieldState): PendingSignupField {
	return {
		value: state.value,
		verified: state.verified,
		locked: state.locked,
		sends: state.sends,
		lastSentAt: state.lastSentAt ? state.lastSentAt.toISOString() : null,
	};
}

function toDoc(pending: PendingSignup): Omit<PendingSignupDoc, 'createdAt'> {
	return {
		_id: pending.id,
		sessionKey: pending.sessionKey,
		origin: pending.origin,
		email: toDocField(pending.email),
		phone: toDocField(pending.phone),
		displayName: pending.displayName,
		marketingOptIn: pending.marketingOptIn,
		guestCartId: pending.guestCartId,
		provider: pending.provider,
		providerSubject: pending.providerSubject,
		expiresAt: new Date(pending.expiresAt),
		absoluteExpiresAt: new Date(pending.absoluteExpiresAt),
	};
}

/** Mongoose documents never escape the adapter; ISO strings cross the port. */
function toDomain(doc: PendingSignupDoc): PendingSignup {
	return {
		id: doc._id,
		sessionKey: doc.sessionKey,
		origin: doc.origin as PendingSignup['origin'],
		email: toDomainField(doc.email),
		phone: toDomainField(doc.phone),
		displayName: doc.displayName,
		marketingOptIn: doc.marketingOptIn,
		guestCartId: doc.guestCartId,
		provider: doc.provider as PendingSignup['provider'],
		providerSubject: doc.providerSubject,
		createdAt: doc.createdAt.toISOString(),
		expiresAt: doc.expiresAt.toISOString(),
		absoluteExpiresAt: doc.absoluteExpiresAt.toISOString(),
	};
}
