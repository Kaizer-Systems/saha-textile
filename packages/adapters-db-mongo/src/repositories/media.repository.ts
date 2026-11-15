import type { MediaAsset } from '@saha-textile/contracts';
import {
	type MediaAssetFilter,
	type MediaAssetRepository,
	type MediaBrowseFilter,
	type MediaBrowseRepository,
	type Paginated,
	mediaCategory,
} from '@saha-textile/core-domain';

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
		versions: doc.versions ?? [],
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
		folderId: doc.folderId ?? null,
		displayName: doc.displayName ?? null,
		sha256: doc.sha256 ?? null,
		trashedAt: isoOrNull(doc.trashedAt),
		trashedFrom: doc.trashedFrom ?? null,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as MediaAsset;

/** The persisted shape of an asset, minus the id and timestamps Mongo owns. */
const toDoc = (asset: MediaAsset) => {
	const { id: _id, deletedAt, createdAt: _createdAt, updatedAt: _updatedAt, processing, trashedAt, ...rest } = asset;
	return {
		...rest,
		processing: { ...processing, processedAt: dateOrNull(processing.processedAt) },
		deletedAt: dateOrNull(deletedAt),
		folderId: asset.folderId ?? null,
		displayName: asset.displayName ?? null,
		sha256: asset.sha256 ?? null,
		trashedAt: dateOrNull(trashedAt ?? null),
		trashedFrom: asset.trashedFrom ?? null,
		// Stored so the Media page can filter by it with an index.
		category: mediaCategory(asset.originalFormat, asset.displayName ?? asset.slug),
	};
};

/** The bytes an asset takes, for the size sort. */
const sizeField = {
	$add: [
		{ $ifNull: ['$originalByteSize', 0] },
		{ $sum: { $map: { input: { $ifNull: ['$derivatives', []] }, as: 'd', in: { $ifNull: ['$$d.byteSize', 0] } } } },
	],
};

