import type { MediaProfile } from '@saha-textile/contracts';

/** Image profiles (`mediaProfiles`, Settings › Image profiles). Keyed by the profile key. */
export interface MediaProfileRepository {
	list(): Promise<MediaProfile[]>;
	findByKey(key: string): Promise<MediaProfile | null>;
	save(profile: MediaProfile): Promise<MediaProfile>;
	/** Removes a profile (never a built-in one: the use case checks first). */
	delete(key: string): Promise<void>;
	/** Inserts the given profiles where their key is missing; never overwrites an admin's edits. */
	insertMissing(profiles: readonly MediaProfile[]): Promise<number>;
	/** How many live photos hold at least one version of each profile (the Images column on F01). */
	countPhotosByProfile(): Promise<Record<string, number>>;
}
