import type { MediaAsset, MediaCutRegion, MediaVersion } from '@saha-textile/contracts';

import type { ImageCutPort } from '../ports/image-codec.port';
import type { MediaAssetRepository } from '../ports/media.repository';
import type { StoragePort } from '../ports/storage.port';

import type { ProcessOutcome } from './process-asset';
import { versionIdOf } from './profiles';
import { KEEP_REPLACED_DAYS } from './replace-photo';
import { originalStorageKey } from './storage-keys';

/**
 * Swatch cuts (owner, 21 Nov 2026, product page brief P11/P12). A swatch shows the fabric, not the whole product
 * photo: the admin drags a square onto the fabric and saves it, and the image worker cuts that square from the
 * photo's full-size original into a picture of its own. The photo is never changed and stays whole in the gallery.
 *
 * A cut is an ordinary picture with one "Swatch 1:1" version (the square swatch sizes) and a record of the photo and
 * square it came from, so a Replace of the photo cuts it again and the pop-up reopens on the same square. Product
 * photos are already 3:4 and only ever get "As is", so a focus point never moves a swatch; a cut is how a swatch
 * zooms in.
 */

/** The image profile a cut is made under: the two square swatch families. */
export const SWATCH_CUT_PROFILE = 'swatch_1x1';

/** Twice the largest swatch file (240 px): a smaller square still saves, with "This will look soft". */
export const MIN_CUT_PX = 480;

/** A square smaller than this is no swatch at all. */
const SMALLEST_CUT_PX = 16;

/** How far a square may be off in pixels (rounding in the browser) and still count as square. */
const SQUARE_SLACK_PX = 2;

export type CutRefusal = 'not_a_photo' | 'no_original' | 'is_a_cut' | 'outside_photo' | 'not_square' | 'too_small';

export type CutCheck = { ok: true; px: number; soft: boolean } | { ok: false; reason: CutRefusal };

type CutSource = Pick<MediaAsset, 'kind' | 'width' | 'height' | 'originalStorageKey'> & {
	cutFrom?: MediaAsset['cutFrom'];
};

/** Whether this square of this photo can be cut, how many pixels wide it is, and whether it will look soft. */
export function checkCut(photo: CutSource, region: MediaCutRegion): CutCheck {
	if (photo.kind !== 'image') return { ok: false, reason: 'not_a_photo' };
	if (!photo.originalStorageKey || !photo.width || !photo.height) return { ok: false, reason: 'no_original' };
	// A cut is cut from the photo, never from another cut, so a Replace of the photo can cut every one again.
	if (photo.cutFrom) return { ok: false, reason: 'is_a_cut' };
	const edge = 1e-6;
	if (region.x + region.width > 1 + edge || region.y + region.height > 1 + edge) {
		return { ok: false, reason: 'outside_photo' };
	}
	const width = region.width * photo.width;
	const height = region.height * photo.height;
	if (Math.abs(width - height) > SQUARE_SLACK_PX) return { ok: false, reason: 'not_square' };
	const px = Math.round(Math.min(width, height));
	if (px < SMALLEST_CUT_PX) return { ok: false, reason: 'too_small' };
	return { ok: true, px, soft: px < MIN_CUT_PX };
}

/** The square in pixels of the upright original: kept inside the photo, the same side both ways. */
export function cutPixels(
	photo: { width: number; height: number },
	region: MediaCutRegion,
): { left: number; top: number; size: number } {
	const size = Math.max(
		1,
		Math.min(
			photo.width,
			photo.height,
			Math.round(Math.min(region.width * photo.width, region.height * photo.height)),
		),
	);
	const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
	return {
		left: clamp(Math.round(region.x * photo.width), photo.width - size),
		top: clamp(Math.round(region.y * photo.height), photo.height - size),
		size,
	};
}

