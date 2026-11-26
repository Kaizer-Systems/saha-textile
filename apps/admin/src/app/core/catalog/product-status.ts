import type { CatalogProductStatus } from '@data-access/interfaces/catalog-product.interface';

/** A product's status in the admin's words and the `status-*` pill it wears. */
export interface ProductStatusView {
	/** A translation key. */
	label: string;
	pill: string;
}

/**
 * Q4 = A (owner, 2026-11-19): a product that is saved but has never been live reads "Not live yet";
 * "Draft" means only unfinished work saved with Save as draft. A product taken off after being live
 * reads "Off shop". The stored statuses do not change.
 */
export function productStatusView(status: CatalogProductStatus, wasLive: boolean): ProductStatusView {
	if (status === 'live') return { label: 'product_state_live', pill: 'status-success' };
	if (status === 'discontinued') return { label: 'product_state_discontinued', pill: 'status-danger' };
	if (wasLive) return { label: 'product_state_off_shop', pill: 'status-pending' };
	return { label: 'product_state_not_live_yet', pill: 'status-awaiting_for_approval' };
}
