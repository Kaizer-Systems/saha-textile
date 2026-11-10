import { randomUUID } from 'node:crypto';

import {
	searchRetryDelayMs,
	type SearchCheckResult,
	type SearchOutboxEntry,
	type SearchOutboxKey,
	type SearchOutboxRepository,
	type SearchOutboxStats,
} from '@saha-textile/core-domain';

import { SearchCheckModel, SearchOutboxModel, type SearchOutboxDoc } from '../models/search-outbox.model';
import { sessionFrom } from '../transaction-manager';

const toEntry = (row: SearchOutboxDoc): SearchOutboxEntry => ({
	productId: row._id,
	changedAt: row.changedAt,
	attempts: row.attempts ?? 0,
	nextAttemptAt: row.nextAttemptAt,
	lastError: row.lastError ?? null,
	doneAt: row.doneAt ?? null,
});

/** The search change queue in Mongo. A request inside a save's transaction joins it. */
export class MongoSearchOutboxRepository implements SearchOutboxRepository {
	async request(productIds: readonly string[], at: Date): Promise<void> {
		if (!productIds.length) return;
		await SearchOutboxModel.bulkWrite(
			productIds.map((id) => ({
				updateOne: {
					filter: { _id: id },
					update: { $set: { changedAt: at, attempts: 0, nextAttemptAt: at, lastError: null, doneAt: null } },
					upsert: true,
				},
			})),
			{ session: sessionFrom() },
		);
	}

	async due(now: Date, limit: number): Promise<SearchOutboxEntry[]> {
		const rows = await SearchOutboxModel.find({ doneAt: null, nextAttemptAt: { $lte: now } })
			.sort({ changedAt: 1 })
			.limit(limit)
			.lean<SearchOutboxDoc[]>()
			.exec();
		return rows.map(toEntry);
	}

	async changedSince(since: Date, limit: number, afterProductId?: string): Promise<SearchOutboxEntry[]> {
		const rows = await SearchOutboxModel.find({
			changedAt: { $gte: since },
			...(afterProductId ? { _id: { $gt: afterProductId } } : {}),
		})
			.sort({ _id: 1 })
			.limit(limit)
			.lean<SearchOutboxDoc[]>()
			.exec();
		return rows.map(toEntry);
	}

	async markDone(entries: readonly SearchOutboxKey[], at: Date): Promise<void> {
		if (!entries.length) return;
		await SearchOutboxModel.bulkWrite(
			entries.map((entry) => ({
				updateOne: {
					filter: { _id: entry.productId, changedAt: entry.changedAt },
					update: { $set: { doneAt: at, lastError: null } },
				},
			})),
		);
	}

	async markFailed(entries: readonly SearchOutboxKey[], error: string, now: Date): Promise<void> {
		for (const entry of entries) {
			const row = await SearchOutboxModel.findOneAndUpdate(
				{ _id: entry.productId, changedAt: entry.changedAt, doneAt: null },
				{ $inc: { attempts: 1 }, $set: { lastError: error.slice(0, 500) } },
				{ new: true },
			)
				.lean<SearchOutboxDoc>()
				.exec();
			if (!row) continue;
			await SearchOutboxModel.updateOne(
				{ _id: row._id, changedAt: row.changedAt },
				{ $set: { nextAttemptAt: new Date(now.getTime() + searchRetryDelayMs(row.attempts)) } },
			).exec();
		}
	}

	async stats(): Promise<SearchOutboxStats> {
		const [waiting, failing, oldest] = await Promise.all([
			SearchOutboxModel.countDocuments({ doneAt: null }).exec(),
			SearchOutboxModel.countDocuments({ doneAt: null, attempts: { $gt: 0 } }).exec(),
			SearchOutboxModel.findOne({ doneAt: null }).sort({ changedAt: 1 }).lean<SearchOutboxDoc>().exec(),
		]);
		return { waiting, failing, oldestWaitingAt: oldest?.changedAt ?? null };
	}

	async recordCheck(result: SearchCheckResult): Promise<void> {
		await SearchCheckModel.create({ _id: `check_${randomUUID()}`, ...result });
	}

	async lastCheck(): Promise<SearchCheckResult | null> {
		const row = await SearchCheckModel.findOne().sort({ checkedAt: -1 }).lean<SearchCheckResult>().exec();
		if (!row) return null;
		const { checkedAt, live, indexed, missing, extra, recent, requested } = row;
		return { checkedAt, live, indexed, missing, extra, recent, requested };
	}
}
