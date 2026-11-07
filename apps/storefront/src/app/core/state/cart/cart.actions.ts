import { createActionGroup, emptyProps, props } from '@ngrx/store';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';

/**
 * Cart actions. The shopper's actions go to the API through the effects, and every answer comes
 * back as `Load Cart Success` or `Cart Line Added` holding the whole priced cart.
 */
export const CartActions = createActionGroup({
	source: 'Cart',
	events: {
		'Get Cart Items': emptyProps(),
		'Load Cart Success': props<{ items: ICart[]; total: number }>(),
		'Add To Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Cart Line Added': props<{ items: ICart[]; total: number }>(),
		'Update Cart': props<{ payload: ICartAddOrUpdate }>(),
		'Edit Line': props<{ payload: ICartAddOrUpdate }>(),
		'Delete Cart': props<{ id: string }>(),
		'Close Sticky Cart': emptyProps(),
		'Toggle Sidebar Cart': props<{ value: boolean }>(),
	},
});
