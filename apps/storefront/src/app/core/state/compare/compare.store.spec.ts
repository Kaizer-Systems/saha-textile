import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { Observable, firstValueFrom, of, throwError, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompareService } from '@data-access/services/compare.service';
import { WishlistService } from '@data-access/services/wishlist.service';

import {
	CompareActions,
	CompareEffects,
	CompareFacade,
	compareReducer,
	selectCompareItems,
	selectCompareTotal,
} from './compare.store';
import {
	WishlistActions,
	WishlistEffects,
	WishlistFacade,
	selectWishlistItems,
	wishlistReducer,
} from '../wishlist/wishlist.store';

const item = (id: number | string) => ({ id }) as never;

describe.each([
	{
		name: 'compare',
		reducer: compareReducer,
		load: (items: never[], total: number) => CompareActions.loadCompareSuccess({ items, total }),
		remove: (id: number | string) => CompareActions.deleteCompare({ id }),
	},
	{
		name: 'wishlist',
		reducer: wishlistReducer,
		load: (data: never[], total: number) => WishlistActions.loadWishlistSuccess({ data, total }),
		remove: (id: number | string) => WishlistActions.deleteWishlist({ id }),
	},
])('$name reducer', ({ reducer, load, remove }) => {
	const initial = reducer(undefined, { type: 'init' } as never);

	it('replaces the list', () => {
		const state = reducer(initial, load([item(1), item(2)], 2) as never);
		expect(state.ids).toEqual([1, 2]);
		expect(state.total).toBe(2);
	});

	it('removes by number or text id, one at a time', () => {
		const loaded = reducer(initial, load([item(1), item('a')], 2) as never);
		const state = reducer(reducer(loaded, remove(1) as never), remove('a') as never);
		expect(state.ids).toEqual([]);
		expect(state.total).toBe(0);
	});
});

describe('selectors', () => {
	it('reads the compare list and total', () => {
		const state = { ids: [1], entities: { 1: item(1) }, total: 1 };
		expect(selectCompareItems.projector(state)).toEqual([{ id: 1 }]);
		expect(selectCompareTotal.projector(state)).toBe(1);
	});

	it('reads the wishlist view', () => {
		const state = { ids: [1], entities: { 1: item(1) }, total: 1 };
		expect(selectWishlistItems.projector(state)).toEqual({ data: [{ id: 1 }], total: 1 });
	});
});

describe('CompareEffects', () => {
	const run = (actions: Observable<unknown>, answer: Observable<unknown>) => {
		const service = { skeletonLoader: false, getCompareItems: vi.fn(() => answer) };
		const router = { navigate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				CompareEffects,
				provideMockActions(() => actions),
				{ provide: CompareService, useValue: service },
				{ provide: Router, useValue: router },
			],
		});
		return { effects: TestBed.inject(CompareEffects), service, router };
	};

	it.each([
		[{ data: [item(1)], total: 9 }, 9],
		[{ data: [item(1)] }, 1],
		[{}, 0],
	])('loads %j', async (answer, total) => {
		const { effects, service } = run(of(CompareActions.getCompare()), of(answer));
		const action = await firstValueFrom(effects.getCompare$);
		expect(action).toMatchObject({ total });
		expect(service.skeletonLoader).toBe(false);
	});

	it('stops the skeleton and emits nothing on failure', async () => {
		const { effects, service } = run(
			of(CompareActions.getCompare()),
			throwError(() => new Error('down')),
		);
		expect(await firstValueFrom(effects.getCompare$.pipe(toArray()))).toEqual([]);
		expect(service.skeletonLoader).toBe(false);
	});

	it('goes to the compare page on add', async () => {
		const { effects, router } = run(of(CompareActions.addToCompare({ payload: {} })), of({}));
		await firstValueFrom(effects.addToCompare$);
		expect(router.navigate).toHaveBeenCalledWith(['/compare']);
	});
});

describe('WishlistEffects', () => {
	const run = (actions: Observable<unknown>, answer: Observable<unknown>) => {
		const service = { skeletonLoader: false, getWishlistItems: vi.fn(() => answer) };
		const router = { navigate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				WishlistEffects,
				provideMockActions(() => actions),
				{ provide: WishlistService, useValue: service },
				{ provide: Router, useValue: router },
			],
		});
		return { effects: TestBed.inject(WishlistEffects), service, router };
	};

	it.each([
		[{ data: [item(1)], total: 9 }, 9],
		[{ data: [item(1)] }, 1],
		[{}, 0],
	])('loads %j', async (answer, total) => {
		const { effects } = run(of(WishlistActions.getWishlist()), of(answer));
		expect(await firstValueFrom(effects.getWishlist$)).toMatchObject({ total });
	});

	it('stops the skeleton and emits nothing on failure', async () => {
		const { effects, service } = run(
			of(WishlistActions.getWishlist()),
			throwError(() => new Error('down')),
		);
		expect(await firstValueFrom(effects.getWishlist$.pipe(toArray()))).toEqual([]);
		expect(service.skeletonLoader).toBe(false);
	});

	it('goes to the wishlist page on add', async () => {
		const { effects, router } = run(of(WishlistActions.addToWishlist({ payload: {} })), of({}));
		await firstValueFrom(effects.addToWishlist$);
		expect(router.navigate).toHaveBeenCalledWith(['/wishlist']);
	});
});

describe('Facades', () => {
	const setup = () => {
		const store = { select: vi.fn(() => of([])), dispatch: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: Store, useValue: store }] });
		return { store, compare: TestBed.inject(CompareFacade), wishlist: TestBed.inject(WishlistFacade) };
	};

	it('dispatches the compare actions', () => {
		const { store, compare } = setup();
		compare.getCompare();
		compare.addToCompare({ product_id: 1 });
		compare.deleteCompare(1);
		expect(store.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
			CompareActions.getCompare.type,
			CompareActions.addToCompare.type,
			CompareActions.deleteCompare.type,
		]);
	});

	it('dispatches the wishlist actions', () => {
		const { store, wishlist } = setup();
		wishlist.getWishlist();
		wishlist.addToWishlist({ product_id: 1 });
		wishlist.deleteWishlist(1);
		expect(store.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
			WishlistActions.getWishlist.type,
			WishlistActions.addToWishlist.type,
			WishlistActions.deleteWishlist.type,
		]);
	});
});
