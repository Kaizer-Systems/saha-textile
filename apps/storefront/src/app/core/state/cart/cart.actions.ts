import { createActionGroup, emptyProps, props } from '@ngrx/store';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';

/**
 * Cart actions. The public ones (getCartItems/addToCart/updateCart/replaceCart/
 * deleteCart/toggle/clear) mirror the old NGXS cart actions 1:1 so the facade and
 * consumers are unchanged. `addNewItem` (adapter.addOne) and `updateItem`
 * (adapter.updateOne) are the entity write actions the effects dispatch after
 * computing the stock-checked result — one generic updateItem serves both a
 * quantity change and a variation replace.
 */
export const CartActions = createActionGroup({
	source: 'Cart',
	events: {
		'Get Cart Items': emptyProps(),
		'Load Cart Success': props<{ items: ICart[]; total: number }>(),
		'Add To Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Add New Item': props<{ payload: ICartAddOrUpdate }>(),
		'Update Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Replace Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Update Item': props<{ id: number; changes: Partial<ICart> }>(),
		'Delete Cart': props<{ id: number }>(),
		'Close Sticky Cart': emptyProps(),
		'Toggle Sidebar Cart': props<{ value: boolean }>(),
		'Clear Cart': emptyProps(),
	},
});
