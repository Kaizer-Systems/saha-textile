import { ShopEvent } from '@saha-textile/contracts';
import type { Paginated, ShopEventFilter, ShopEventRepository } from '@saha-textile/core-domain';

import { ShopEventModel, type ShopEventDoc } from '../models/index';

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);
const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

const toEvent = (doc: ShopEventDoc): ShopEvent =>
	ShopEvent.parse({
		id: doc._id,
		type: doc.type,
		name: doc.name,
		title: doc.title ?? {},
		message: doc.message ?? {},
		startsAt: iso(doc.startsAt),
		endsAt: iso(doc.endsAt),
		linkHref: doc.linkHref ?? null,
		showCountdown: doc.showCountdown ?? true,
		showPopup: doc.showPopup ?? true,
		popupAssetId: doc.popupAssetId ?? null,
		nowLiveDays: doc.nowLiveDays ?? 3,
		launch: doc.launch ?? {},
		sale: doc.sale ?? {},
		status: doc.status,
		publishedAt: iso(doc.publishedAt),
		startedAt: iso(doc.startedAt),
		endedAt: iso(doc.endedAt),
		cancelledAt: iso(doc.cancelledAt),
		messageSentAt: iso(doc.messageSentAt),
		launchReport: doc.launchReport ?? null,
		saleRecord: doc.saleRecord ?? null,
		createdAt: iso(doc.createdAt) ?? undefined,
		updatedAt: iso(doc.updatedAt) ?? undefined,
	});

const DATE_FIELDS = [
	'startsAt',
	'endsAt',
	'publishedAt',
	'startedAt',
	'endedAt',
	'cancelledAt',
	'messageSentAt',
] as const;

/** The event's own fields as stored: dates as dates, the id as `_id`, timestamps left to Mongoose. */
function toDoc(event: Partial<ShopEvent>): Record<string, unknown> {
	const { id: _id, createdAt: _created, updatedAt: _updated, ...rest } = event;
	const doc: Record<string, unknown> = { ...rest };
	for (const field of DATE_FIELDS) if (field in event) doc[field] = date(event[field]);
	return doc;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class MongoShopEventRepository implements ShopEventRepository {
	async findById(id: string): Promise<ShopEvent | null> {
		const doc = await ShopEventModel.findById(id).lean<ShopEventDoc>().exec();
		return doc ? toEvent(doc) : null;
	}

	async list(filter: ShopEventFilter): Promise<Paginated<ShopEvent>> {
		const query: Record<string, unknown> = {};
		if (filter.type) query.type = filter.type;
		if (filter.status) query.status = filter.status;
		const words = (filter.search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
		if (words.length) {
			query.$and = words.map((word) => {
				const pattern = new RegExp(escapeRegex(word), 'i');
				return { $or: [{ name: pattern }, { 'title.en': pattern }] };
			});
		}
		const [docs, total] = await Promise.all([
			ShopEventModel.find(query)
				.sort(
					filter.sort
						? { [filter.sort]: filter.direction === 'asc' ? 1 : -1, createdAt: -1, _id: 1 }
						: { startsAt: -1, createdAt: -1, _id: 1 },
				)
				.skip((filter.page - 1) * filter.pageSize)
				.limit(filter.pageSize)
				.lean<ShopEventDoc[]>()
				.exec(),
			ShopEventModel.countDocuments(query).exec(),
		]);
		return { items: docs.map(toEvent), total, page: filter.page, pageSize: filter.pageSize };
	}

	async listPublished(): Promise<ShopEvent[]> {
		const docs = await ShopEventModel.find({ status: { $in: ['scheduled', 'live'] } })
			.sort({ startsAt: 1, _id: 1 })
			.lean<ShopEventDoc[]>()
			.exec();
		return docs.map(toEvent);
	}

	async save(event: ShopEvent): Promise<ShopEvent> {
		const doc = await ShopEventModel.findByIdAndUpdate(
			event.id,
			{ $set: toDoc(event) },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		)
			.lean<ShopEventDoc>()
			.exec();
		return toEvent(doc as ShopEventDoc);
	}

	async transition(id: string, from: ShopEvent['status'], patch: Partial<ShopEvent>): Promise<ShopEvent | null> {
		const doc = await ShopEventModel.findOneAndUpdate(
			{ _id: id, status: from },
			{ $set: toDoc(patch) },
			{ new: true },
		)
			.lean<ShopEventDoc>()
			.exec();
		return doc ? toEvent(doc) : null;
	}

	async remove(id: string): Promise<void> {
		await ShopEventModel.deleteOne({ _id: id }).exec();
	}

	async setPreview(id: string, tokenHash: string, expiresAt: string): Promise<void> {
		await ShopEventModel.updateOne(
			{ _id: id },
			{ $set: { previewTokenHash: tokenHash, previewExpiresAt: new Date(expiresAt) } },
		).exec();
	}

	async findByPreview(tokenHash: string, now: string): Promise<ShopEvent | null> {
		const doc = await ShopEventModel.findOne({
			previewTokenHash: tokenHash,
			previewExpiresAt: { $gt: new Date(now) },
		})
			.lean<ShopEventDoc>()
			.exec();
		return doc ? toEvent(doc) : null;
	}
}
