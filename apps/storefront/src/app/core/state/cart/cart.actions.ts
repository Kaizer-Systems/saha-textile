import { createActionGroup, emptyProps, props } from '@ngrx/store';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { CartStateModel } from './cart.models';

/**
 * Cart actions — mirror the old NGXS cart actions 1:1 so consumers map directly,
 * plus two internal helpers (`Load Cart Success`, `Patch Cart`) the effects use
 * to feed computed state into the pure reducer, and a `Noop` for effect branches
 * that intentionally change nothing (e.g. an out-of-stock update).
 */
export const CartActions = createActionGroup({
  source: 'Cart',
  events: {
    'Get Cart Items': emptyProps(),
    'Load Cart Success': props<{ items: ICart[]; total: number }>(),
    'Add To Cart': props<{ payload: ICartAddOrUpdate }>(),
    'Add To Cart Local Storage': props<{ payload: ICartAddOrUpdate }>(),
    'Update Cart': props<{ payload: ICartAddOrUpdate }>(),
    'Replace Cart': props<{ payload: ICartAddOrUpdate }>(),
    'Delete Cart': props<{ id: number }>(),
    'Close Sticky Cart': emptyProps(),
    'Toggle Sidebar Cart': props<{ value: boolean }>(),
    'Clear Cart': emptyProps(),
    'Patch Cart': props<{ changes: Partial<CartStateModel> }>(),
    Noop: emptyProps(),
  },
});
