import type { Location, UserLocations } from '@saha-textile/contracts';

/** Locations and who works where (accounts brief K, L). */
export interface LocationRepository {
	list(): Promise<Location[]>;
	get(id: string): Promise<Location | null>;
	/** Optimistic: refused with StaleVersionError when someone saved in between (null expected = a new location). */
	save(location: Location, expectedUpdatedAt: string | null): Promise<void>;
	userLocations(userId: string): Promise<UserLocations | null>;
	saveUserLocations(value: UserLocations): Promise<void>;
	/** Everyone's assignments, for the locations list's "people at each". */
	allUserLocations(): Promise<UserLocations[]>;
}
