import type { PendingContactChange, PendingContactChangeRepository } from '@saha-textile/core-domain';

import { PendingContactChangeModel, type PendingContactChangeDoc } from '../models/pending-contact-change.model';

/**
 * Mongo-backed pending contact changes.
 *
 * Every mutation is a single atomic statement, exactly as `MongoPendingSignupRepository` is: the
 * document is small and short-lived, so there is no saving worth the risk of two tabs
 * interleaving a send and a confirmation and losing whichever landed first.
 */
export class MongoPendingContactChangeRepository implements PendingContactChangeRepository {
	async start(pending: PendingContactChange): Promise<PendingContactChange> {
		// Upsert on the customer: starting over replaces the abandoned attempt rather than
		// colliding with it. `_id` goes in `$setOnInsert` and never in `$set`, because Mongo
		// rejects any update touching the immutable id — including it would make every RESTART
		// fail while a first attempt succeeded, a bug only the returning user ever sees.
		const { _id, ...mutable } = toDoc(pending);
		const doc = await PendingContactChangeModel.findOneAndUpdate(
			{ customerId: pending.customerId },
			{ $set: mutable, $setOnInsert: { _id } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		)
			.lean<PendingContactChangeDoc>()
			.exec();
		return toDomain(doc);
	}

	async findByCustomerId(customerId: string): Promise<PendingContactChange | null> {
		const doc = await PendingContactChangeModel.findOne({ customerId }).lean<PendingContactChangeDoc>().exec();
		return doc ? toDomain(doc) : null;
	}

	async recordSend(id: string, sentAt: string, expiresAt: string): Promise<PendingContactChange | null> {
		const doc = await PendingContactChangeModel.findOneAndUpdate(
			{ _id: id },
			{ $inc: { sends: 1 }, $set: { lastSentAt: new Date(sentAt), expiresAt: new Date(expiresAt) } },
			{ new: true },
		)
			.lean<PendingContactChangeDoc>()
			.exec();
		return doc ? toDomain(doc) : null;
	}

	/**
	 * Reads and deletes in one step.
	 *
	 * The single-use guarantee: two confirmations racing the same proof would otherwise both read
	 * a live record and both swap. The loser gets `null` and is told the change expired, which is
	 * true from where it is standing.
	 */
	async consume(id: string): Promise<PendingContactChange | null> {
		const doc = await PendingContactChangeModel.findOneAndDelete({ _id: id })
			.lean<PendingContactChangeDoc>()
			.exec();
		return doc ? toDomain(doc) : null;
	}

	async deleteByCustomerId(customerId: string): Promise<boolean> {
		const result = await PendingContactChangeModel.deleteOne({ customerId }).exec();
		return (result.deletedCount ?? 0) > 0;
	}
}

function toDoc(pending: PendingContactChange): Omit<PendingContactChangeDoc, 'createdAt'> {
	return {
		_id: pending.id,
		customerId: pending.customerId,
		field: pending.field,
		newValue: pending.newValue,
		sends: pending.sends,
		lastSentAt: pending.lastSentAt ? new Date(pending.lastSentAt) : null,
		expiresAt: new Date(pending.expiresAt),
		absoluteExpiresAt: new Date(pending.absoluteExpiresAt),
	};
}

/** Mongoose documents never escape the adapter; ISO strings cross the port. */
function toDomain(doc: PendingContactChangeDoc): PendingContactChange {
	return {
		id: doc._id,
		customerId: doc.customerId,
		field: doc.field,
		newValue: doc.newValue,
		sends: doc.sends,
		lastSentAt: doc.lastSentAt ? doc.lastSentAt.toISOString() : null,
		createdAt: doc.createdAt.toISOString(),
		expiresAt: doc.expiresAt.toISOString(),
		absoluteExpiresAt: doc.absoluteExpiresAt.toISOString(),
	};
}
