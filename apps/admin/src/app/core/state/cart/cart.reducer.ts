import { EntityState, createEntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';

import { ICart } from '@data-access/interfaces/cart.interface';

import { CartActions } from './cart.actions';

export const cartAdapter = createEntityAdapter<ICart>();

export interface CartFeatureState extends EntityState<ICart> {
	total: number;
}

export const initialCartState: CartFeatureState = cartAdapter.getInitialState({ total: 0 });

const { selectAll } = cartAdapter.getSelectors();
const calcTotal = (state: CartFeatureState) =>
	selectAll(state).reduce((prev, curr) => prev + Number(curr.sub_total), 0);

export const cartReducer = createReducer(
	initialCartState,
	on(CartActions.loadCartSuccess, (state, { items, total }) => {
		const next = cartAdapter.setAll(items, state);
		return { ...next, total: total ? total : calcTotal(next) };
	}),
	on(CartActions.addNewItem, (state, { payload }) => {
		const salePrice = payload.variation ? payload.variation.sale_price : payload.product?.sale_price;
		const item: ICart = {
			// Generate a random client-side id (mock cart — no backend id yet).
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
		};
		const next = cartAdapter.addOne(item, state);
		return { ...next, total: calcTotal(next) };
	}),
	on(CartActions.setQuantity, (state, { id, quantity }) => {
		const item = state.entities[id];
		if (!item) return state;
		const salePrice = item.variation ? item.variation.sale_price : item.product.sale_price;
		const next = cartAdapter.updateOne({ id, changes: { quantity, sub_total: quantity * salePrice } }, state);
		return { ...next, total: calcTotal(next) };
	}),
	on(CartActions.deleteCart, (state, { id }) => {
		const next = cartAdapter.removeOne(id, state);
		return { ...next, total: calcTotal(next) };
	}),
	on(CartActions.clearCart, (state) => ({ ...cartAdapter.removeAll(state), total: 0 })),
);
