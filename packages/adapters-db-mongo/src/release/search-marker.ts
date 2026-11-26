import { ReleaseMarkerModel } from '../models/index';

const SEARCH_VERSION = 'search-index-version';

/** Remembers that this search version's index was fully built, for releases made while search is down. */
export async function recordSearchVersionBuilt(version: number, at: Date): Promise<void> {
	await ReleaseMarkerModel.updateOne(
		{ _id: SEARCH_VERSION },
		{ $set: { value: version, at } },
		{ upsert: true },
	).exec();
}

/** The last search version recorded as built, or null when none was. */
export async function lastBuiltSearchVersion(): Promise<number | null> {
	const row = await ReleaseMarkerModel.findById(SEARCH_VERSION).lean().exec();
	return row?.value ?? null;
}
