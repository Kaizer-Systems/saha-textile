import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CouponsGateway } from '@core/coupons/coupons.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { CouponBuilder, blankCoupon, couponFieldsOf, couponWords } from './coupon-builder';
import { CouponList, toCouponRow } from './coupon-list';

import type { Coupon, CouponListRow, CouponWrite } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	categories: undefined as unknown,
	list: undefined as unknown,
	listQuery: null as null | (() => unknown),
}));
vi.mock('@data-access/queries/category.queries', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		injectCategoriesQuery: (params: () => unknown) => {
			params();
			return { data: make(h.categories) };
		},
	};
});
vi.mock('@core/coupons/coupons.gateway', async (original) => {
	const { signal: make } = await import('@angular/core');
	return {
		...(await original<typeof import('@core/coupons/coupons.gateway')>()),
		injectCouponListQuery: (query: () => unknown) => {
			h.listQuery = query;
			query();
			return { data: make(h.list) };
		},
	};
});

const t = (key: string, params?: object) => (params ? `${key}(${Object.values(params).join('|')})` : key);

const bare = <T>(type: Type<T>, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type);
};
const settle = async () => {
	for (let i = 0; i < 6; i++) await Promise.resolve();
};
const refused = { error: { issues: [{ code: 'x', message: 'Refused here' }] } };

function coupon(change: Partial<Coupon> = {}): Coupon {
	return {
		...blankCoupon(),
		id: 'cpn_1',
		code: 'WEDDING10',
		title: 'Wedding',
		enabled: true,
		revision: 2,
		usedCount: 0,
		...change,
	} as unknown as Coupon;
}

function builder(options: { id?: string | null; from?: string | null; loaded?: Coupon } = {}) {
	const gateway = {
		get: vi.fn(() => of(options.loaded ?? coupon())),
		save: vi.fn((_id: string | null, _body: unknown) => of(coupon())),
		tryIt: vi.fn(() => of({ used: [{ code: 'A' }, { code: 'B' }] })),
	};
	const orders = {
		searchCustomers: vi.fn(() => of([{ id: 'cus_2', name: 'Asha Roy' }])),
		searchBusinesses: vi.fn(() =>
			of([
				{ id: 'biz_1', tradeName: 'Roy Textiles', legalName: 'Roy Textiles LLP' },
				{ id: 'biz_2', tradeName: '', legalName: 'Kolkata Looms Pvt Ltd' },
			]),
		),
	};
	const products = {
		getCatalogProducts: vi.fn(() => of({ items: [{ id: 'p1', title: 'Silk', sku: 'S-1' }] })),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn(async () => true) };
	const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
	const id = options.id === undefined ? 'cpn_1' : options.id;
	const fixture = bare(CouponBuilder, [
		{
			provide: ActivatedRoute,
			useValue: {
				snapshot: {
					paramMap: { get: () => id },
					queryParamMap: { get: () => options.from ?? null },
				},
			},
		},
		{ provide: Router, useValue: router },
		{ provide: CouponsGateway, useValue: gateway },
		{ provide: OrdersGateway, useValue: orders },
		{ provide: ProductService, useValue: products },
		{ provide: NotificationService, useValue: notifier },
		{ provide: TranslocoService, useValue: { translate: t } },
		{ provide: QueryClient, useValue: queryClient },
	]);
	return { c: fixture.componentInstance, gateway, orders, products, notifier, router, queryClient };
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	h.categories = undefined;
	h.list = undefined;
});

