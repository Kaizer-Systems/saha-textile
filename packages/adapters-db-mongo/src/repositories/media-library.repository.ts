import { MediaFolder, ShareLink } from '@saha-textile/contracts';
import type {
	MediaFavouriteRepository,
	MediaFolderRepository,
	ShareLinkRepository,
	StorageLedgerRepository,
} from '@saha-textile/core-domain';

import {
	MediaAssetModel,
	MediaFavouriteModel,
	MediaFolderModel,
	MediaShareLinkModel,
	StorageReservationModel,
	type MediaFavouriteDoc,
	type MediaFolderDoc,
	type MediaShareLinkDoc,
} from '../models/index';

const iso = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);
const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

const toFolder = (doc: MediaFolderDoc): MediaFolder =>
	MediaFolder.parse({
		id: doc._id,
		parentId: doc.parentId ?? null,
		name: doc.name,
		ancestors: doc.ancestors ?? [],
		files: doc.files ?? 0,
		bytes: doc.bytes ?? 0,
		trashedAt: iso(doc.trashedAt),
		trashedFrom: doc.trashedFrom ?? null,
		createdBy: doc.createdBy ?? null,
		createdAt: iso(doc.createdAt) ?? undefined,
		updatedAt: iso(doc.updatedAt) ?? undefined,
	});

/** Bytes an asset takes: the original plus every made size. */
export const assetBytesExpression = {
	$add: [
		{ $ifNull: ['$originalByteSize', 0] },
		{ $sum: { $map: { input: { $ifNull: ['$derivatives', []] }, as: 'd', in: { $ifNull: ['$$d.byteSize', 0] } } } },
	],
};

export class MongoMediaFolderRepository implements MediaFolderRepository {
	async findById(id: string): Promise<MediaFolder | null> {
		const doc = await MediaFolderModel.findById(id).lean<MediaFolderDoc>().exec();
		return doc ? toFolder(doc) : null;
	}

	async findManyByIds(ids: readonly string[]): Promise<MediaFolder[]> {
		const docs = await MediaFolderModel.find({ _id: { $in: [...ids] } })
			.lean<MediaFolderDoc[]>()
			.exec();
		return docs.map(toFolder);
	}

	async listChildren(parentId: string | null, options: { trashed: boolean }): Promise<MediaFolder[]> {
		const docs = await MediaFolderModel.find({ parentId, trashedAt: options.trashed ? { $ne: null } : null })
			.collation({ locale: 'en', strength: 2 })
			.sort({ name: 1 })
			.lean<MediaFolderDoc[]>()
			.exec();
		return docs.map(toFolder);
	}

	async listAll(): Promise<MediaFolder[]> {
		const docs = await MediaFolderModel.find({ trashedAt: null })
			.collation({ locale: 'en', strength: 2 })
			.sort({ name: 1 })
			.lean<MediaFolderDoc[]>()
			.exec();
		return docs.map(toFolder);
	}

	async listSubtree(id: string): Promise<MediaFolder[]> {
		const docs = await MediaFolderModel.find({ $or: [{ _id: id }, { ancestors: id }] })
			.lean<MediaFolderDoc[]>()
			.exec();
		return docs.map(toFolder);
	}

	async listTrashed(): Promise<MediaFolder[]> {
		const docs = await MediaFolderModel.find({ trashedAt: { $ne: null } })
			.sort({ trashedAt: -1 })
			.lean<MediaFolderDoc[]>()
			.exec();
		return docs.map(toFolder);
	}

	async save(folder: MediaFolder): Promise<MediaFolder> {
		const parsed = MediaFolder.parse(folder);
		const { id, createdAt: _c, updatedAt: _u, trashedAt, ...rest } = parsed;
		await MediaFolderModel.updateOne(
			{ _id: id },
			{ $set: { ...rest, trashedAt: date(trashedAt) } },
			{ upsert: true },
		).exec();
		return (await this.findById(id)) as MediaFolder;
	}

