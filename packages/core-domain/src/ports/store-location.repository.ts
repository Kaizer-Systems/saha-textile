import type { StoreLocation } from '@saha-textile/contracts';

/** The shop's physical stores (`storeLocations`). Lists come in display order. */
export interface StoreLocationRepository {
	list(): Promise<StoreLocation[]>;
	findById(id: string): Promise<StoreLocation | null>;
	save(store: StoreLocation): Promise<StoreLocation>;
	remove(id: string): Promise<void>;
	/** Writes `displayOrder` 0, 1, 2… in the order of `ids`. Ids not stored are ignored. */
	setOrder(ids: readonly string[]): Promise<void>;
}