describe('coupons in plain words (cp02, cp04)', () => {
	const words = (change: Partial<CouponWrite>, others?: { combining: string[]; alone: string[] }) =>
		couponWords({ ...blankCoupon(), ...change }, t, undefined, others);

	it('reads what it gives, where, for whom and how often', () => {
		expect(words({ kind: 'amountOff', value: 500 })[0]).toBe('cpn_words_amount(₹500)');
		expect(words({})[0]).toBe('cpn_words_percent(10)');
		expect(words({ scope: { kind: 'products', productIds: ['p1', 'p2'] }, includeSaleItems: true })[1]).toBe(
			'cpn_words_products(2)',
		);
		expect(
			words({
				scope: { kind: 'categories', categoryIds: ['cat_1'], includeSubcategories: false },
				includeSets: false,
			})[1],
		).toBe('cpn_words_categories(cat_1)cpn_words_not_salecpn_words_not_sets');
		const full = words({
			excludedProductIds: ['p9'],
			minOrderINR: 2_000,
			channels: { shop: true, admin: false },
			usesPerCustomer: null,
			usableOnZonePrices: true,
		});
		expect(full).toContain('cpn_words_excluded(1)');
		expect(full).toContain('cpn_words_min(₹2,000)');
		expect(full).toContain('cpn_words_audience_everyone, cpn_words_shop, cpn_words_unlimited');
		expect(full).toContain('cpn_words_zone');
		expect(words({ channels: { shop: false, admin: true }, usesPerCustomer: 3 })).toContain(
			'cpn_words_audience_everyone, cpn_words_admin, cpn_words_per_customer(3)',
		);
		expect(words({})).toContain(
			'cpn_words_audience_everyone, cpn_words_shopcpn_words_andcpn_words_admin, cpn_words_once_per_customer',
		);
	});

	it('names the coupons it combines with and the ones it can’t', () => {
		expect(words({ combines: true }, { combining: ['A'], alone: ['B'] })).toEqual(
			expect.arrayContaining(['cpn_words_can_with(A)', 'cpn_words_cant_with(B)']),
		);
		const onlyAlone = words({ combines: true }, { combining: [], alone: ['B'] });
		expect(onlyAlone).toContain('cpn_words_combines');
		expect(onlyAlone).toContain('cpn_words_cant_with(B)');
		expect(words({ combines: true }, { combining: ['A'], alone: [] })).not.toContain('cpn_words_cant_with()');
		expect(words({ combines: true }, { combining: [], alone: [] })).toContain('cpn_words_combines');
		expect(words({ combines: false }, { combining: ['A'], alone: [] })).toContain('cpn_words_alone');
		expect(words({ kind: 'freeDelivery', value: 0 })).not.toContain('cpn_words_never_delivery');
	});

	it('keeps only the coupon’s own fields', () => {
		const fields = couponFieldsOf(coupon());
		expect(fields).not.toHaveProperty('id');
		expect(fields).not.toHaveProperty('enabled');
		expect(fields.code).toBe('WEDDING10');
	});
});

describe('the coupons list rows (cp01)', () => {
	const row: CouponListRow = {
		id: 'cpn_1',
		code: 'FLAT500',
		title: 'Flat',
		kind: 'amountOff',
		value: 500,
		capINR: null,
		combines: false,
		enabled: false,
		usedCount: 1_200,
		totalUses: null,
		validFrom: '2026-11-01T00:00:00.000Z',
		validUntil: null,
		appliesTo: 'All',
		expired: false,
	};

	it('draws each kind, date span and status', () => {
		const drawn = toCouponRow(row, t);
		expect(drawn.gives).toBe('cpn_gives_amount(₹500)');
		expect(drawn.combines).toBe('cpn_no');
		expect(drawn.valid).toMatch(/ – …$/);
		expect(drawn).toMatchObject({ status: 0, statusLabel: 'cpn_off', statusClass: 'status-pending' });
		expect(
			toCouponRow({ ...row, kind: 'freeDelivery', validFrom: null, validUntil: '2026-12-01T00:00:00.000Z' }, t),
		).toMatchObject({ gives: 'cpn_gives_free_delivery' });
		expect(
			toCouponRow({ ...row, validFrom: null, validUntil: '2026-12-01T00:00:00.000Z' }, t).valid.startsWith(
				'… – ',
			),
		).toBe(true);
		expect(toCouponRow({ ...row, expired: true }, t).statusClass).toBe('status-failed');
		expect(toCouponRow({ ...row, enabled: true }, t).statusClass).toBe('status-success');
	});
});