	async move(id: string, parentId: string | null, ancestors: readonly string[]): Promise<void> {
		const folder = await MediaFolderModel.findById(id).lean<MediaFolderDoc>().exec();
		if (!folder) return;
		const before = [...(folder.ancestors ?? []), id];
		const after = [...ancestors, id];
		await MediaFolderModel.updateOne({ _id: id }, { $set: { parentId, ancestors: [...ancestors] } }).exec();
		// Everything inside keeps its own part of the path below this folder.
		const inside = await MediaFolderModel.find({ ancestors: id }).lean<MediaFolderDoc[]>().exec();
		for (const child of inside) {
			const own = child.ancestors.slice(before.length);
			await MediaFolderModel.updateOne({ _id: child._id }, { $set: { ancestors: [...after, ...own] } }).exec();
		}
	}

	async setTrashed(
		ids: readonly string[],
		at: string | null,
		from: ReadonlyMap<string, string | null>,
	): Promise<void> {
		for (const id of ids) {
			await MediaFolderModel.updateOne(
				{ _id: id },
				{ $set: at ? { trashedAt: new Date(at), trashedFrom: from.get(id) ?? null } : { trashedAt: null } },
			).exec();
		}
	}

	async hardDelete(ids: readonly string[]): Promise<void> {
		await MediaFolderModel.deleteMany({ _id: { $in: [...ids] } }).exec();
	}

	async recount(ids: readonly string[]): Promise<void> {
		const folders = await MediaFolderModel.find({ _id: { $in: [...ids] } })
			.lean<MediaFolderDoc[]>()
			.exec();
		const touched = new Set<string>();
		for (const folder of folders) for (const id of [folder._id, ...(folder.ancestors ?? [])]) touched.add(id);
		for (const id of touched) {
			const subtree = await MediaFolderModel.find({ $or: [{ _id: id }, { ancestors: id }], trashedAt: null })
				.select({ _id: 1 })
				.lean<{ _id: string }[]>()
				.exec();
			const [totals] = await MediaAssetModel.aggregate<{ files: number; bytes: number }>([
				{ $match: { folderId: { $in: subtree.map((row) => row._id) }, trashedAt: null, deletedAt: null } },
				{ $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: assetBytesExpression } } },
			]).exec();
			await MediaFolderModel.updateOne(
				{ _id: id },
				{ $set: { files: totals?.files ?? 0, bytes: totals?.bytes ?? 0 } },
			).exec();
		}
	}
}

const favouriteId = (userId: string, type: string, id: string) => `${userId}:${type}:${id}`;

export class MongoMediaFavouriteRepository implements MediaFavouriteRepository {
	async set(userId: string, target: { type: 'folder' | 'file'; id: string }, starred: boolean): Promise<void> {
		const _id = favouriteId(userId, target.type, target.id);
		if (!starred) {
			await MediaFavouriteModel.deleteOne({ _id }).exec();
			return;
		}
		await MediaFavouriteModel.updateOne(
			{ _id },
			{ $setOnInsert: { userId, targetType: target.type, targetId: target.id } },
			{ upsert: true },
		).exec();
	}

	async listForUser(userId: string): Promise<{ type: 'folder' | 'file'; id: string }[]> {
		const docs = await MediaFavouriteModel.find({ userId })
			.sort({ createdAt: -1 })
			.lean<MediaFavouriteDoc[]>()
			.exec();
		return docs.map((doc) => ({ type: doc.targetType as 'folder' | 'file', id: doc.targetId }));
	}

	async listAll(): Promise<{ userId: string; type: 'folder' | 'file'; id: string }[]> {
		const docs = await MediaFavouriteModel.find().sort({ createdAt: -1 }).lean<MediaFavouriteDoc[]>().exec();
		return docs.map((doc) => ({ userId: doc.userId, type: doc.targetType as 'folder' | 'file', id: doc.targetId }));
	}

	async removeTargets(type: 'folder' | 'file', ids: readonly string[]): Promise<void> {
		await MediaFavouriteModel.deleteMany({ targetType: type, targetId: { $in: [...ids] } }).exec();
	}
}

const toLink = (doc: MediaShareLinkDoc): ShareLink =>
	ShareLink.parse({
		id: doc._id,
		assetId: doc.assetId,
		codeHash: doc.codeHash,
		codeEnd: doc.codeEnd,
		who: doc.who,
		expiresAt: iso(doc.expiresAt),
		passwordHash: doc.passwordHash ?? null,
		stoppedAt: iso(doc.stoppedAt),
		stoppedBecause: doc.stoppedBecause ?? null,
		opens: doc.opens ?? 0,
		lastOpenedAt: iso(doc.lastOpenedAt),
		createdBy: doc.createdBy,
		createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
	});

