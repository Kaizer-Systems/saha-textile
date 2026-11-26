import {
	defaultStockLocation,
	type LocationRepository,
	type StockMovementPort,
	type TransactionContext,
} from '@saha-textile/core-domain';
import type { LocationStock } from '@saha-textile/contracts';

/** How long the default stock location is trusted before it is read again (a location may be switched off). */
const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * Stock by location (accounts brief F4): every stock move records its location. A move whose document names
 * none goes to the business's default stock location (the first warehouse that ships online), and the first
 * time that location is known, stock that has no location yet is placed there, so the per-location rows always
 * add up to each variant's total. Transfers, counters and order routing pass their own location.
 */
export class LocationStockMovement implements StockMovementPort {
	private placed: Promise<void> | null = null;
	private cached: { id: string; at: number } | null = null;

	constructor(
		private readonly inner: StockMovementPort,
		private readonly locations: Pick<LocationRepository, 'list'>,
	) {}

	/** The default stock location, or null while the business has no warehouse (moves then stay unplaced). */
	async defaultLocation(): Promise<string | null> {
		if (this.cached && Date.now() - this.cached.at < DEFAULT_TTL_MS) return this.cached.id;
		const id = defaultStockLocation(await this.locations.list());
		if (!id) return null;
		this.placed ??= this.inner
			.placeUnlocatedStock(id)
			.then(() => undefined)
			.catch((error: unknown) => {
				this.placed = null;
				throw error;
			});
		await this.placed;
		this.cached = { id, at: Date.now() };
		return id;
	}

	async move(input: Parameters<StockMovementPort['move']>[0], context?: TransactionContext) {
		const locationId = input.locationId ?? (await this.defaultLocation());
		return this.inner.move({ ...input, locationId }, context);
	}

	consumeLayer(layerId: string, quantity: number, context?: TransactionContext): Promise<void> {
		return this.inner.consumeLayer(layerId, quantity, context);
	}

	locationStock(variantIds: readonly string[]): Promise<LocationStock[]> {
		return this.inner.locationStock(variantIds);
	}

	placeUnlocatedStock(locationId: string) {
		return this.inner.placeUnlocatedStock(locationId);
	}
}
