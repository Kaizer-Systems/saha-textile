import { createFeatureSelector, createSelector } from '@ngrx/store';

import { CART_FEATURE_KEY, CartStateModel, cartAdapter } from './cart.models';

export const selectCartState = createFeatureSelector<CartStateModel>(CART_FEATURE_KEY);

const { selectAll } = cartAdapter.getSelectors();

export const selectCartItems = createSelector(selectCartState, selectAll);
export const selectCartTotal = createSelector(selectCartState, (state) => state.total);
export const selectStickyCart = createSelector(selectCartState, (state) => state.stickyCartOpen);
export const selectSidebarCartOpen = createSelector(selectCartState, (state) => state.sidebarCartOpen);