/** The same square, give or take a rounding: a second Save of it reuses the cut already made. */
export const sameCutRegion = (a: MediaCutRegion, b: MediaCutRegion): boolean =>
	(['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) < 0.0005);

/** The cut's file name stem: the photo's own, marked as a cut, within the 80 characters a stem may have. */
export const cutSlug = (photoSlug: string): string => `${photoSlug.slice(0, 76).replace(/-+$/, '')}-cut`;

/**
 * A new cut picture, as written before the worker cuts it: its square and photo recorded, one Swatch 1:1 version on
 * its way, the original's key reserved (the worker writes a JPEG there; a cut never shares the photo's original,
 * which garbage collection may delete with the photo).
 */
export function planCut(input: {
	id: string;
	photo: Pick<MediaAsset, 'id' | 'slug' | 'visibility'> & { folderId?: string | null };
	region: MediaCutRegion;
	profileVersion: number;
	by: string | null;
	at: string;
}): MediaAsset {
	const version: MediaVersion = {
		id: versionIdOf(SWATCH_CUT_PROFILE, 'as_is'),
		profileKey: SWATCH_CUT_PROFILE,
		profileVersion: input.profileVersion,
		fill: 'as_is',
		state: 'making',
		createdAt: input.at,
	};
	return {
		id: input.id,
		kind: 'image',
		purpose: 'product',
		originalStorageKey: originalStorageKey(input.id, 'image/jpeg'),
		originalFormat: 'image/jpeg',
		originalByteSize: 0,
		width: null,
		height: null,
		slug: cutSlug(input.photo.slug),
		derivatives: [],
		versions: [version],
		cutFrom: { assetId: input.photo.id, region: input.region },
		dominantColor: null,
		thumbHash: null,
		visibility: input.photo.visibility,
		processing: { state: 'queued', attempts: 0, error: null, processedAt: null },
		warnings: [],
		servesAsPrimary: false,
		maxDisplayWidth: null,
		renditions: [],
		hlsPlaylistKey: null,
		durationSeconds: null,
		text: { alt: {}, title: {}, caption: {} },
		status: 'live',
		uploadedBy: input.by ? { type: 'admin', id: input.by } : null,
		deletedAt: null,
		folderId: input.photo.folderId ?? null,
		displayName: null,
		createdAt: input.at,
		updatedAt: input.at,
	};
}

export interface CutSwatchDeps {
	assets: Pick<MediaAssetRepository, 'findById' | 'update'>;
	storage: Pick<StoragePort, 'download' | 'upload'>;
	cutter: ImageCutPort;
	now: () => Date;
	/** Makes the cut's swatch sizes from its new original (the worker's own processing). */
	process: (assetId: string) => Promise<ProcessOutcome>;
}

export type CutOutcome = { status: 'made'; px: number } | { status: 'gone' } | { status: 'no_photo' } | ProcessOutcome;

/**
 * The image worker's "cut" job: cut the square from the photo's original into the cut's own original, then make its
 * swatch sizes. Run again after a Replace of the photo, it cuts the same square from the new original; the files it
 * made before are kept 7 days, as a Replace keeps them, so pages already open keep their pictures.
 */
export async function cutSwatch(deps: CutSwatchDeps, input: { assetId: string }): Promise<CutOutcome> {
	const cut = await deps.assets.findById(input.assetId);
	if (!cut?.cutFrom || !cut.originalStorageKey || cut.deletedAt) return { status: 'gone' };
	const photo = await deps.assets.findById(cut.cutFrom.assetId);
	if (!photo?.originalStorageKey) return { status: 'no_photo' };
	const square = await deps.cutter.cut(await deps.storage.download(photo.originalStorageKey), cut.cutFrom.region);
	await deps.storage.upload({
		key: cut.originalStorageKey,
		body: square.bytes,
		contentType: 'image/jpeg',
		visibility: 'private',
	});
	const now = deps.now();
	const old = cut.derivatives.map((file) => file.storageKey);
	const kept = old.length
		? [
				...(cut.keptFiles ?? []),
				{
					keys: old,
					bytes: cut.derivatives.reduce((sum, file) => sum + file.byteSize, 0),
					deleteAfter: new Date(now.getTime() + KEEP_REPLACED_DAYS * 86_400_000).toISOString(),
					reason: 'replace' as const,
				},
			]
		: cut.keptFiles;
	await deps.assets.update({
		...cut,
		width: square.width,
		height: square.height,
		originalByteSize: square.bytes.byteLength,
		derivatives: [],
		...(kept ? { keptFiles: kept } : {}),
		versions: (cut.versions ?? []).map((version) => ({ ...version, state: 'making' as const, error: null })),
		processing: { ...cut.processing, state: 'queued', error: null },
		updatedAt: now.toISOString(),
	});
	const outcome = await deps.process(cut.id);
	return outcome.status === 'ready' ? { status: 'made', px: square.width } : outcome;
}
