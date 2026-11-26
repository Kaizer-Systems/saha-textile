import type { Location } from '@saha-textile/contracts';

/**
 * Where stock moves when a document names no location (accounts brief F4): the first active warehouse that ships
 * online orders, else the first active warehouse. Null when the business has no warehouse yet.
 */
export function defaultStockLocation(
	locations: readonly Pick<Location, 'id' | 'active' | 'warehouse' | 'shipsOnline' | 'createdAt'>[],
): string | null {
	const active = [...locations]
		.filter((l) => l.active && l.warehouse)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return (active.find((l) => l.shipsOnline) ?? active[0])?.id ?? null;
}
