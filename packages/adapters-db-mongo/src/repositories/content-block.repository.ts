import { type ContentBlock, contentBlockAssetIds } from '@saha-textile/contracts';
import type { ContentBlockFilter, ContentBlockRepository } from '@saha-textile/core-domain';

import { ContentBlockModel, type ContentBlockDoc } from '../models/index';

const isoOrNull = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

const toBlock = (doc: ContentBlockDoc): ContentBlock =>
	({
		id: doc._id,
		key: doc.key,
		ownerType: doc.ownerType,
		ownerId: doc.ownerId ?? null,
		position: doc.position,
		slot: doc.slot,
		images: { desktop: doc.images.desktop, tablet: doc.images.tablet ?? null, phone: doc.images.phone ?? null },
		containsText: doc.containsText,
		localeImages: doc.localeImages ?? {},
		heading: doc.heading ?? {},
		subheading: doc.subheading ?? {},
		ctaLabel: doc.ctaLabel ?? {},
		link: doc.link ?? null,
		alt: doc.alt ?? {},
		status: doc.status,
		startsAt: isoOrNull(doc.startsAt),
		endsAt: isoOrNull(doc.endsAt),
		createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
		updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
	}) as ContentBlock;

export class MongoContentBlockRepository implements ContentBlockRepository {
	async findByKey(key: string): Promise<ContentBlock | null> {
		const doc = await ContentBlockModel.findOne({ key }).lean<ContentBlockDoc>().exec();
		return doc ? toBlock(doc) : null;
	}

	async list(filter: ContentBlockFilter): Promise<ContentBlock[]> {
		const query: Record<string, unknown> = {};
		if (filter.ownerType) query.ownerType = filter.ownerType;
		if (filter.ownerId !== undefined) query.ownerId = filter.ownerId;
		if (filter.position) query.position = filter.position;
		if (filter.status) query.status = filter.status;
		const docs = await ContentBlockModel.find(query).sort({ key: 1 }).lean<ContentBlockDoc[]>().exec();
		return docs.map(toBlock);
	}

	async listLive(input: {
		ownerType: ContentBlock['ownerType'];
		ownerId: string | null;
		now: string;
	}): Promise<ContentBlock[]> {
		const now = new Date(input.now);
		const docs = await ContentBlockModel.find({
			ownerType: input.ownerType,
			ownerId: input.ownerId,
			status: 'active',
			$and: [
				{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
				{ $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
			],
		})
			.sort({ key: 1 })
			.lean<ContentBlockDoc[]>()
			.exec();
		return docs.map(toBlock);
	}

	async save(block: ContentBlock): Promise<ContentBlock> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, startsAt, endsAt, ...rest } = block;
		await ContentBlockModel.updateOne(
			{ _id: id },
			{
				$set: {
					...rest,
					assetIds: contentBlockAssetIds(block),
					startsAt: startsAt ? new Date(startsAt) : null,
					endsAt: endsAt ? new Date(endsAt) : null,
				},
			},
			{ upsert: true },
		).exec();
		return block;
	}

	async deleteByKey(key: string): Promise<void> {
		await ContentBlockModel.deleteOne({ key }).exec();
	}
}
