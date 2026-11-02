import type { MediaAsset } from '@saha-textile/contracts';
import type { MediaAssetFilter, MediaAssetRepository, Paginated } from '@saha-textile/core-domain';

import { MediaAssetModel, type MediaAssetDoc } from '../models/index';
import { MEDIA_OWNER_REGISTRY } from './media-owner-registry';

const iso = (value?: Date): string | undefined => (value ? new Date(value).toISOString() : undefined);
const isoOrNull = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);
const dateOrNull = (value: string | null): Date | null => (value ? new Date(value) : null);
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toAsset = (doc: MediaAssetDoc): MediaAsset =>
	({
		id: doc._id,
		kind: doc.kind,
		purpose: doc.purpose ?? 'product',
		originalStorageKey: doc.originalStorageKey ?? null,
		originalFormat: doc.originalFormat,
		originalByteSize: doc.originalByteSize,
		width: doc.width ?? null,
		height: doc.height ?? null,
		slug: doc.slug ?? 'image',
		derivatives: doc.derivatives ?? [],
		dominantColor: doc.dominantColor ?? null,
		thumbHash: doc.thumbHash ?? null,
		visibility: doc.visibility ?? 'public',
		processing: {
			state: doc.processing?.state ?? 'awaiting_upload',
			attempts: doc.processing?.attempts ?? 0,
			error: doc.processing?.error ?? null,
			processedAt: isoOrNull(doc.processing?.processedAt),
		},
		warnings: doc.warnings ?? [],
		servesAsPrimary: doc.servesAsPrimary ?? false,
		maxDisplayWidth: doc.maxDisplayWidth ?? null,
		renditions: doc.renditions ?? [],
		hlsPlaylistKey: doc.hlsPlaylistKey ?? null,
		durationSeconds: doc.durationSeconds ?? null,
		text: doc.text ?? { alt: {}, title: {}, caption: {} },
		status: doc.status,
		uploadedBy: doc.uploadedBy ?? null,
		deletedAt: isoOrNull(doc.deletedAt),
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as MediaAsset;

/** The persisted shape of an asset, minus the id and timestamps Mongo owns. */
const toDoc = (asset: MediaAsset) => {
	const { id: _id, deletedAt, createdAt: _createdAt, updatedAt: _updatedAt, processing, ...rest } = asset;
	return {
		...rest,
		processing: { ...processing, processedAt: dateOrNull(processing.processedAt) },
		deletedAt: dateOrNull(deletedAt),
	};
};

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
		if (filter.purpose) query.purpose = filter.purpose;
		// Soft-deleted assets are hidden unless the caller is a GC/admin surface asking for them.
		if (!filter.includeDeleted) query.deletedAt = null;
		if (filter.search) {
			const pattern = new RegExp(escapeRegex(filter.search), 'i');
			query.$or = [{ slug: pattern }, { 'text.alt.en': pattern }, { _id: pattern }];
		}

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
		await MediaAssetModel.create([{ _id: asset.id, ...toDoc(asset) }]);
		return asset;
	}

	async update(asset: MediaAsset): Promise<MediaAsset> {
		await MediaAssetModel.updateOne({ _id: asset.id }, { $set: toDoc(asset) }).exec();
		return asset;
	}

	/**
	 * Counts the owners currently pointing at this asset, across every registered path
	 * (`MEDIA_OWNER_REGISTRY`). Assets are REUSABLE, so detaching one owner must never delete
	 * bytes another still renders.
	 */
	async countReferences(assetId: string): Promise<number> {
		const counts = await Promise.all(
			MEDIA_OWNER_REGISTRY.map((owner) => owner.model.countDocuments({ [owner.path]: assetId }).exec()),
		);
		return counts.reduce((sum, count) => sum + count, 0);
	}

	async claimForProcessing(assetId: string, options?: { allowReady?: boolean }): Promise<MediaAsset | null> {
		const states = ['queued', 'failed', ...(options?.allowReady ? ['ready'] : [])];
		const doc = await MediaAssetModel.findOneAndUpdate(
			{ _id: assetId, 'processing.state': { $in: states }, deletedAt: null },
			{ $set: { 'processing.state': 'processing' }, $inc: { 'processing.attempts': 1 } },
			{ new: true },
		)
			.lean<MediaAssetDoc>()
			.exec();
		return doc ? toAsset(doc) : null;
	}

	async listStaleForRole(input: { role: string; version: number; limit: number }): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({
			deletedAt: null,
			derivatives: { $elemMatch: { role: input.role, roleVersion: { $lt: input.version } } },
		})
			.limit(input.limit)
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async listLiveCreatedBefore(input: {
		createdBefore: string;
		afterId: string | null;
		limit: number;
	}): Promise<MediaAsset[]> {
		const query: Record<string, unknown> = { deletedAt: null, createdAt: { $lt: new Date(input.createdBefore) } };
		if (input.afterId) query._id = { $gt: input.afterId };
		const docs = await MediaAssetModel.find(query)
			.sort({ _id: 1 })
			.limit(input.limit)
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	/** Soft-deleted before the cutoff — the GC job's work list. */
	async listOrphans(input: { deletedBefore: string; limit: number }): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({
			deletedAt: { $ne: null, $lte: new Date(input.deletedBefore) },
		})
			.sort({ _id: 1 })
			.limit(input.limit)
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async softDelete(assetId: string, at: string): Promise<void> {
		await MediaAssetModel.updateOne({ _id: assetId }, { $set: { deletedAt: new Date(at) } }).exec();
	}

	async restore(assetId: string): Promise<void> {
		await MediaAssetModel.updateOne({ _id: assetId }, { $set: { deletedAt: null } }).exec();
	}

	/**
	 * Hard delete — only for a GC'd orphan or an explicit privacy/legal purge. The caller
	 * must have confirmed `countReferences === 0` and that the grace period elapsed;
	 * removing the Spaces objects is the caller's job too, since storage is a separate port.
	 */
	async hardDelete(assetId: string): Promise<void> {
		await MediaAssetModel.deleteOne({ _id: assetId }).exec();
	}
}
