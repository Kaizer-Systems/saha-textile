import type { MediaAsset, MediaNightlyCheck } from '@saha-textile/contracts';

import { shownDerivatives } from './resolve-image';

/** At most this many missing photos and unrecorded files are kept by name in the result. */
const LISTED = 50;
const SAMPLE = 20;
const BATCH = 500;

export interface SpacesCheckDeps {
	listKeys(prefix: string): AsyncIterable<{ key: string; bytes: number }>;
	referencedIds(): Promise<string[]>;
	findManyByIds(ids: readonly string[]): Promise<MediaAsset[]>;
	whereUsed(ids: readonly string[]): Promise<Map<string, string[]>>;
}

/** `media/{assetId}/…`: the photo or file a stored key belongs to. */
const assetOf = (key: string): string | null => /^media\/(med_[^/]+)\//.exec(key)?.[1] ?? null;

/**
 * The nightly Spaces check (Media brief R5-5, “Settled”; media step 5). Lists what Spaces holds under `media/`,
 * then (1) confirms every picture a page uses really exists — a photo the website shows with a file gone is named
 * with where it is used — and (2) counts files Spaces holds that no record knows (made by other tools, or left
 * behind). It changes nothing: the result is kept for the Media page and the bell.
 */
export async function checkSpaces(deps: SpacesCheckDeps, now: Date): Promise<MediaNightlyCheck> {
	const stored = new Set<string>();
	const byAsset = new Map<string, { bytes: number; keys: string[] }>();
	let bytes = 0;
	for await (const item of deps.listKeys('media/')) {
		stored.add(item.key);
		bytes += item.bytes;
		const assetId = assetOf(item.key);
		if (!assetId) continue;
		const entry = byAsset.get(assetId) ?? { bytes: 0, keys: [] };
		entry.bytes += item.bytes;
		entry.keys.push(item.key);
		byAsset.set(assetId, entry);
	}

	// Files no record knows.
	const known = new Set<string>();
	const ids = [...byAsset.keys()];
	for (let at = 0; at < ids.length; at += BATCH) {
		for (const asset of await deps.findManyByIds(ids.slice(at, at + BATCH))) known.add(asset.id);
	}
	const unknownIds = ids.filter((id) => !known.has(id));
	const unrecordedKeys = unknownIds.flatMap((id) => byAsset.get(id)?.keys ?? []);

	// Pictures the website uses whose files are gone.
	const used = await deps.referencedIds();
	const missing: MediaNightlyCheck['missing'] = [];
	let missingCount = 0;
	for (let at = 0; at < used.length; at += BATCH) {
		const assets = (await deps.findManyByIds(used.slice(at, at + BATCH))).filter(
			(asset) => !asset.deletedAt && asset.kind === 'image' && asset.processing.state === 'ready',
		);
		const gone = assets.flatMap((asset) => {
			const lost = shownDerivatives(asset).filter((file) => !stored.has(file.storageKey)).length;
			return lost ? [{ asset, lost }] : [];
		});
		missingCount += gone.length;
		const room = LISTED - missing.length;
		if (room <= 0 || !gone.length) continue;
		const places = await deps.whereUsed(gone.slice(0, room).map((row) => row.asset.id));
		for (const { asset, lost } of gone.slice(0, room)) {
			missing.push({
				assetId: asset.id,
				name: asset.displayName ?? asset.slug,
				usedOn: places.get(asset.id) ?? [],
				files: lost,
			});
		}
	}

	return {
		checkedAt: now.toISOString(),
		filesInSpaces: stored.size,
		bytesInSpaces: bytes,
		missing,
		missingCount,
		unrecorded: {
			count: unrecordedKeys.length,
			bytes: unknownIds.reduce((sum, id) => sum + (byAsset.get(id)?.bytes ?? 0), 0),
			sample: unrecordedKeys.slice(0, SAMPLE),
		},
	};
}
