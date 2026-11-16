import type { ImageDerivative, MediaAsset, MediaKeptFiles, MediaProfile } from '@saha-textile/contracts';

import { isProcessedPhoto } from '../catalog/media-files';
import { ImageDecodeError } from '../ports/image-codec.port';
import type { MediaAssetRepository } from '../ports/media.repository';
import { checkCaps } from './policy';
import { type ProcessMediaAssetDeps, type ProcessOutcome, renderPhoto } from './process-asset';
import { checkVersionRequest } from './version-plan';

/** Old files stay this long after a Replace, so pages already open keep their pictures (decision 11). */
export const KEEP_REPLACED_DAYS = 7;

const FORMAT_FOR_TYPE: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

/** The new photo as the browser read it, before a byte moves (C05). */
export interface ReplacementPhoto {
	contentType: string;
	byteSize: number;
	width: number;
	height: number;
}

export interface ReplaceCheck {
	/** Why the photo can't be replaced at all; null when it can, as far as its versions allow. */
	refusal: string | null;
	/** Versions that couldn't be remade the same way from the new photo, each with why. */
	versions: { versionId: string; refusal: string }[];
}

/**
 * Whether a photo can be replaced by this one (S7, C05). Every version is remade with the same profile and fill,
 * so a page never changes version: a version the new photo can't have the same way (another shape for “As is”,
 * too small, over a limit) stops the Replace and is named. One Replace at a time, and not while versions are made.
 */
export function checkReplace(input: {
	asset: Pick<MediaAsset, 'kind' | 'originalStorageKey' | 'replacing' | 'versions'>;
	profiles: ReadonlyMap<string, MediaProfile>;
	photo: ReplacementPhoto;
}): ReplaceCheck {
	const { asset, photo } = input;
	const versions = asset.versions ?? [];
	const fail = (refusal: string): ReplaceCheck => ({ refusal, versions: [] });
	if (asset.kind !== 'image' || !asset.originalStorageKey) return fail('not_a_photo');
	if (!versions.length) return fail('no_versions');
	if (asset.replacing && asset.replacing.phase !== 'failed') return fail('replacing');
	if (versions.some((version) => version.state === 'making')) return fail('versions_making');
	if (!isProcessedPhoto(photo.contentType)) return fail('photo_type_waits');
	const caps = checkCaps(photo);
	if (caps) return fail(caps.code);
	const refused = versions.flatMap((version) => {
		const refusal = checkVersionRequest({
			profile: input.profiles.get(version.profileKey) ?? null,
			fill: version.fill,
			source: { width: photo.width, height: photo.height },
			byteSize: photo.byteSize,
			contentType: photo.contentType,
		});
		return refusal ? [{ versionId: version.id, refusal }] : [];
	});
	return { refusal: refused.length ? 'versions_refused' : null, versions: refused };
}

/**
 * What a Replace leaves behind to keep for 7 days: the old picture files and the old original, never a file the new
 * set still uses (byte-identical sizes keep their address). Null when nothing is left.
 */
export function keptAfterReplace(
	old: Pick<MediaAsset, 'derivatives' | 'originalStorageKey'>,
	fresh: { derivatives: readonly ImageDerivative[]; originalStorageKey: string },
	now: Date,
	reason: MediaKeptFiles['reason'] = 'replace',
): MediaKeptFiles | null {
	const still = new Set([...fresh.derivatives.map((row) => row.storageKey), fresh.originalStorageKey]);
	const files = old.derivatives.filter((row) => !still.has(row.storageKey));
	const keys = files.map((row) => row.storageKey);
	if (old.originalStorageKey && !still.has(old.originalStorageKey)) keys.push(old.originalStorageKey);
	if (!keys.length) return null;
	return {
		keys,
		bytes: files.reduce((sum, row) => sum + (row.byteSize ?? 0), 0),
		deleteAfter: new Date(now.getTime() + KEEP_REPLACED_DAYS * 86_400_000).toISOString(),
		reason,
	};
}

/**
 * The kept-files list after a swap: earlier entries lose any file the new set uses again (a focal point moved and
 * then reset to centre makes byte-identical crops, so their old addresses are live once more), entries left empty
 * go, and the new entry is added. A kept file must never be a file the photo shows.
 */
export function keptAfterSwap(
	earlier: readonly MediaKeptFiles[],
	fresh: { derivatives: readonly ImageDerivative[]; originalStorageKey: string },
	added: MediaKeptFiles | null,
): MediaKeptFiles[] {
	const live = new Map<string, number>(fresh.derivatives.map((row) => [row.storageKey, row.byteSize ?? 0]));
	live.set(fresh.originalStorageKey, 0);
	const pruned = earlier.flatMap((row) => {
		const keys = row.keys.filter((key) => !live.has(key));
		if (keys.length === row.keys.length) return [row];
		if (!keys.length) return [];
		const back = row.keys.reduce((sum, key) => sum + (live.get(key) ?? 0), 0);
		return [{ ...row, keys, bytes: Math.max(0, row.bytes - back) }];
	});
	return added ? [...pruned, added] : pruned;
}

/** Every stored file a photo shows or is about to show: these are never deleted by the kept-files sweep. */
function liveKeys(asset: Pick<MediaAsset, 'originalStorageKey' | 'derivatives' | 'replacing'>): Set<string> {
	const keys = new Set(asset.derivatives.map((row) => row.storageKey));
	if (asset.originalStorageKey) keys.add(asset.originalStorageKey);
	if (asset.replacing?.key) keys.add(asset.replacing.key);
	return keys;
}

