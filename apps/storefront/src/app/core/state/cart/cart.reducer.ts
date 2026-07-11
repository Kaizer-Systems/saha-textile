import { createReducer, on } from '@ngrx/store';

import { ICart } from '@data-access/interfaces/cart.interface';
import { CartActions } from './cart.actions';
import { CartStateModel, calcCartTotal, cartAdapter, initialCartState, variationLabel } from './cart.models';

/** Attach the joined variation label the templates read (was set in the reducers). */
const withSelectedVariation = (item: ICart): ICart =>
	item?.variation
		? { ...item, variation: { ...item.variation, selected_variation: variationLabel(item.variation) } }
		: item;

/**
 * Pure reducer — applies @ngrx/entity adapter ops. The stock/variation/routing
 * logic lives in the effects, which dispatch addNewItem / updateItem / deleteCart
 * with the already-computed result; the reducer just mutates the collection and
 * recomputes the running total.
 */
export const cartReducer = createReducer(
	initialCartState,
	on(CartActions.loadCartSuccess, (state, { items, total }) => {
		const next = cartAdapter.setAll(items.map(withSelectedVariation), state);
		return { ...next, total: total ? total : calcCartTotal(next) };
	}),
	on(CartActions.addNewItem, (state, { payload }) => {
		const salePrice = payload.variation ? payload.variation.sale_price : payload.product?.sale_price;
		const item = withSelectedVariation({
			// Random client-side id (mock cart — no backend id yet).
			id: Number(
				Math.floor(Math.random() * 10000)
					.toString()
					.padStart(4, '0'),
			),
			quantity: payload.quantity,
			sub_total: salePrice ? salePrice * payload.quantity : 0,
			product: payload.product!,
			product_id: payload.product_id,
			variation: payload.variation!,
			variation_id: payload.variation_id,
		} as ICart);
		const next = cartAdapter.addOne(item, state);
		return { ...next, total: calcCartTotal(next), stickyCartOpen: true, sidebarCartOpen: true };
	}),
	on(CartActions.updateItem, (state, { id, changes }) => {
		const next = cartAdapter.updateOne({ id, changes }, state);
		return { ...next, total: calcCartTotal(next) };
	}),
	on(CartActions.deleteCart, (state, { id }) => {
		const next = cartAdapter.removeOne(id, state);
		return { ...next, total: calcCartTotal(next) };
	}),
	on(CartActions.closeStickyCart, (state) => ({ ...state, stickyCartOpen: false })),
	on(CartActions.toggleSidebarCart, (state, { value }) => ({ ...state, sidebarCartOpen: value })),
	on(CartActions.clearCart, (state) => ({ ...cartAdapter.removeAll(state), total: 0 })),
);
