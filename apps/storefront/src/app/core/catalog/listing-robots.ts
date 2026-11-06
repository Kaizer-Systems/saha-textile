export function listingRobots(filter: Record<string, unknown>): 'noindex,follow' | 'index,follow' {
	const narrowed = ['attribute', 'price', 'rating', 'category', 'sortBy'].some((key) => filter[key]);
	const filtered = narrowed || Number(filter['page']) > 1;
	return filtered ? 'noindex,follow' : 'index,follow';
}
