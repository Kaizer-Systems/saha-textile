import type { MediaProfile } from '@saha-textile/contracts';
import { type MediaProfileRepository, seededWidths } from '@saha-textile/core-domain';

import { MediaAssetModel, MediaProfileModel, type MediaProfileDoc } from '../models/index';

const toProfile = (doc: MediaProfileDoc): MediaProfile =>
	({
		key: doc._id,
		name: doc.name,
		builtIn: doc.builtIn === true,
		shape: doc.shape ?? null,
		roles: doc.roles,
		// A profile stored before its sizes were editable shows the ladder's own widths.
		widths: doc.widths && Object.keys(doc.widths).length ? doc.widths : seededWidths(doc.roles),
		quality: doc.quality ?? null,
		fills: doc.fills ?? [],
		minSize: doc.minSize ?? null,
		maxBytes: doc.maxBytes,
		accepts: doc.accepts,
		mainPhotoOnly: doc.mainPhotoOnly === true,
		enabled: doc.enabled !== false,
		version: doc.version ?? 1,
		updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
	}) as MediaProfile;

const toDoc = (profile: MediaProfile) => {
	const { key: _key, updatedAt: _updatedAt, ...rest } = profile;
	return rest;
};

export class MongoMediaProfileRepository implements MediaProfileRepository {
	async list(): Promise<MediaProfile[]> {
		// Built-in first, then by name, the order Settings › Image profiles shows them in.
		const docs = await MediaProfileModel.find().sort({ builtIn: -1, name: 1 }).lean<MediaProfileDoc[]>().exec();
		return docs.map(toProfile);
	}

	async findByKey(key: string): Promise<MediaProfile | null> {
		const doc = await MediaProfileModel.findById(key).lean<MediaProfileDoc>().exec();
		return doc ? toProfile(doc) : null;
	}

	async save(profile: MediaProfile): Promise<MediaProfile> {
		await MediaProfileModel.updateOne({ _id: profile.key }, { $set: toDoc(profile) }, { upsert: true }).exec();
		return profile;
	}

	async delete(key: string): Promise<void> {
		await MediaProfileModel.deleteOne({ _id: key, builtIn: { $ne: true } }).exec();
	}

	/** `$setOnInsert` only: an admin's edits survive every boot and every release. */
	async insertMissing(profiles: readonly MediaProfile[]): Promise<number> {
		if (profiles.length === 0) return 0;
		const result = await MediaProfileModel.bulkWrite(
			profiles.map((profile) => ({
				updateOne: { filter: { _id: profile.key }, update: { $setOnInsert: toDoc(profile) }, upsert: true },
			})),
		);
		return result.upsertedCount;
	}

	async countPhotosByProfile(): Promise<Record<string, number>> {
		const rows = await MediaAssetModel.aggregate<{ _id: string; photos: number }>([
			{ $match: { deletedAt: null, 'versions.0': { $exists: true } } },
			{ $project: { profiles: { $setUnion: ['$versions.profileKey', []] } } },
			{ $unwind: '$profiles' },
			{ $group: { _id: '$profiles', photos: { $sum: 1 } } },
		]).exec();
		return Object.fromEntries(rows.map((row) => [row._id, row.photos]));
	}
}
