import type { LocationStock, OrderRoutingSettings, RoutingCandidate } from '@saha-textile/contracts';

export interface RoutingInput {
	/** The order's stocked pieces (made-to-order lines and a set's own line carry no stock). */
	lines: readonly { variantId: string; quantity: number }[];
	/** The split of those variants' stock by location. */
	stock: readonly LocationStock[];
	/** Locations that may ship an online order: active warehouses that ship online. */
	shippingLocationIds: readonly string[];
	/** The default stock location, preferred when several have every piece. */
	defaultLocationId: string | null;
}

export interface RoutingResult {
	/** Set when the order gets its location by itself (mode `auto` and one location has every piece). */
	assign: string | null;
	/** What a manager is offered first (modes `suggest` and `auto` when nothing was assigned). */
	suggestion: string | null;
	candidates: RoutingCandidate[];
}

/**
 * Where an order ships from (accounts brief M1, M2; D14). Each shipping location is scored by how many of the
 * order's pieces it holds free. With every piece at one location, `auto` assigns it (the default location first
 * when several qualify) and `suggest` offers it; otherwise nothing is assigned and a manager decides. Never
 * splits by itself.
 */
export function routeOrder(input: RoutingInput, settings: Pick<OrderRoutingSettings, 'mode'>): RoutingResult {
	const wanted = new Map<string, number>();
	for (const line of input.lines) wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);
	const of = [...wanted.values()].reduce((sum, n) => sum + n, 0);
	const candidates: RoutingCandidate[] = input.shippingLocationIds.map((locationId) => {
		let has = 0;
		for (const [variantId, quantity] of wanted) {
			const row = input.stock.find((s) => s.variantId === variantId && s.locationId === locationId);
			const free = row ? Math.max(0, row.onHand - row.held - row.reserved) : 0;
			has += Math.min(free, quantity);
		}
		return { locationId, has, of };
	});
	candidates.sort(
		(a, b) =>
			b.has - a.has ||
			Number(b.locationId === input.defaultLocationId) - Number(a.locationId === input.defaultLocationId),
	);
	const complete = of > 0 ? candidates.find((c) => c.has === of) : undefined;
	const best = complete?.locationId ?? null;
	if (settings.mode === 'manual') return { assign: null, suggestion: null, candidates };
	if (settings.mode === 'auto' && best) return { assign: best, suggestion: best, candidates };
	return { assign: null, suggestion: best, candidates };
}
