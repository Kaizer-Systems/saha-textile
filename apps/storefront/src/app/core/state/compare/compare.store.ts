import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { EntityState, createEntityAdapter } from '@ngrx/entity';
import { Actions, createEffect, ofType } from '@ngrx/effects';
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
import { CompareService } from '@data-access/services/compare.service';

/**
 * Compare — classic NgRx with @ngrx/entity (matches admin's cart). Same shape as
 * wishlist: a server read + filter-delete + a no-op add that routes to /compare.
 * Not persisted.
 */
export const COMPARE_FEATURE_KEY = 'compare';

export const compareAdapter = createEntityAdapter<IProduct>();

export interface CompareStateModel extends EntityState<IProduct> {
	total: number;
}

const initialState: CompareStateModel = compareAdapter.getInitialState({ total: 0 });

export const CompareActions = createActionGroup({
	source: 'Compare',
	events: {
		'Get Compare': emptyProps(),
		'Load Compare Success': props<{ items: IProduct[]; total: number }>(),
		'Add To Compare': props<{ payload: Params }>(),
		'Delete Compare': props<{ id: number }>(),
	},
});

export const compareReducer = createReducer(
	initialState,
	on(CompareActions.loadCompareSuccess, (state, { items, total }) => ({
		...compareAdapter.setAll(items, state),
		total,
	})),
	on(CompareActions.deleteCompare, (state, { id }) => ({
		...compareAdapter.removeOne(id, state),
		total: state.total - 1,
	})),
);

const selectCompareState = createFeatureSelector<CompareStateModel>(COMPARE_FEATURE_KEY);
const { selectAll } = compareAdapter.getSelectors();
export const selectCompareItems = createSelector(selectCompareState, selectAll);
export const selectCompareTotal = createSelector(selectCompareState, (state) => state.total);

@Injectable()
export class CompareEffects {
	private actions$ = inject(Actions);
	private router = inject(Router);
	private compareService = inject(CompareService);

	getCompare$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CompareActions.getCompare),
			tap(() => (this.compareService.skeletonLoader = true)),
			switchMap(() =>
				this.compareService.getCompareItems().pipe(
					map((result) => {
						this.compareService.skeletonLoader = false;
						return CompareActions.loadCompareSuccess({
							items: result.data,
							total: result?.total ? result.total : result.data ? result.data.length : 0,
						});
					}),
					catchError(() => {
						this.compareService.skeletonLoader = false;
						return EMPTY;
					}),
				),
			),
		),
	);

	addToCompare$ = createEffect(
		() =>
			this.actions$.pipe(
				ofType(CompareActions.addToCompare),
				tap(() => void this.router.navigate(['/compare'])),
			),
		{ dispatch: false },
	);
}

@Injectable({ providedIn: 'root' })
export class CompareFacade {
	private store = inject(Store);

	readonly compareItems$: Observable<IProduct[]> = this.store.select(selectCompareItems);
	readonly compareTotal$: Observable<number> = this.store.select(selectCompareTotal);

	getCompare(): void {
		this.store.dispatch(CompareActions.getCompare());
	}
	addToCompare(payload: Params): void {
		this.store.dispatch(CompareActions.addToCompare({ payload }));
	}
	deleteCompare(id: number): void {
		this.store.dispatch(CompareActions.deleteCompare({ id }));
	}
}
