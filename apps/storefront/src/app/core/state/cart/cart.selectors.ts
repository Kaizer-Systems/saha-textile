import { createFeatureSelector, createSelector } from '@ngrx/store';

import { CART_FEATURE_KEY, CartStateModel } from './cart.models';

export const selectCartState = createFeatureSelector<CartStateModel>(CART_FEATURE_KEY);

export const selectCartItems = createSelector(selectCartState, state => state.items);
export const selectCartTotal = createSelector(selectCartState, state => state.total);
export const selectStickyCart = createSelector(selectCartState, state => state.stickyCartOpen);
export const selectSidebarCartOpen = createSelector(selectCartState, state => state.sidebarCartOpen);
