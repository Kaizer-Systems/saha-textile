import type { MediaZipPatch, MediaZipRecord, MediaZipRepository } from '@saha-textile/core-domain';

import { MediaZipModel, type MediaZipDoc } from '../models/index';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toRecord(doc: MediaZipDoc): MediaZipRecord {
	return {
		id: doc._id,
		name: doc.name,
		state: doc.state,
		files: { done: doc.files.done, total: doc.files.total },
		bytes: { done: doc.bytes.done, total: doc.bytes.total },
		createdAt: doc.createdAt.toISOString(),
		readyAt: iso(doc.readyAt),
		expiresAt: iso(doc.expiresAt),
		error: doc.error,
		userId: doc.userId,
		fileIds: [...doc.fileIds],
		folderIds: [...doc.folderIds],
		storageKey: doc.storageKey,
	};
}

/** `MediaZipRepository` on the `mediaZips` collection (media step 5). */
export class MongoMediaZipRepository implements MediaZipRepository {
	async create(zip: MediaZipRecord): Promise<void> {
		await MediaZipModel.create({
			_id: zip.id,
			userId: zip.userId,
			name: zip.name,
			state: zip.state,
			fileIds: zip.fileIds,
			folderIds: zip.folderIds,
			storageKey: zip.storageKey,
			files: zip.files,
			bytes: zip.bytes,
			createdAt: new Date(zip.createdAt),
			readyAt: zip.readyAt ? new Date(zip.readyAt) : null,
			expiresAt: zip.expiresAt ? new Date(zip.expiresAt) : null,
			error: zip.error,
			swept: false,
		});
	}

	async find(id: string): Promise<MediaZipRecord | null> {
		const doc = await MediaZipModel.findById(id).lean<MediaZipDoc>().exec();
		return doc ? toRecord(doc) : null;
	}

	async update(id: string, patch: MediaZipPatch): Promise<MediaZipRecord | null> {
		const set: Record<string, unknown> = {};
		if (patch.state !== undefined) set['state'] = patch.state;
		if (patch.files !== undefined) set['files'] = patch.files;
		if (patch.bytes !== undefined) set['bytes'] = patch.bytes;
		if (patch.readyAt !== undefined) set['readyAt'] = patch.readyAt ? new Date(patch.readyAt) : null;
		if (patch.expiresAt !== undefined) set['expiresAt'] = patch.expiresAt ? new Date(patch.expiresAt) : null;
		if (patch.error !== undefined) set['error'] = patch.error;
		// Only a .zip still being made moves on: a cancel in between wins.
		const doc = await MediaZipModel.findOneAndUpdate({ _id: id, state: 'adding' }, { $set: set }, { new: true })
			.lean<MediaZipDoc>()
			.exec();
		return doc ? toRecord(doc) : null;
	}

	async setState(id: string, state: MediaZipRecord['state']): Promise<void> {
		await MediaZipModel.updateOne({ _id: id }, { $set: { state } }).exec();
	}

	async listForUser(userId: string, since: string): Promise<MediaZipRecord[]> {
		const docs = await MediaZipModel.find({ userId, createdAt: { $gte: new Date(since) } })
			.sort({ createdAt: -1 })
			.limit(50)
			.lean<MediaZipDoc[]>()
			.exec();
		return docs.map(toRecord);
	}

	async listToSweep(now: string, limit: number): Promise<MediaZipRecord[]> {
		const docs = await MediaZipModel.find({
			swept: false,
			$or: [{ state: 'ready', expiresAt: { $lte: new Date(now) } }, { state: { $in: ['cancelled', 'failed'] } }],
		})
			.sort({ createdAt: 1 })
			.limit(limit)
			.lean<MediaZipDoc[]>()
			.exec();
		return docs.map(toRecord);
	}

	async finishSweep(id: string, state: MediaZipRecord['state']): Promise<void> {
		await MediaZipModel.updateOne({ _id: id }, { $set: { state, swept: true } }).exec();
	}

	async storedBytes(): Promise<number> {
		const [row] = await MediaZipModel.aggregate<{ bytes: number }>([
			{ $match: { state: 'ready', swept: false } },
			{ $group: { _id: null, bytes: { $sum: '$bytes.total' } } },
		]).exec();
		return row?.bytes ?? 0;
	}
}
