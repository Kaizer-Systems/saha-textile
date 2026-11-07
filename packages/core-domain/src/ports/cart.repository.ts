import type { Cart } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

export interface CartRepository {
	findById(id: string): Promise<Cart | null>;
	findByUserId(userId: string): Promise<Cart | null>;
	/** Lookup by the stored guest-token HASH — never the raw cookie value. */
	findByGuestToken(guestTokenHash: string): Promise<Cart | null>;
	save(cart: Cart, context?: TransactionContext): Promise<Cart>;
	deleteById(id: string, context?: TransactionContext): Promise<void>;
}