export class MongoMediaAssetRepository implements MediaAssetRepository, MediaBrowseRepository {
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
			{ returnDocument: 'after' },
		)
			.lean<MediaAssetDoc>()
			.exec();
		return doc ? toAsset(doc) : null;
	}

	async settleVersions(input: Parameters<MediaAssetRepository['settleVersions']>[0]): Promise<MediaAsset | null> {
		const { processing, ...facts } = input.set;
		const $set: Record<string, unknown> = {
			...facts,
			'processing.state': processing.state,
			'processing.error': processing.error,
			'processing.processedAt': dateOrNull(processing.processedAt),
		};
		const arrayFilters = input.versions.map((version, index) => ({ [`v${index}.id`]: version.id }));
		input.versions.forEach((version, index) => {
			$set[`versions.$[v${index}]`] = version;
		});
		const doc = await MediaAssetModel.findOneAndUpdate(
			{ _id: input.assetId },
			{
				$set,
				...(input.addDerivatives.length
					? { $push: { derivatives: { $each: [...input.addDerivatives] } } }
					: {}),
			},
			{ arrayFilters, returnDocument: 'after' },
		)
			.lean<MediaAssetDoc>()
			.exec();
		return doc ? toAsset(doc) : null;
	}

	/**
	 * Files made before photo versions existed, older than their role's settings. Files of a version are written
	 * once (Media brief R4-1): a ladder edit applies to versions made afterwards, never to these.
	 */
	async listStaleForRole(input: { role: string; version: number; limit: number }): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({
			deletedAt: null,
			derivatives: {
				$elemMatch: { role: input.role, roleVersion: { $lt: input.version }, versionId: { $exists: false } },
			},
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
	// --- The Media page (step 1) ------------------------------------------------------------

	async browse(filter: MediaBrowseFilter): Promise<Paginated<MediaAsset>> {
		const query: Record<string, unknown> = { deletedAt: null, trashedAt: filter.trashed ? { $ne: null } : null };
		if (filter.folderId !== undefined) query.folderId = filter.folderId;
		if (filter.withinFolders) query.folderId = { $in: [...filter.withinFolders] };
		if (filter.categories?.length) {
			const wanted = filter.category
				? filter.categories.filter((one) => one === filter.category)
				: filter.categories;
			query.category = { $in: [...wanted] };
		} else if (filter.category) query.category = filter.category;
		if (filter.ids || filter.excludeIds) {
			query._id = {
				...(filter.ids ? { $in: [...filter.ids] } : {}),
				...(filter.excludeIds ? { $nin: [...filter.excludeIds] } : {}),
			};
		}
		if (filter.states?.length) query['processing.state'] = { $in: [...filter.states] };
		if (filter.minBytes !== undefined || filter.maxBytes !== undefined) {
			query.originalByteSize = {
				...(filter.minBytes !== undefined ? { $gte: filter.minBytes } : {}),
				...(filter.maxBytes !== undefined ? { $lt: filter.maxBytes } : {}),
			};
		}
		if (filter.createdSince) query.createdAt = { $gte: new Date(filter.createdSince) };
		const words = (filter.search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
		if (words.length) {
			query.$and = words.map((word) => {
				const pattern = new RegExp(escapeRegex(word), 'i');
				return {
					$or: [
						{ displayName: pattern },
						{ slug: pattern },
						{ 'text.alt.en': pattern },
						{ 'text.alt.bn': pattern },
					],
				};
			});
		}
		const direction = filter.direction === 'desc' ? -1 : 1;
		const page = Math.max(1, filter.page);
		const pageSize = Math.max(1, filter.pageSize);
		const sort: Record<string, 1 | -1> =
			filter.sort === 'created'
				? { createdAt: direction, _id: direction }
				: filter.sort === 'size'
					? { size: direction, _id: 1 }
					: { sortName: direction, _id: 1 };
		const [rows, total] = await Promise.all([
			MediaAssetModel.aggregate<MediaAssetDoc>([
				{ $match: query },
				{ $addFields: { size: sizeField, sortName: { $toLower: { $ifNull: ['$displayName', '$slug'] } } } },
				{ $sort: sort },
				{ $skip: (page - 1) * pageSize },
				{ $limit: pageSize },
			]).exec(),
			MediaAssetModel.countDocuments(query).exec(),
		]);
		return { items: rows.map(toAsset), total, page, pageSize };
	}

	async findBySha256(hashes: readonly string[]): Promise<MediaAsset[]> {
		if (!hashes.length) return [];
		const docs = await MediaAssetModel.find({ sha256: { $in: [...hashes] }, deletedAt: null, trashedAt: null })
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async namesIn(folderId: string | null): Promise<string[]> {
		const docs = await MediaAssetModel.find({ folderId, deletedAt: null, trashedAt: null })
			.select({ displayName: 1, slug: 1 })
			.lean<Pick<MediaAssetDoc, 'displayName' | 'slug'>[]>()
			.exec();
		return docs.map((doc) => doc.displayName ?? doc.slug);
	}

	async findNamedIn(folderId: string | null, names: readonly string[]): Promise<MediaAsset[]> {
		if (!names.length) return [];
		const list = [...names];
		// A file shows its Media name, or its web file name when it has none (older photos).
		const docs = await MediaAssetModel.find({
			folderId,
			deletedAt: null,
			trashedAt: null,
			$or: [{ displayName: { $in: list } }, { displayName: null, slug: { $in: list } }],
		})
			.collation({ locale: 'en', strength: 2 })
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async moveTo(ids: readonly string[], folderId: string | null): Promise<void> {
		await MediaAssetModel.updateMany({ _id: { $in: [...ids] } }, { $set: { folderId } }).exec();
	}

	async rename(id: string, name: string): Promise<void> {
		await MediaAssetModel.updateOne({ _id: id }, { $set: { displayName: name } }).exec();
	}

	async setTrashed(
		ids: readonly string[],
		at: string | null,
		from: ReadonlyMap<string, string | null>,
		restoreTo?: ReadonlyMap<string, string | null>,
	): Promise<void> {
		for (const id of ids) {
			const set = at
				? { trashedAt: new Date(at), trashedFrom: from.get(id) ?? null }
				: {
						trashedAt: null,
						trashedFrom: null,
						...(restoreTo?.has(id) ? { folderId: restoreTo.get(id) ?? null } : {}),
					};
			await MediaAssetModel.updateOne({ _id: id }, { $set: set }).exec();
		}
	}

	async usage(): Promise<{ originals: number; versions: number; files: number; trash: number }> {
		const rows = await MediaAssetModel.aggregate<{
			_id: { trashed: boolean; kind: string };
			originals: number;
			versions: number;
		}>([
			{ $match: { deletedAt: null } },
			{
				$group: {
					_id: { trashed: { $ne: [{ $ifNull: ['$trashedAt', null] }, null] }, kind: '$kind' },
					originals: { $sum: { $ifNull: ['$originalByteSize', 0] } },
					versions: { $sum: { $subtract: [sizeField, { $ifNull: ['$originalByteSize', 0] }] } },
				},
			},
		]).exec();
		const total = { originals: 0, versions: 0, files: 0, trash: 0 };
		for (const row of rows) {
			if (row._id.trashed) total.trash += row.originals + row.versions;
			else if (row._id.kind === 'file') total.files += row.originals;
			else {
				total.originals += row.originals;
				total.versions += row.versions;
			}
		}
		return total;
	}

	async listTrashedBefore(cutoff: string, limit: number): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({ trashedAt: { $ne: null, $lte: new Date(cutoff) }, deletedAt: null })
			.sort({ trashedAt: 1 })
			.limit(limit)
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async listUnfinishedBefore(cutoff: string, limit: number): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({
			'processing.state': 'awaiting_upload',
			deletedAt: null,
			createdAt: { $lt: new Date(cutoff) },
		})
			.sort({ createdAt: 1 })
			.limit(limit)
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}

	async totalsByFolder(folderIds: readonly string[]): Promise<{ folderId: string; files: number; bytes: number }[]> {
		const rows = await MediaAssetModel.aggregate<{ _id: string; files: number; bytes: number }>([
			{ $match: { folderId: { $in: [...folderIds] }, deletedAt: null, trashedAt: null } },
			{ $group: { _id: '$folderId', files: { $sum: 1 }, bytes: { $sum: sizeField } } },
		]).exec();
		return rows.map((row) => ({ folderId: row._id, files: row.files, bytes: row.bytes }));
	}

	async referencedIds(): Promise<string[]> {
		const found = new Set<string>();
		for (const entry of MEDIA_OWNER_REGISTRY) {
			for (const value of await entry.model.collection.distinct(entry.path)) {
				if (typeof value === 'string' && value.startsWith('med_')) found.add(value);
			}
		}
		return [...found];
	}

	async whereUsed(ids: readonly string[]): Promise<Map<string, string[]>> {
		const found = new Map<string, string[]>();
		if (!ids.length) return found;
		const wanted = new Set(ids);
		for (const entry of MEDIA_OWNER_REGISTRY) {
			const owners = await entry.model.collection
				.find({ [entry.path]: { $in: [...ids] } } as never, {
					projection: { [entry.path]: 1, title: 1, name: 1, key: 1, slug: 1 },
				})
				.toArray();
			for (const owner of owners) {
				const name =
					(owner['title'] as Record<string, string> | undefined)?.['en'] ??
					(owner['name'] as Record<string, string> | undefined)?.['en'] ??
					(owner['key'] as string | undefined) ??
					(owner['slug'] as string | undefined) ??
					String(owner['_id']);
				const label = `${entry.owner} · ${name}`;
				const values = JSON.stringify(owner).match(/"(med_[^"]+)"/g) ?? [];
				for (const quoted of new Set(values)) {
					const id = quoted.slice(1, -1);
					if (!wanted.has(id)) continue;
					const list = found.get(id) ?? [];
					if (!list.includes(label)) list.push(label);
					found.set(id, list);
				}
			}
		}
		return found;
	}

	async listInFolders(folderIds: readonly string[]): Promise<MediaAsset[]> {
		const docs = await MediaAssetModel.find({ folderId: { $in: [...folderIds] }, deletedAt: null })
			.lean<MediaAssetDoc[]>()
			.exec();
		return docs.map(toAsset);
	}
}
