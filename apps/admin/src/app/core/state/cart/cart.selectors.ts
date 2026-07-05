import { createFeatureSelector, createSelector } from '@ngrx/store';

import { CartFeatureState, cartAdapter } from './cart.reducer';

export const selectCartState = createFeatureSelector<CartFeatureState>('cart');

const { selectAll } = cartAdapter.getSelectors();

export const selectCartItems = createSelector(selectCartState, selectAll);
export const selectCartTotal = createSelector(selectCartState, (state) => state.total);
