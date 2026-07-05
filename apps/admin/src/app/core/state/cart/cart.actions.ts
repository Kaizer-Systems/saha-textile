import { createActionGroup, emptyProps, props } from '@ngrx/store';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';

export const CartActions = createActionGroup({
	source: 'Cart',
	events: {
		'Load Cart': emptyProps(),
		'Load Cart Success': props<{ items: ICart[]; total: number }>(),
		'Add To Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Add New Item': props<{ payload: ICartAddOrUpdate }>(),
		'Update Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Set Quantity': props<{ id: number; quantity: number }>(),
		'Delete Cart': props<{ id: number }>(),
		'Clear Cart': emptyProps(),
	},
});
