import type { ImageDerivative, MediaAsset, MediaVersion } from '@saha-textile/contracts';
import {
	PROCESSED_PHOTO_TYPES,
	SEEDED_MEDIA_PROFILES,
	assignExistingVersions,
	seededWidths,
} from '@saha-textile/core-domain';

import { MediaAssetModel, MediaProfileModel, type MediaAssetDoc } from '../models/index';
import { MongoMediaProfileRepository } from '../repositories/media-profile.repository';

const BATCH = 200;

/**
 * Release migration `0002-media-profile-sizes` (media step 2c, expand): profiles stored before their sizes and
 * quality were editable get the widths their size families have, and “each size's own” quality. Safe to run again.
 */
export async function addProfileSizes(): Promise<string> {
	const docs = await MediaProfileModel.find({ $or: [{ widths: { $exists: false } }, { widths: {} }] })
		.lean()
		.exec();
	let changed = 0;
	for (const doc of docs) {
		const result = await MediaProfileModel.updateOne(
			{ _id: doc._id },
			{ $set: { widths: seededWidths(doc.roles), quality: doc.quality ?? null } },
			{ timestamps: false },
		).exec();
		changed += result.modifiedCount;
	}
	return `gave ${changed} image profile${changed === 1 ? '' : 's'} their sizes`;
}

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

/** What every built-in profile accepted when it was seeded, before media step 5. */
const FIRST_ACCEPTS = ['image/jpeg', 'image/png'];

/**
 * Release migration `0004-media-photo-types` (media step 5, expand): built-in profiles still accepting only JPEG and
 * PNG, as they were seeded, accept every photo type the worker reads. A list an admin changed is left as it is, and
 * so are profiles an admin made. The version stays: accepting more types changes no file already made. Safe to run
 * again.
 */
export async function widenProfileTypes(): Promise<string> {
	const result = await MediaProfileModel.updateMany(
		{ builtIn: true, accepts: { $size: FIRST_ACCEPTS.length, $all: FIRST_ACCEPTS } },
		{ $set: { accepts: [...PROCESSED_PHOTO_TYPES] } },
		{ timestamps: false },
	).exec();
	const changed = result.modifiedCount;
	return `let ${changed} built-in image profile${changed === 1 ? '' : 's'} take every photo type the worker reads`;
}

/** The product-card sizes every built-in profile was seeded with before the 600 px size (17 Nov 2026). */
const CARD_BEFORE_600 = [200, 400, 700, 960];
const CARD_WITH_600 = [200, 400, 600, 700, 960];

/**
 * Release migration `0006-media-card-600` (shop speed round 4, expand): built-in profiles whose product-card sizes
 * are still the seeded 200, 400, 700 and 960 px gain a 600 px size, and their version goes up, so "Bring older
 * versions up to date" adds the 600 px files to photos made before (pages keep their files until then; nothing is
 * removed). Sizes an admin changed are left as they are, and so are profiles an admin made. Safe to run again.
 */
export async function addCardWidth600(): Promise<string> {
	const result = await MediaProfileModel.updateMany(
		// `$eq`, not a bare array: on a Mixed path Mongoose turns a bare array into `$in`, which also matched an admin's
		// own sizes that merely contain 200 (caught by the test).
		{ builtIn: true, 'widths.card': { $eq: CARD_BEFORE_600 } },
		{ $set: { 'widths.card': CARD_WITH_600 }, $inc: { version: 1 } },
		{ timestamps: false },
	).exec();
	const changed = result.modifiedCount;
	return `gave ${changed} built-in image profile${changed === 1 ? '' : 's'} a 600 px product-card size`;
}

/** The Image V2 swatch sizes every built-in profile was seeded with before the 360 px size (21 Nov 2026). */
const SWATCH_V2_BEFORE_360 = [120, 240];
const SWATCH_V2_WITH_360 = [120, 240, 360];

/**
 * Release migration `0012-media-swatch-v2-360` (product page brief section 8, owner 21 Nov 2026, expand): built-in
 * profiles whose Image V2 swatch sizes are still the seeded 120 and 240 px gain a 360 px size, so the tile stays sharp
 * on 3x phones, and their version goes up, so "Bring older versions up to date" adds the 360 px files to photos made
 * before (pages keep their files until then; nothing is removed). Sizes an admin changed stay, and so do profiles an
 * admin made. Safe to run again.
 */
export async function addSwatchV2Width360(): Promise<string> {
	const result = await MediaProfileModel.updateMany(
		// `$eq`, not a bare array: on a Mixed path Mongoose turns a bare array into `$in` (see 0006).
		{ builtIn: true, 'widths.swatch_image_v2': { $eq: SWATCH_V2_BEFORE_360 } },
		{ $set: { 'widths.swatch_image_v2': SWATCH_V2_WITH_360 }, $inc: { version: 1 } },
		{ timestamps: false },
	).exec();
	const changed = result.modifiedCount;
	return `gave ${changed} built-in image profile${changed === 1 ? '' : 's'} a 360 px Image V2 swatch size`;
}
