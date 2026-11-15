import type { ImageDerivative, MediaAsset, MediaVersion } from '@saha-textile/contracts';
import { SEEDED_MEDIA_PROFILES, assignExistingVersions } from '@saha-textile/core-domain';

import { MediaAssetModel, type MediaAssetDoc } from '../models/index';
import { MongoMediaProfileRepository } from '../repositories/media-profile.repository';

const BATCH = 200;

/**
 * Media build step 2a, release migration `0001-media-profiles-and-versions` (expand half):
 *
 * 1. the image profiles a database starts with (built-in and the rest), where missing;
 * 2. every photo's files named under the version they already are (R4-1: “today's photos become the version
 *    they already are; nothing is remade”). No file moves or changes; each derivative only gains `versionId`, and
 *    the asset gains its `versions`.
 *
 * Safe to run again: it only touches photos with a file that has no version yet, writes each one only if its
 * files have not changed since it was read (a photo the worker remade meanwhile is already named), and leaves
 * the date modified alone.
 */
export async function seedProfilesAndNameVersions(now: () => Date = () => new Date()): Promise<string> {
	const profiles = new MongoMediaProfileRepository();
	const added = await profiles.insertMissing(SEEDED_MEDIA_PROFILES);
	const profileVersions = new Map((await profiles.list()).map((profile) => [profile.key, profile.version]));
	const at = now().toISOString();

	const cursor = MediaAssetModel.find({
		kind: 'image',
		derivatives: { $elemMatch: { versionId: { $exists: false } } },
	})
		.lean<MediaAssetDoc[]>()
		.cursor({ batchSize: BATCH });

	let named = 0;
	let batch: Parameters<typeof MediaAssetModel.bulkWrite>[0] = [];
	const flush = async () => {
		if (batch.length === 0) return;
		const result = await MediaAssetModel.bulkWrite(batch, { ordered: false });
		named += result.modifiedCount;
		batch = [];
	};

	for await (const doc of cursor as AsyncIterable<MediaAssetDoc>) {
		const derivatives = (doc.derivatives ?? []) as ImageDerivative[];
		const asset = {
			kind: 'image',
			purpose: (doc.purpose ?? 'product') as MediaAsset['purpose'],
			warnings: (doc.warnings ?? []) as MediaAsset['warnings'],
			width: doc.width ?? null,
			height: doc.height ?? null,
			derivatives,
			versions: (doc.versions ?? []) as MediaVersion[],
			createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
			processing: {
				state: 'ready',
				attempts: 0,
				error: null,
				processedAt: doc.processing?.processedAt ? new Date(doc.processing.processedAt).toISOString() : null,
			},
		} satisfies Parameters<typeof assignExistingVersions>[0];
		const result = assignExistingVersions(asset, at, profileVersions);
		batch.push({
			updateOne: {
				filter: { _id: doc._id, derivatives: doc.derivatives },
				update: { $set: { versions: result.versions, derivatives: result.derivatives } },
				timestamps: false,
			},
		});
		if (batch.length >= BATCH) await flush();
	}
	await flush();

	return `added ${added} image profile${added === 1 ? '' : 's'}; named the versions of ${named} photo${named === 1 ? '' : 's'}`;
}
