export function listingRobots(filter: Record<string, unknown>): 'noindex,follow' | 'index,follow' {
	const filtered = !!(filter['attribute'] || filter['price'] || filter['rating'] || Number(filter['page']) > 1);
	return filtered ? 'noindex,follow' : 'index,follow';
}
