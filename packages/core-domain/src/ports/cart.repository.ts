import type { Cart } from '@saha/contracts';

export interface CartRepository {
	findById(id: string): Promise<Cart | null>;
	findByUserId(userId: string): Promise<Cart | null>;
	findByGuestToken(guestToken: string): Promise<Cart | null>;
	save(cart: Cart): Promise<Cart>;
	deleteById(id: string): Promise<void>;
}
