import type { MediaAsset } from '@saha-textile/contracts';
import type { MediaAssetFilter, MediaAssetRepository, Paginated } from '@saha-textile/core-domain';

import {
	AttributeDefinitionModel,
	MediaAssetModel,
	type MediaAssetDoc,
	ProductModel,
	ProductVariantModel,
} from '../models/index';

const iso = (value?: Date): string | undefined => (value ? new Date(value).toISOString() : undefined);
const isoOrNull = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);

const toAsset = (doc: MediaAssetDoc): MediaAsset =>
	({
		id: doc._id,
		kind: doc.kind,
		originalStorageKey: doc.originalStorageKey ?? null,
		originalFormat: doc.originalFormat,
		originalByteSize: doc.originalByteSize,
		width: doc.width ?? null,
		height: doc.height ?? null,
		fullWebpStorageKey: doc.fullWebpStorageKey ?? null,
		derivatives: doc.derivatives ?? [],
		renditions: doc.renditions ?? [],
		hlsPlaylistKey: doc.hlsPlaylistKey ?? null,
		durationSeconds: doc.durationSeconds ?? null,
		text: doc.text ?? { alt: {}, title: {}, caption: {} },
		status: doc.status,
		deletedAt: isoOrNull(doc.deletedAt),
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as MediaAsset;

export class MongoMediaAssetRepository implements MediaAssetRepository {
	async findById(assetId: string): Promise<MediaAsset | null> {
		const doc = await MediaAssetModel.findById(assetId).lean<MediaAssetDoc>().exec();
		return doc ? toAsset(doc) : null;
	}

	async findManyByIds(assetIds: readonly string[]): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({ _id: { $in: [...assetIds] } })
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async list(filter: MediaAssetFilter): Promise<Paginated<MediaAsset>> {
		const query: Record<string, unknown> = {};
		if (filter.kind) query.kind = filter.kind;
		if (filter.status) query.status = filter.status;
		// Soft-deleted assets are hidden unless the caller is a GC/admin surface asking for them.
		if (!filter.includeDeleted) query.deletedAt = null;
		if (filter.search) query._id = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 24;

		const [docs, total] = await Promise.all([
			MediaAssetModel.find(query)
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<MediaAssetDoc[]>()
				.exec(),
			MediaAssetModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toAsset), total, page, pageSize };
	}

	async create(asset: MediaAsset): Promise<MediaAsset> {
		const { id, deletedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = asset;
		await MediaAssetModel.create([{ _id: id, ...rest, deletedAt: deletedAt ? new Date(deletedAt) : null }]);
		return asset;
	}

	async update(asset: MediaAsset): Promise<MediaAsset> {
		const { id, deletedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = asset;
		await MediaAssetModel.updateOne(
			{ _id: id },
			{ $set: { ...rest, deletedAt: deletedAt ? new Date(deletedAt) : null } },
		).exec();
		return asset;
	}

	/**
	 * Counts the owners currently pointing at this asset.
	 *
	 * This is what makes orphan collection safe: assets are REUSABLE, so detaching one
	 * owner must never delete bytes another owner still renders. Every owning surface has
	 * to be counted here — a missed one would let a referenced asset be collected, and the
	 * failure would show up as a broken image long after the delete.
	 *
	 * Owners today: product galleries, variant primary images, and attribute-term swatches.
	 * Reviews and content blocks join this list as those collections land.
	 */
	async countReferences(assetId: string): Promise<number> {
		const [products, variants, attributes] = await Promise.all([
			ProductModel.countDocuments({ 'media.gallery': assetId }).exec(),
			ProductVariantModel.countDocuments({ 'media.primaryAssetId': assetId }).exec(),
			AttributeDefinitionModel.countDocuments({ 'terms.swatchAssetId': assetId }).exec(),
		]);
		return products + variants + attributes;
	}

	/** Soft-deleted before the cutoff — the GC job's work list. */
	async listOrphans(input: { deletedBefore: string; limit: number }): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({
			deletedAt: { $ne: null, $lte: new Date(input.deletedBefore) },
		})
			.limit(input.limit)
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async softDelete(assetId: string, at: string): Promise<void> {
		await MediaAssetModel.updateOne({ _id: assetId }, { $set: { deletedAt: new Date(at) } }).exec();
	}

	/**
	 * Hard delete — only for a GC'd orphan or an explicit privacy/legal purge. The caller
	 * must have confirmed `countReferences === 0` and that the grace period elapsed;
	 * removing the Spaces object is the caller's job too, since storage is a separate port.
	 */
	async hardDelete(assetId: string): Promise<void> {
		await MediaAssetModel.deleteOne({ _id: assetId }).exec();
	}
}
