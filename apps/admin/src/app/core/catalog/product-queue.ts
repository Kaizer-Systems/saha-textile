/**
 * The product list's order, remembered for "Save and next": opening a product from the list keeps
 * the ids of the rows on screen, in order, for this browser tab. Nothing is stored but ids.
 */
const KEY = 'st_admin_product_queue';

export function rememberProductQueue(storage: Storage | null, ids: readonly string[]): void {
	try {
		storage?.setItem(KEY, JSON.stringify(ids.slice(0, 200)));
	} catch {
		// Storage can be full or blocked; Save and next then simply does not appear.
	}
}

/** The product after `currentId` in the remembered list, or null at the end or without a list. */
export function nextInProductQueue(storage: Storage | null, currentId: string | undefined): string | null {
	if (!currentId) return null;
	try {
		const ids: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
		if (!Array.isArray(ids)) return null;
		const index = ids.indexOf(currentId);
		const next = index >= 0 ? ids[index + 1] : undefined;
		return typeof next === 'string' ? next : null;
	} catch {
		return null;
	}
}