export class MongoShareLinkRepository implements ShareLinkRepository {
	async create(link: ShareLink): Promise<ShareLink> {
		const parsed = ShareLink.parse(link);
		await MediaShareLinkModel.create({
			_id: parsed.id,
			assetId: parsed.assetId,
			codeHash: parsed.codeHash,
			codeEnd: parsed.codeEnd,
			who: parsed.who,
			expiresAt: date(parsed.expiresAt),
			passwordHash: parsed.passwordHash,
			stoppedAt: date(parsed.stoppedAt),
			stoppedBecause: parsed.stoppedBecause,
			opens: parsed.opens,
			lastOpenedAt: date(parsed.lastOpenedAt),
			createdBy: parsed.createdBy,
		});
		return (await this.findById(parsed.id)) as ShareLink;
	}

	async findById(id: string): Promise<ShareLink | null> {
		const doc = await MediaShareLinkModel.findById(id).select('+passwordHash').lean<MediaShareLinkDoc>().exec();
		return doc ? toLink(doc) : null;
	}

	async findByCodeHash(codeHash: string): Promise<ShareLink | null> {
		const doc = await MediaShareLinkModel.findOne({ codeHash })
			.select('+passwordHash')
			.lean<MediaShareLinkDoc>()
			.exec();
		return doc ? toLink(doc) : null;
	}

	async listForAsset(assetId: string): Promise<ShareLink[]> {
		const docs = await MediaShareLinkModel.find({ assetId })
			.select('+passwordHash')
			.sort({ createdAt: -1 })
			.lean<MediaShareLinkDoc[]>()
			.exec();
		return docs.map(toLink);
	}

	async save(link: ShareLink): Promise<ShareLink> {
		const parsed = ShareLink.parse(link);
		await MediaShareLinkModel.updateOne(
			{ _id: parsed.id },
			{
				$set: {
					expiresAt: date(parsed.expiresAt),
					stoppedAt: date(parsed.stoppedAt),
					stoppedBecause: parsed.stoppedBecause,
					who: parsed.who,
				},
			},
		).exec();
		return (await this.findById(parsed.id)) as ShareLink;
	}

	async countOpen(id: string, at: string): Promise<void> {
		await MediaShareLinkModel.updateOne(
			{ _id: id },
			{ $inc: { opens: 1 }, $set: { lastOpenedAt: new Date(at) } },
		).exec();
	}

	async stopForAssets(assetIds: readonly string[], at: string): Promise<number> {
		const result = await MediaShareLinkModel.updateMany(
			{ assetId: { $in: [...assetIds] }, stoppedAt: null },
			{ $set: { stoppedAt: new Date(at), stoppedBecause: 'trash' } },
		).exec();
		return result.modifiedCount;
	}
}

export class MongoStorageLedgerRepository implements StorageLedgerRepository {
	async reserve(input: { id: string; userId: string; bytes: number; expiresAt: string }): Promise<void> {
		await StorageReservationModel.updateOne(
			{ _id: input.id },
			{ $set: { userId: input.userId, bytes: input.bytes, expiresAt: new Date(input.expiresAt) } },
			{ upsert: true },
		).exec();
	}

	async release(id: string): Promise<void> {
		await StorageReservationModel.deleteOne({ _id: id }).exec();
	}

	async reservedBytes(now: string, exceptId?: string): Promise<number> {
		const [row] = await StorageReservationModel.aggregate<{ bytes: number }>([
			{ $match: { expiresAt: { $gt: new Date(now) }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) } },
			{ $group: { _id: null, bytes: { $sum: '$bytes' } } },
		]).exec();
		return row?.bytes ?? 0;
	}

	async findReservation(id: string) {
		const doc = await StorageReservationModel.findById(id)
			.lean<{ _id: string; userId: string; bytes: number; expiresAt: Date }>()
			.exec();
		return doc
			? { id: doc._id, userId: doc.userId, bytes: doc.bytes, expiresAt: doc.expiresAt.toISOString() }
			: null;
	}
}