/**
 * The worker's Replace (S7, C08): takes the queued replacement, checks the new original's real bytes, remakes every
 * version and the pictures made once per photo from it (counting sizes for the popup), and puts it all in place in
 * one write. Any version that can't be remade stops the whole Replace: the website keeps the old photo, the new
 * files go, and the reason is shown.
 */
export const replaceMediaAsset = async (
	deps: ProcessMediaAssetDeps,
	input: { assetId: string },
): Promise<ProcessOutcome> => {
	const asset = await deps.assets.moveReplace(input.assetId, ['queued'], { phase: 'making', made: 0 });
	const next = asset?.replacing;
	if (!asset || !next) return { status: 'not_claimed' };
	// A new focal point (S10) keeps the original: only Crop versions are remade, and the original is never deleted.
	const focal = next.reason === 'focal';
	const fail = async (reason: string, made: readonly ImageDerivative[] = []): Promise<ProcessOutcome> => {
		const keys = [...(focal ? [] : [next.key]), ...made.map((row) => row.storageKey)];
		await deps.queue.enqueue({
			type: 'delete-objects',
			keys,
			urls: asset.visibility === 'public' ? made.map((row) => deps.storage.getUrl(row.storageKey)) : [],
		});
		await deps.assets.moveReplace(asset.id, ['making'], { phase: 'failed', error: reason });
		return { status: 'rejected', reason };
	};

	let bytes: Uint8Array;
	try {
		bytes = await deps.storage.download(next.key);
	} catch {
		return fail('upload_missing');
	}
	let probe;
	try {
		probe = await deps.codec.probe(bytes);
	} catch (error) {
		if (error instanceof ImageDecodeError) return fail('not_an_image');
		throw error;
	}
	if (probe.format !== FORMAT_FOR_TYPE[next.contentType]) return fail('content_does_not_match_declared_type');
	const caps = checkCaps({
		contentType: next.contentType,
		byteSize: bytes.byteLength,
		width: probe.width,
		height: probe.height,
	});
	if (caps) return fail(caps.code);

	let total = 0;
	let made = 0;
	const versions = (asset.versions ?? [])
		.filter((version) => !focal || version.fill === 'crop')
		.map((version) => ({ ...version, state: 'making' as const, error: null }));
	const remade = new Set(versions.map((version) => version.id));
	const fresh = { ...asset, originalFormat: next.contentType as MediaAsset['originalFormat'] };
	// A focal change keeps every picture made once per photo; a Replace makes them all again.
	const have = new Set(
		focal ? asset.derivatives.filter((row) => !row.versionId).map((row) => `${row.role}@${row.width}`) : [],
	);
	const rendered = await renderPhoto(deps, fresh, bytes, probe, versions, have, {
		freshPlaceholder: !focal,
		onPlanned: async (count) => {
			total = count;
			await deps.assets.moveReplace(asset.id, ['making'], { total, made: 0 });
		},
		onFile: async () => {
			made += 1;
			await deps.assets.moveReplace(asset.id, ['making'], { made });
		},
	});
	const broken = rendered.made.find((version) => version.state !== 'ready');
	if (broken) return fail(`${broken.id}: ${broken.error ?? 'render_failed'}`, rendered.added);

	const derivatives = focal
		? [...asset.derivatives.filter((row) => !row.versionId || !remade.has(row.versionId)), ...rendered.added]
		: rendered.added;
	const madeById = new Map(rendered.made.map((version) => [version.id, version]));
	const allVersions = focal
		? (asset.versions ?? []).map((version) => madeById.get(version.id) ?? version)
		: rendered.made;
	const swapped = { derivatives, originalStorageKey: next.key };
	const keptFiles = keptAfterSwap(
		asset.keptFiles ?? [],
		swapped,
		keptAfterReplace(asset, swapped, deps.now(), focal ? 'focal' : 'replace'),
	);
	const stored = await deps.assets.finishReplace({
		assetId: asset.id,
		set: {
			originalStorageKey: next.key,
			originalFormat: fresh.originalFormat,
			originalByteSize: bytes.byteLength,
			width: probe.width,
			height: probe.height,
			dominantColor: rendered.placeholder.dominantColor,
			thumbHash: rendered.placeholder.thumbHash,
			warnings: [...rendered.warnings],
			sha256: next.sha256,
		},
		derivatives,
		versions: allVersions,
		keptFiles,
	});
	if (!stored) return fail('replace_gone', rendered.added);
	return { status: 'ready', rendered: rendered.added.length, skipped: rendered.skipped };
};

/**
 * The daily sweep (decision 11): files kept after a Replace whose 7 days are over are sent for deletion, then
 * forgotten. Answers how many photos it cleared.
 */
export const sweepKeptFiles = async (
	deps: {
		assets: Pick<MediaAssetRepository, 'listKeptDue' | 'dropKept'>;
		queue: ProcessMediaAssetDeps['queue'];
		storage: Pick<ProcessMediaAssetDeps['storage'], 'getUrl'>;
	},
	now: Date,
	limit = 200,
): Promise<number> => {
	const before = now.toISOString();
	const due = await deps.assets.listKeptDue(before, limit);
	for (const asset of due) {
		const rows = (asset.keptFiles ?? []).filter((row) => row.deleteAfter <= before);
		// A file the photo shows again (same bytes, same address) stays, whatever the list says.
		const live = liveKeys(asset);
		const keys = rows.flatMap((row) => row.keys).filter((key) => !live.has(key));
		if (keys.length) {
			const pictures = keys.filter((key) => !/\/original[.-]/.test(key));
			await deps.queue.enqueue({
				type: 'delete-objects',
				keys,
				urls: asset.visibility === 'public' ? pictures.map((key) => deps.storage.getUrl(key)) : [],
			});
		}
		await deps.assets.dropKept(asset.id, before);
	}
	return due.length;
};
