import type { ProductStatus } from '@saha-textile/contracts';

/**
 * Who is asking for catalog data. Everything that is not explicitly an authorized
 * admin read is `public`, and repositories default to `public` so a forgotten
 * argument fails CLOSED (hides data) rather than open.
 */
export type CatalogAudience = 'public' | 'admin';

/**
 * The only status a storefront surface may return (owner lock, catalog section):
 * listing, search, sitemap, feeds, and direct slug/id reads all agree on this.
 */
export const STOREFRONT_VISIBLE_PRODUCT_STATUSES: readonly ProductStatus[] = ['live'];

/** True when a product may be shown on any public surface. */
export const isStorefrontVisible = (status: ProductStatus): boolean =>
	STOREFRONT_VISIBLE_PRODUCT_STATUSES.includes(status);

/**
 * Narrows a caller-supplied status filter to what the audience is allowed to see.
 *
 * Public callers can only ever narrow WITHIN the visible set — asking for `draft`
 * returns nothing rather than leaking unpublished products, which is why this returns
 * an explicit list of statuses to match instead of a single value.
 */
export const resolveProductStatusFilter = (
	audience: CatalogAudience = 'public',
	requested?: ProductStatus,
): readonly ProductStatus[] | undefined => {
	if (audience === 'admin') return requested ? [requested] : undefined;
	if (!requested) return STOREFRONT_VISIBLE_PRODUCT_STATUSES;
	return isStorefrontVisible(requested) ? [requested] : [];
};

/**
 * Statuses whose products are removed from the search index and the sitemap. Kept as
 * the complement of the visible set so the two can never drift apart.
 */
export const isSearchIndexable = (status: ProductStatus): boolean => isStorefrontVisible(status);

/**
 * When a discontinued product's rich data and media become eligible for purge.
 *
 * `retentionDays` is CONFIGURATION (owner-locked at 30 days today) rather than a
 * constant baked into the domain, so changing the window is a config change. Returns
 * `null` for a product that was never discontinued.
 */
export const discontinuationPurgeDueAt = (
	discontinuedAt: Date | string | null | undefined,
	retentionDays: number,
): Date | null => {
	if (!discontinuedAt) return null;
	if (!Number.isFinite(retentionDays) || retentionDays < 0) {
		throw new RangeError('retentionDays must be a non-negative finite number');
	}

	const start = discontinuedAt instanceof Date ? discontinuedAt : new Date(discontinuedAt);
	if (Number.isNaN(start.getTime())) throw new RangeError('discontinuedAt must be a valid date');

	return new Date(start.getTime() + retentionDays * 24 * 60 * 60 * 1000);
};

/** True when the retention window has elapsed and the tombstone reduction may run. */
export const isDiscontinuationPurgeDue = (
	discontinuedAt: Date | string | null | undefined,
	retentionDays: number,
	now: Date,
): boolean => {
	const dueAt = discontinuationPurgeDueAt(discontinuedAt, retentionDays);
	return dueAt !== null && now.getTime() >= dueAt.getTime();
};
