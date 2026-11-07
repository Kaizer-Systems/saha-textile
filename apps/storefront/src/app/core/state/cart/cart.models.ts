import { EntityState, createEntityAdapter } from '@ngrx/entity';

import { ICart } from '@data-access/interfaces/cart.interface';

/**
 * The cart as the API last priced it, held so the header and cart screens paint at once, plus the
 * sticky and sidebar drawer flags. The server owns the lines and the total.
 */
export const CART_FEATURE_KEY = 'cart';

export const cartAdapter = createEntityAdapter<ICart>();

export interface CartStateModel extends EntityState<ICart> {
	total: number;
	stickyCartOpen: boolean;
	sidebarCartOpen: boolean;
}

export const initialCartState: CartStateModel = cartAdapter.getInitialState({
	total: 0,
	stickyCartOpen: false,
	sidebarCartOpen: false,
});
