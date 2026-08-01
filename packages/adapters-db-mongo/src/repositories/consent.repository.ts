import type { ConsentEvent } from '@saha-textile/contracts';
import type { ConsentRepository, PageQuery, Paginated, TransactionContext } from '@saha-textile/core-domain';

import { ConsentEventModel, type ConsentEventDoc } from '../models/index';

const toEvent = (doc: ConsentEventDoc): ConsentEvent => ({
	id: doc._id,
	userId: doc.userId ?? null,
	guestId: doc.guestId ?? null,
	categories: doc.categories as ConsentEvent['categories'],
	policyVersion: doc.policyVersion,
	source: doc.source as ConsentEvent['source'],
	ipHash: doc.ipHash ?? null,
	userAgentHash: doc.userAgentHash ?? null,
	createdAt: new Date(doc.createdAt).toISOString(),
});

/** Append-only: there is no update or delete, because consent history is evidence. */
export class MongoConsentRepository implements ConsentRepository {
	async findLatestForUser(userId: string): Promise<ConsentEvent | null> {
		const doc = await ConsentEventModel.findOne({ userId }).sort({ createdAt: -1 }).lean<ConsentEventDoc>().exec();
		return doc ? toEvent(doc) : null;
	}

	async findLatestForGuest(guestIdHash: string): Promise<ConsentEvent | null> {
		const doc = await ConsentEventModel.findOne({ guestId: guestIdHash })
			.sort({ createdAt: -1 })
			.lean<ConsentEventDoc>()
			.exec();
		return doc ? toEvent(doc) : null;
	}

	async append(event: ConsentEvent, _context?: TransactionContext): Promise<ConsentEvent> {
		const { id, createdAt, ...rest } = event;
		await ConsentEventModel.create([{ _id: id, ...rest, createdAt: new Date(createdAt) }]);
		return event;
	}

	async listForUser(userId: string, page: PageQuery): Promise<Paginated<ConsentEvent>> {
		const pageNumber = page.page && page.page > 0 ? page.page : 1;
		const pageSize = page.pageSize && page.pageSize > 0 ? page.pageSize : 20;

		const [docs, total] = await Promise.all([
			ConsentEventModel.find({ userId })
				.sort({ createdAt: -1 })
				.skip((pageNumber - 1) * pageSize)
				.limit(pageSize)
				.lean<ConsentEventDoc[]>()
				.exec(),
			ConsentEventModel.countDocuments({ userId }).exec(),
		]);

		return { items: docs.map(toEvent), total, page: pageNumber, pageSize };
	}
}
