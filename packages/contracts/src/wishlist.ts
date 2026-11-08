import { z } from 'zod';

import { CatalogCard } from './catalog-read';
import { Id, IsoDateTime } from './common';

/**
 * The wishlist (owner decision 2026-11-08).
 *
 * A guest's list lives only in the `st_wishlist` session cookie (product ids, at most
 * `WISHLIST_GUEST_LIMIT`), counted as a necessary cookie because the shopper creates it by
 * pressing the heart. A signed-in customer's list is stored with the account
 * (`wishlistItems`), changed only by them, and the guest list merges into it on sign-in.
 */
export const WISHLIST_GUEST_LIMIT = 50;
/** A ceiling per account, so one customer cannot grow the collection without end. */
export const WISHLIST_ACCOUNT_LIMIT = 200;
export const WISHLIST_GUEST_COOKIE = 'st_wishlist';

/** One saved product (`wishlistItems`). */
export const WishlistItem = z.object({
	customerId: Id,
	productId: Id,
	addedAt: IsoDateTime,
});
export type WishlistItem = z.infer<typeof WishlistItem>;

/** `POST /storefront/wishlist` — save one product. */
export const WishlistAddRequest = z.object({ productId: Id });
export type WishlistAddRequest = z.infer<typeof WishlistAddRequest>;

/** `POST /storefront/wishlist/merge` — the guest list, moved into the account on sign-in. */
export const WishlistMergeRequest = z.object({
	productIds: z.array(Id).max(WISHLIST_GUEST_LIMIT),
});
export type WishlistMergeRequest = z.infer<typeof WishlistMergeRequest>;

/** Every saved id (newest first), for the hearts; cards for the ones still on sale. */
export const WishlistView = z.object({
	productIds: z.array(Id),
	items: z.array(CatalogCard),
});
export type WishlistView = z.infer<typeof WishlistView>;

/** What a change answers: the ids, so every heart on the page can follow. */
export const WishlistIds = z.object({ productIds: z.array(Id) });
export type WishlistIds = z.infer<typeof WishlistIds>;
