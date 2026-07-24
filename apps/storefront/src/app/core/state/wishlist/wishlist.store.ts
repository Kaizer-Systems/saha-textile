import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { EntityState, createEntityAdapter } from '@ngrx/entity';
import {
	createActionGroup,
	createFeatureSelector,
	createReducer,
	createSelector,
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
 * Wishlist — classic NgRx with @ngrx/entity (matches admin's cart + compare). A
 * server read + a filter-delete + a no-op add that navigates to /wishlist. Not
 * persisted (the NGXS storage plugin didn't persist wishlist either). Actions +
 * reducer + selectors + effects + facade colocated since the feature is tiny.
 */
export const WISHLIST_FEATURE_KEY = 'wishlist';

export const wishlistAdapter = createEntityAdapter<IProduct>();

export interface WishlistStateModel extends EntityState<IProduct> {
	total: number;
}

/** View the facade/templates consume (the vendor markup reads `.data`). */
export interface WishlistView {
	data: IProduct[];
	total: number;
}

const initialState: WishlistStateModel = wishlistAdapter.getInitialState({ total: 0 });

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
	on(WishlistActions.loadWishlistSuccess, (state, { data, total }) => ({
		...wishlistAdapter.setAll(data, state),
		total,
	})),
	on(WishlistActions.deleteWishlist, (state, { id }) => ({
		...wishlistAdapter.removeOne(id, state),
		total: state.total - 1,
	})),
);

const selectWishlistState = createFeatureSelector<WishlistStateModel>(WISHLIST_FEATURE_KEY);
const { selectAll } = wishlistAdapter.getSelectors();
export const selectWishlistItems = createSelector(
	selectWishlistState,
	(state): WishlistView => ({ data: selectAll(state), total: state.total }),
);

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
					map((result) => {
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

	readonly wishlistItems$: Observable<WishlistView> = this.store.select(selectWishlistItems);

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