describe('the coupon builder', () => {
	it('loads a coupon to edit, lists categories and names the switched-on coupons', async () => {
		h.categories = {
			data: [
				{ id: 1, name: 'Sarees', subcategories: [{ id: 2, name: 'Silk' }] },
				{ id: 3, name: 'Fabric' },
			],
		};
		h.list = {
			items: [
				{ id: 'cpn_1', code: 'SELF', combines: true, expired: false },
				{ id: 'cpn_2', code: 'STACK', combines: true, expired: false },
				{ id: 'cpn_3', code: 'SOLO', combines: false, expired: false },
				{ id: 'cpn_4', code: 'OLD', combines: true, expired: true },
			],
		};
		const { c, gateway } = builder({
			loaded: coupon({ scope: { kind: 'products', productIds: ['p1', 'p7'] }, excludedProductIds: ['p8'] }),
		});
		await settle();
		expect(h.listQuery?.()).toEqual({ filter: 'on', page: 1, pageSize: 100 });
		expect(gateway.get).toHaveBeenCalledWith('cpn_1');
		expect(c.saved()?.id).toBe('cpn_1');
		expect(c.draft().enabled).toBe(true);
		expect(c.categories().map((row) => row.label)).toEqual(['Sarees', '— Silk', 'Fabric']);
		expect(c.categoryOptions()).toHaveLength(3);
		expect(c.combiningCodes()).toEqual(['STACK']);
		expect(c.productOptions().map((row) => (row as { value: string }).value)).toEqual(['p1', 'p7', 'p8']);
		await vi.advanceTimersByTimeAsync(300);
		expect(c.productOptions()).toEqual([
			{ value: 'p7', label: 'p7' },
			{ value: 'p8', label: 'p8' },
			{ value: 'p1', label: 'Silk · S-1' },
		]);
		c.patch({
			combines: true,
			scope: { kind: 'categories', categoryIds: ['2', 'p1', 'zz'], includeSubcategories: true },
		});
		const words = c.words();
		expect(words[1]).toContain('Silk, Silk · S-1, zz');
		expect(words).toContain('cpn_words_can_with(STACK)');
		expect(words).toContain('cpn_words_cant_with(SOLO)');
	});

	it('opens a copy switched off with an empty code, a blank coupon, and a coupon it cannot load', async () => {
		const copy = builder({ id: null, from: 'cpn_1' });
		await settle();
		expect(copy.c.draft()).toMatchObject({ code: '', enabled: false });
		expect(copy.c.saved()).toBeNull();
		const blank = builder({ id: null });
		await settle();
		expect(blank.gateway.get).not.toHaveBeenCalled();
		expect(blank.c.combiningCodes()).toEqual([]);
		expect(blank.c.words()).toContain('cpn_words_alone');
		const off = builder({ loaded: coupon({ enabled: false }) });
		await settle();
		expect(off.c.draft().enabled).toBe(false);
	});

	it('reports a coupon it cannot load', async () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: ActivatedRoute,
					useValue: { snapshot: { paramMap: { get: () => 'cpn_1' }, queryParamMap: { get: () => null } } },
				},
				{ provide: Router, useValue: {} },
				{ provide: CouponsGateway, useValue: { get: () => throwError(() => refused) } },
				{ provide: OrdersGateway, useValue: {} },
				{ provide: ProductService, useValue: { getCatalogProducts: () => of({ items: [] }) } },
				{ provide: NotificationService, useValue: {} },
				{ provide: TranslocoService, useValue: { translate: t } },
				{ provide: QueryClient, useValue: {} },
			],
		});
		TestBed.overrideComponent(CouponBuilder, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(CouponBuilder).componentInstance;
		await settle();
		expect(c.error()).toBe('Refused here');
	});

	it('changes the kind, scope and audience, and reads numbers', async () => {
		const { c } = builder({ id: null });
		await settle();
		expect(c.money(1500)).toBe('₹1,500');
		expect(c.num('₹1,200')).toBe(1200);
		expect(c.num('12%')).toBe(12);
		expect(c.num('abc')).toBe(0);
		expect(c.optionalNum('  ')).toBeNull();
		expect(c.optionalNum('7')).toBe(7);
		c.setKind('freeDelivery');
		expect(c.draft()).toMatchObject({ kind: 'freeDelivery', value: 0, capINR: null });
		c.setKind('amountOff');
		expect(c.draft().value).toBe(500);
		c.setKind('percentOff');
		expect(c.draft().value).toBe(10);
		expect(c.scopeIds()).toEqual([]);
		c.setScopeIds({ value: ['x'] } as never);
		expect(c.draft().scope).toEqual({ kind: 'wholeOrder' });
		c.setScope('categories');
		c.setScopeIds({ value: ['1', 2] } as never);
		expect(c.scopeIds()).toEqual(['1', '2']);
		c.setScope('products');
		c.setScopeIds({ value: 'p1' } as never);
		expect(c.scopeIds()).toEqual([]);
		c.setScopeIds({ value: ['p1'] } as never);
		expect(c.scopeIds()).toEqual(['p1']);
		c.setScope('wholeOrder');
		expect(c.draft().scope).toEqual({ kind: 'wholeOrder' });
		expect(c.audienceIds()).toEqual([]);
		c.setAudienceIds({ value: ['x'] } as never);
		expect(c.draft().audience).toEqual({ kind: 'everyone' });
		c.setAudience('customers');
		c.setAudienceIds({ value: ['cus_1'] } as never);
		expect(c.audienceIds()).toEqual(['cus_1']);
		c.setAudience('businesses');
		c.setAudienceIds({ value: ['biz_1'] } as never);
		expect(c.audienceIds()).toEqual(['biz_1']);
		c.setAudience('firstOrder' as never);
		expect(c.draft().audience).toEqual({ kind: 'firstOrder' });
	});

	it('searches customers and businesses, keeping the chosen ones', async () => {
		const { c, orders } = builder({ id: null });
		await settle();
		await c.searchBuyers({ search: '   ' } as never);
		expect(orders.searchCustomers).not.toHaveBeenCalled();
		c.setAudience('customers');
		await c.searchBuyers({ search: 'asha' } as never);
		expect(c.buyerOptions()).toEqual([{ value: 'cus_2', label: 'Asha Roy' }]);
		c.setAudienceIds({ value: ['cus_2'] } as never);
		orders.searchCustomers.mockReturnValueOnce(
			of([
				{ id: 'cus_2', name: 'Asha Roy' },
				{ id: 'cus_3', name: 'Bina Das' },
			]),
		);
		await c.searchBuyers({ search: 'a' } as never);
		expect(c.buyerOptions()).toEqual([
			{ value: 'cus_2', label: 'Asha Roy' },
			{ value: 'cus_3', label: 'Bina Das' },
		]);
		c.setAudience('businesses');
		await c.searchBuyers({ search: 'roy' } as never);
		expect(c.buyerOptions()).toEqual([
			{ value: 'biz_1', label: 'Roy Textiles' },
			{ value: 'biz_2', label: 'Kolkata Looms Pvt Ltd' },
		]);
		c.searchProducts({ search: 'silk' } as never);
		await vi.advanceTimersByTimeAsync(300);
	});

	it('tries the coupon on a cart, with the coupons it combines with', async () => {
		h.list = { items: [{ id: 'cpn_2', code: 'STACK', combines: true, expired: false }] };
		const { c, gateway, notifier } = builder({ id: null });
		await vi.advanceTimersByTimeAsync(300);
		await c.tryIt();
		expect(gateway.tryIt).not.toHaveBeenCalled();
		c.addTryItem({ value: null } as never);
		c.addTryItem({ value: undefined } as never);
		c.addTryItem({ value: 'p1' } as never);
		c.addTryItem({ value: 'p1' } as never);
		c.addTryItem({ value: 'p_new' } as never);
		expect(c.tryItems().map((row) => row.label)).toEqual(['Silk · S-1', 'p_new']);
		expect(c.tryPieces()).toBe(2);
		c.removeTryItem('p_new');
		await c.tryIt();
		expect(gateway.tryIt).toHaveBeenLastCalledWith(
			expect.objectContaining({
				coupon: expect.objectContaining({ code: 'TRYIT' }),
				withCodes: [],
				deliveryINR: 0,
			}),
		);
		expect(c.usedCodes(c.tryResult() as never)).toBe('A + B');
		c.patch({ code: 'MINE', combines: true });
		await c.tryIt();
		expect(gateway.tryIt).toHaveBeenLastCalledWith(
			expect.objectContaining({ coupon: expect.objectContaining({ code: 'MINE' }), withCodes: ['STACK'] }),
		);
		gateway.tryIt.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.tryIt();
		expect(notifier.showError).toHaveBeenCalledWith('ord_action_failed');
		expect(c.trying()).toBe(false);
		for (let at = 0; at < 25; at++) c.addTryItem({ value: `x${at}` } as never);
		expect(c.tryItems()).toHaveLength(20);
	});

	it('saves a proper coupon, as a draft or switched on, and shows a refusal', async () => {
		const created = builder({ id: null });
		await settle();
		await created.c.save(true);
		expect(created.gateway.save).not.toHaveBeenCalled();
		created.c.patch({ code: 'NEW10', title: '  ' });
		expect(created.c.canSave()).toBe(false);
		created.c.patch({ title: 'New', channels: { shop: false, admin: false } });
		expect(created.c.canSave()).toBe(false);
		created.c.patch({ channels: { shop: false, admin: true } });
		expect(created.c.canSave()).toBe(true);
		created.c.saving.set(true);
		expect(created.c.canSave()).toBe(false);
		created.c.saving.set(false);
		await created.c.save(false);
		expect(created.gateway.save).toHaveBeenCalledWith(null, expect.objectContaining({ enabled: false }));
		expect(created.gateway.save.mock.calls[0]?.[1]).not.toHaveProperty('revision');
		expect(created.notifier.showSuccess).toHaveBeenCalledWith('cpn_saved_draft');
		expect(created.router.navigate).toHaveBeenCalledWith(['/coupon']);
		const edited = builder();
		await settle();
		await edited.c.save(true);
		expect(edited.gateway.save).toHaveBeenCalledWith(
			'cpn_1',
			expect.objectContaining({ enabled: true, revision: 2 }),
		);
		expect(edited.notifier.showSuccess).toHaveBeenCalledWith('cpn_saved_on');
		edited.gateway.save.mockReturnValueOnce(throwError(() => refused));
		await edited.c.save(true);
		expect(edited.c.error()).toBe('Refused here');
		expect(edited.c.saving()).toBe(false);
		expect(edited.c.toLocal(null)).toBe('');
		expect(edited.c.fromLocal('')).toBeNull();
	});
});

