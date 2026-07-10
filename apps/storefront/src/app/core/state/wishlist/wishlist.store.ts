import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  createActionGroup,
  createFeatureSelector,
  createReducer,
  emptyProps,
  on,
  props,
  Store,
} from '@ngrx/store';
import { catchError, EMPTY, map, Observable, switchMap, tap } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { WishlistService } from '@data-access/services/wishlist.service';

/**
 * Wishlist — classic NgRx (replaces NGXS WishlistState). A server read + a
 * filter-delete + a no-op add that just navigates to /wishlist (no backend yet).
 * Not persisted (the NGXS storage plugin didn't persist wishlist either). Actions
 * + reducer + selectors + effects + facade colocated since the feature is tiny.
 */
export const WISHLIST_FEATURE_KEY = 'wishlist';

export interface WishlistStateModel {
  data: IProduct[];
  total: number;
}

const initialState: WishlistStateModel = { data: [], total: 0 };

export const WishlistActions = createActionGroup({
  source: 'Wishlist',
  events: {
    'Get Wishlist': emptyProps(),
    'Load Wishlist Success': props<{ data: IProduct[]; total: number }>(),
    'Add To Wishlist': props<{ payload: Params }>(),
    'Delete Wishlist': props<{ id: number }>(),
  },
});

export const wishlistReducer = createReducer(
  initialState,
  on(WishlistActions.loadWishlistSuccess, (_state, { data, total }) => ({ data, total })),
  on(WishlistActions.deleteWishlist, (state, { id }) => ({
    data: state.data.filter(value => value.id !== id),
    total: state.total - 1,
  })),
);

const selectWishlistState = createFeatureSelector<WishlistStateModel>(WISHLIST_FEATURE_KEY);
export const selectWishlistItems = selectWishlistState;

@Injectable()
export class WishlistEffects {
  private actions$ = inject(Actions);
  private router = inject(Router);
  private wishlistService = inject(WishlistService);

  getWishlist$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WishlistActions.getWishlist),
      tap(() => (this.wishlistService.skeletonLoader = true)),
      switchMap(() =>
        this.wishlistService.getWishlistItems().pipe(
          map(result => {
            this.wishlistService.skeletonLoader = false;
            return WishlistActions.loadWishlistSuccess({
              data: result.data,
              total: result?.total ? result.total : result.data ? result.data.length : 0,
            });
          }),
          catchError(() => {
            this.wishlistService.skeletonLoader = false;
            return EMPTY;
          }),
        ),
      ),
    ),
  );

  // Add is a no-op mock that just routes to the wishlist page (was the reducer).
  addToWishlist$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(WishlistActions.addToWishlist),
        tap(() => void this.router.navigate(['/wishlist'])),
      ),
    { dispatch: false },
  );
}

@Injectable({ providedIn: 'root' })
export class WishlistFacade {
  private store = inject(Store);

  readonly wishlistItems$: Observable<WishlistStateModel> = this.store.select(selectWishlistItems);

  getWishlist(): void {
    this.store.dispatch(WishlistActions.getWishlist());
  }
  addToWishlist(payload: Params): void {
    this.store.dispatch(WishlistActions.addToWishlist({ payload }));
  }
  deleteWishlist(id: number): void {
    this.store.dispatch(WishlistActions.deleteWishlist({ id }));
  }
}
