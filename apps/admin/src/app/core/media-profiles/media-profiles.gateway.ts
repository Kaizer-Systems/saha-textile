import type {
	MediaProfile,
	MediaProfileListItem,
	MediaProfileUpdate,
	MediaProfileWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type { MediaProfile, MediaProfileListItem, MediaProfileUpdate, MediaProfileWrite };

/** Settings › Image profiles (media step 2c, Media brief F01–F03). */
export abstract class MediaProfilesGateway {
	abstract list(): Observable<MediaProfileListItem[]>;
	abstract get(key: string): Observable<MediaProfileListItem>;
	abstract create(write: MediaProfileWrite): Observable<MediaProfile>;
	/** Any part of a profile; the list's Status switch sends `enabled` alone. */
	abstract update(key: string, update: MediaProfileUpdate): Observable<MediaProfile>;
	abstract remove(key: string): Observable<void>;
}