describe('the coupons list', () => {
	function list() {
		const gateway = {
			switch: vi.fn(() => of({})),
			bulkSwitch: vi.fn(() => of({ done: ['a'], refused: [] as Array<{ code: string }> })),
			bulkDelete: vi.fn(() => of({ done: ['a', 'b'], refused: [{ code: 'LIVE10' }] })),
		};
		const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
		const router = { navigate: vi.fn(async () => true) };
		const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
		const fixture = bare(CouponList, [
			{ provide: Router, useValue: router },
			{ provide: CouponsGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: QueryClient, useValue: queryClient },
		]);
		return { fixture, c: fixture.componentInstance, gateway, notifier, router, queryClient };
	}
	const row = { id: 'cpn_1', status: 1 } as never;

	it('fills the table from the page, counts each filter and pages the table', async () => {
		const empty = list();
		empty.fixture.detectChanges();
		expect(empty.c.counts()).toEqual({ all: 0, on: 0, off: 0, expired: 0 });
		expect(empty.c.tableConfig().total).toBe(0);
		h.list = {
			items: [
				{
					id: 'cpn_1',
					code: 'A',
					title: 'A',
					kind: 'percentOff',
					value: 5,
					capINR: null,
					combines: true,
					enabled: true,
					usedCount: 0,
					totalUses: 10,
					validFrom: null,
					validUntil: null,
					appliesTo: 'All',
					expired: false,
				},
			],
			total: 1,
			counts: { all: 1, on: 1, off: 0, expired: 0 },
		};
		const { fixture, c } = list();
		fixture.detectChanges();
		expect(c.tableConfig().data).toHaveLength(1);
		expect(c.tableConfig().total).toBe(1);
		expect(c.counts().on).toBe(1);
		c.onTableChange({ page: 2, paginate: 30 });
		expect(h.listQuery?.()).toMatchObject({ filter: 'all', page: 2 });
		c.setFilter('on');
		expect(h.listQuery?.()).toMatchObject({ filter: 'on', page: 1 });
		const tableData: Record<string, unknown> = { page: 4 };
		Object.defineProperty(c, 'table', { value: () => ({ tableData }) });
		c.setFilter('expired');
		expect(tableData['page']).toBe(1);
		c.onTableChange();
	});

	it('edits, copies, switches and acts on ticked coupons', async () => {
		const { c, gateway, notifier, router, queryClient } = list();
		c.onAction({ actionToPerform: 'edit', data: row } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/coupon/edit', 'cpn_1']);
		c.onAction({ actionToPerform: 'duplicate', data: row } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/coupon/create'], { queryParams: { from: 'cpn_1' } });
		c.onAction({ actionToPerform: 'edit' } as never);
		c.onAction({ actionToPerform: 'duplicate' } as never);
		c.onAction({ actionToPerform: 'status' } as never);
		c.onAction({ actionToPerform: 'status', data: row } as never);
		await settle();
		expect(gateway.switch).toHaveBeenCalledWith('cpn_1', true);
		expect(notifier.showSuccess).toHaveBeenCalledWith('cpn_switched_on');
		c.onAction({ actionToPerform: 'status', data: { id: 'cpn_1', status: 0 } } as never);
		await settle();
		expect(notifier.showSuccess).toHaveBeenCalledWith('cpn_switched_off');
		gateway.switch.mockReturnValueOnce(throwError(() => refused));
		c.onAction({ actionToPerform: 'status', data: row } as never);
		await settle();
		expect(notifier.showError).toHaveBeenCalledWith('Refused here');
		c.onAction({ actionToPerform: 'deleteAll', data: [] } as never);
		await settle();
		expect(gateway.bulkDelete).not.toHaveBeenCalled();
		c.onAction({ actionToPerform: 'deleteAll', data: ['a', 'b'] } as never);
		await settle();
		expect(gateway.bulkDelete).toHaveBeenCalledWith({ action: 'delete', ids: ['a', 'b'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('cpn_bulk_delete(2)');
		expect(notifier.showError).toHaveBeenCalledWith('cpn_bulk_refused(LIVE10)');
		c.onAction({ actionToPerform: 'bulk_on', data: ['a'] } as never);
		await settle();
		expect(gateway.bulkSwitch).toHaveBeenCalledWith({ action: 'turnOn', ids: ['a'] });
		c.onAction({ actionToPerform: 'bulk_off', data: ['a'] } as never);
		await settle();
		expect(gateway.bulkSwitch).toHaveBeenLastCalledWith({ action: 'turnOff', ids: ['a'] });
		gateway.bulkSwitch.mockReturnValueOnce(throwError(() => refused));
		c.onAction({ actionToPerform: 'bulk_on', data: ['a'] } as never);
		await settle();
		c.onAction({ actionToPerform: 'nothing' } as never);
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
	});
});
