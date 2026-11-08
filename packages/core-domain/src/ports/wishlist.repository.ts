/**
 * A signed-in customer's wishlist (`wishlistItems`). Every method takes the customer id from
 * the caller's session; nothing here can reach another customer's list.
 */
export interface WishlistRepository {
	/** Saved product ids, newest first. */
	listProductIds(customerId: string): Promise<string[]>;
	/** Saves one product; saving it again changes nothing. */
	add(input: { customerId: string; productId: string; at: string }): Promise<void>;
	/** Saves several at once (a guest list on sign-in), skipping what is already saved. */
	addMany(input: { customerId: string; productIds: readonly string[]; at: string }): Promise<void>;
	remove(input: { customerId: string; productId: string }): Promise<void>;
	/** Erasure: the whole list goes with the account. */
	removeAllForCustomer(customerId: string): Promise<void>;
}
