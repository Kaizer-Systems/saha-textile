import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CouponsGateway } from '@core/coupons/coupons.gateway';
import { OrderDraftStore } from '@core/orders/order-draft.store';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { LoaderStore } from '@core/state/loader.store';
import { NotificationService } from '@data-access/services/notification.service';
import { OrderCouponPopup } from '@features/order/checkout/order-coupon-popup';

import { CreateOrder } from './create-order';
import { OrderBuyerCard, buyerLabel } from './order-buyer-card';
import { OrderProductCard } from './order-product-card';
import { OrderVariantPopup } from './order-variant-popup';

import type { AdminProductCard } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ currencies: undefined as unknown, fetching: false }));
const cart = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		injectCategoriesQuery: (params: () => unknown) => {
			params();
			return { data: make(undefined) };
		},
	};
});
vi.mock('@core/orders/orders.gateway', async (original) => ({
	...(await original<typeof import('@core/orders/orders.gateway')>()),
	injectAdminCardsQuery: (query: () => unknown) => {
		query();
		return { data: () => undefined, isPending: () => false };
	},
	injectAdminCartQuery: (body: () => unknown) => {
		body();
		return { data: cart, isFetching: () => h.fetching };
	},
	injectOrderCurrenciesQuery: () => ({ data: () => h.currencies }),
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const card = (over: Partial<AdminProductCard> = {}): AdminProductCard => ({
	productId: 'p1',
	title: 'Silk saree',
	imageUrl: null,
	categoryIds: [],
	hasVariants: false,
	soldBy: 'piece',
	shortestCutTenths: null,
	stock: 4,
	retailINR: 6_800,
	isBundle: false,
	setsPossible: 0,
	price: 6_800,
	zonePrice: null,
	...over,
});

const gateway = {
	searchCustomers: vi.fn((_q: string) => of([{ id: 'cus_1', name: 'Asha Roy', email: 'a@x.test', phone: null }])),
	searchBusinesses: vi.fn((_q: string) =>
		of([{ id: 'biz_1', legalName: 'Roy Textiles LLP', tradeName: 'Roy Textiles', gstin: '19AAAA', phone: null }]),
	),
	variantChoices: vi.fn((_id: string, _query: unknown) => of({ soldBy: 'piece', rows: [] })),
	detail: vi.fn((_id: string) =>
		of({ order: { id: 'ord_9', status: 'open', revision: 3, orderNumber: 'ST-9', buyer: null } }),
	),
	addOpenLines: vi.fn(() => of({})),
};
const coupons = { checkoutOptions: vi.fn(() => of([{ code: 'A' }])) };
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
const router = { navigate: vi.fn(async () => true) };
const activeModal = { close: vi.fn() };
let answer: unknown = null;
const modals = {
	open: vi.fn(() => {
		const result = answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		result.catch(() => undefined);
		return { componentInstance: { start: vi.fn(async () => undefined) }, result };
	}),
};

function make<T>(type: Type<T>, options: { addTo?: string; lang?: string } = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: CouponsGateway, useValue: coupons },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: activeModal },
			{ provide: LoaderStore, useValue: { status: () => false } },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => options.lang ?? 'en' } },
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: { queryParamMap: convertToParamMap(options.addTo ? { addTo: options.addTo } : {}) },
				},
			},
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const draft = TestBed.inject(OrderDraftStore);
	if (!options.addTo) draft.clear();
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture, draft };
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
	answer = null;
});
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	cart.set(undefined);
	h.currencies = undefined;
	h.fetching = false;
	sessionStorage.clear();
});

describe('Order for: the buyer card (oc01–oc03)', () => {
	it('names buyers the way the brief draws them', () => {
		expect(
			buyerLabel({ kind: 'person', customer: { id: 'c', name: 'Asha', email: null, phone: '98300' } } as never),
		).toBe('Asha · 98300');
		expect(
			buyerLabel({
				kind: 'business',
				business: { id: 'b', legalName: 'Roy LLP', tradeName: 'Roy', gstin: null, phone: null },
			} as never),
		).toBe('Roy (Roy LLP)');
		expect(
			buyerLabel({
				kind: 'business',
				business: { id: 'b', legalName: 'Roy LLP', tradeName: 'Roy LLP', gstin: '19AA', phone: '033' },
			} as never),
		).toBe('Roy LLP · GSTIN 19AA · 033');
	});

	it('searches as staff type, picks a buyer, and keeps the current one listed', async () => {
		vi.useFakeTimers();
		const { c, draft } = make(OrderBuyerCard);
		c.search({ search: '  ' } as never);
		c.search({ search: 'asha' } as never);
		c.search({ search: 'asha r' } as never);
		await vi.advanceTimersByTimeAsync(350);
		expect(gateway.searchCustomers).toHaveBeenCalledTimes(1);
		expect(c.options()).toHaveLength(1);
		c.pick({ value: 'nobody' } as never);
		expect(draft.buyer()).toBeNull();
		c.pick({ value: 'cus_1' } as never);
		expect(draft.buyer()).toMatchObject({ kind: 'person', customer: { id: 'cus_1' } });
		expect(c.selected()).toBe('cus_1');
		expect(c.options()).toHaveLength(1);
		c.pick({ value: 'cus_1' } as never);
		c.pick({ value: null } as never);
		expect(draft.buyer()).toBeNull();
		expect(c.selected()).toBeNull();
		c.setKind('business');
		c.search({ search: 'roy' } as never);
		await vi.advanceTimersByTimeAsync(350);
		c.pick({ value: 'biz_1' } as never);
		expect(c.business()?.id).toBe('biz_1');
		gateway.searchBusinesses.mockReturnValueOnce(throwError(() => new Error('down')));
		c.search({ search: 'gone' } as never);
		await vi.advanceTimersByTimeAsync(350);
		expect(c.options()).toHaveLength(1);
		c.search({ search: '' } as never);
		c.clear();
		expect(draft.buyer()).toBeNull();
		expect(c.business()).toBeNull();
	});

	it('drops a slower answer when a newer search has been asked', async () => {
		vi.useFakeTimers();
		const { c } = make(OrderBuyerCard);
		let release: (rows: unknown[]) => void = () => undefined;
		gateway.searchCustomers.mockReturnValueOnce(
			new (await import('rxjs')).Observable((subscriber) => {
				release = (rows) => {
					subscriber.next(rows);
					subscriber.complete();
				};
			}) as never,
		);
		c.search({ search: 'slow' } as never);
		await vi.advanceTimersByTimeAsync(350);
		gateway.searchCustomers.mockReturnValueOnce(throwError(() => new Error('down')));
		c.search({ search: 'fast' } as never);
		await vi.advanceTimersByTimeAsync(350);
		release([{ id: 'cus_slow', name: 'Slow' }]);
		await settle();
		expect(c.options()).toEqual([]);
		gateway.searchCustomers.mockReturnValueOnce(
			new (await import('rxjs')).Observable((subscriber) => {
				release = () => subscriber.error(new Error('late'));
			}) as never,
		);
		c.search({ search: 'late' } as never);
		await vi.advanceTimersByTimeAsync(350);
		c.search({ search: 'later' } as never);
		await vi.advanceTimersByTimeAsync(350);
		release([]);
		await settle();
	});

	it('lists the enabled currencies with rupees first, and says what a foreign cart is priced at', async () => {
		h.currencies = [
			{ code: 'USD', enabled: true, symbol: 'US$', rateFromINR: 0.012 },
			{ code: 'INR', enabled: true, symbol: '₹', rateFromINR: 1 },
			{ code: 'EUR', enabled: false, symbol: '€', rateFromINR: 0.011 },
			{ code: 'GBP', enabled: true, symbol: '£', rateFromINR: 0.0095 },
		];
		const { c, draft } = make(OrderBuyerCard);
		expect(c.currencyRows().map((row) => row.code)).toEqual(['INR', 'GBP', 'USD']);
		expect(c.rateNote()).toBeNull();
		draft.setCurrency('GBP');
		expect(c.rateNote()).toEqual({ symbol: '£', perUnit: 105.26 });
		draft.setCurrency('EUR');
		expect(c.rateNote()).toBeNull();
		expect(c.currencyName('USD')).toBe('US Dollar');
		const openModal = vi.fn(async () => undefined);
		Object.defineProperty(c, 'addCustomer', { value: () => ({ openModal }) });
		await c.newCustomer();
		expect(openModal).toHaveBeenCalled();
		Object.defineProperty(c, 'addCustomer', { value: () => undefined });
		await c.newCustomer();
		h.currencies = undefined;
		expect(make(OrderBuyerCard).c.currencyRows()).toEqual([]);
	});
});

describe('Create order: cards, variants and coupons (oc02, cp06)', () => {
	it('draws a card’s price and stock', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => 'bn' } }],
		});
		TestBed.overrideComponent(OrderProductCard, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(OrderProductCard);
		const set = (value: AdminProductCard) => fixture.componentRef.setInput('card', value);
		set(card({ price: null }));
		expect(fixture.componentInstance.noPrice()).toBe(true);
		expect(fixture.componentInstance.price()).toContain('₹0');
		set(card({ soldBy: 'metre', stock: 0 }));
		expect(fixture.componentInstance.soldOut()).toBe(true);
		expect(fixture.componentInstance.price()).toContain('ord_per_metre');
		set(card({ isBundle: true, setsPossible: 3 }));
		expect(fixture.componentInstance.stock()).toBe('ord_card_sets_possible(3)');
		set(card({ isBundle: true, setsPossible: undefined } as never));
		expect(fixture.componentInstance.stock()).toBe('ord_card_sets_possible(0)');
		set(card({ hasVariants: true, stock: 0 }));
		expect(fixture.componentInstance.soldOut()).toBe(false);
		expect(fixture.componentInstance.stock()).toBe('ord_card_choose_variant');
		set(card());
		expect(fixture.componentInstance.stock()).toBeTypeOf('string');
	});

	it('loads a product’s variants for the buyer, and says when it cannot', async () => {
		const { c } = make(OrderVariantPopup);
		await c.start(card(), 'GBP', 'biz_1');
		expect(gateway.variantChoices).toHaveBeenCalledWith('p1', { currency: 'GBP', businessId: 'biz_1' });
		await c.start(card(), 'INR', null);
		expect(gateway.variantChoices).toHaveBeenLastCalledWith('p1', { currency: 'INR' });
		expect(c.stock({ stock: 2 } as never, { soldBy: 'piece' } as never)).toBeTypeOf('string');
		expect(c.price({ price: null } as never)).toContain('0');
		expect(c.price({ price: 500 } as never)).toContain('500');
		gateway.variantChoices.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.start(card(), 'INR', null);
		expect(c.error()).toBe('ord_action_failed');
		const bengali = make(OrderVariantPopup, { lang: 'bn' });
		expect(bengali.c.price({ price: 1 } as never)).toContain('₹1');
	});

	it('lists the usable coupons for this order, and closes with a typed code', async () => {
		const { c } = make(OrderCouponPopup);
		await c.start({} as never);
		expect(c.options()).toEqual([{ code: 'A' }]);
		coupons.checkoutOptions.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.start({} as never);
		expect(c.error()).toBe('ord_action_failed');
		expect(c.money(1500)).toBe('₹1,500');
		c.choose('  ');
		expect(activeModal.close).not.toHaveBeenCalled();
		c.choose(' diwali ');
		expect(activeModal.close).toHaveBeenCalledWith('DIWALI');
	});
});

describe('Create order: the cart (oc01–oc04, oo02)', () => {
	it('adds sets through Configure, variants through the picker, and fabric by its cut', async () => {
		const { c, draft } = make(CreateOrder);
		answer = { levels: [] };
		await c.add(card({ isBundle: true }));
		expect(draft.count()).toBe(1);
		answer = null;
		await c.add(card({ isBundle: true, productId: 'p2' }));
		expect(draft.count()).toBe(1);
		await c.add(card({ productId: 'p3', soldBy: 'metre', shortestCutTenths: null }));
		expect(draft.lines().at(-1)?.quantity).toBe(10);
		answer = new Error('closed');
		await c.add(card({ productId: 'p4', hasVariants: true }));
		answer = { variationId: 'v1' };
		await c.add(card({ productId: 'p4', hasVariants: true, soldBy: 'metre', shortestCutTenths: 25 }));
		expect(draft.lines().at(-1)).toMatchObject({ variationId: 'v1', quantity: 25 });
		const key = draft.lines().at(-1)?.key as string;
		c.change({ key } as never, 1);
		expect(c.quantityWords({ soldBy: 'metre', quantity: 35 } as never)).toBe('ord_metres(3.5)');
		expect(c.quantityWords({ soldBy: 'piece', quantity: 2 } as never)).toBe('2');
		expect(c.subtotal()).toContain('0');
		cart.set({ subtotal: 9_000, lines: [] });
		expect(c.subtotal()).toContain('9,000');
		expect(c.rows().every((row) => row.priced === null)).toBe(true);
		expect(c.rupees(100)).toBe('₹100');
		expect(c.kids({ children: [] } as never)).toEqual([]);
	});

	it('filters by category, pages, and blocks checkout on unsellable lines or a quote on its way', () => {
		const { c, draft } = make(CreateOrder);
		c.selectCategory({ id: 'cat_1' } as never);
		expect(c.categoryId()).toBe('cat_1');
		c.selectCategory({ id: 'cat_1' } as never);
		expect(c.categoryId()).toBeNull();
		c.selectCategoryItem(['cat_2', 'cat_3']);
		expect(c.categoryId()).toBe('cat_2');
		c.selectCategoryItem([]);
		expect(c.categoryId()).toBeNull();
		c.setPaginate(3);
		expect(c.page()).toBe(3);
		draft.setBuyer({ kind: 'person', customer: { id: 'cus_1', name: 'Asha' } } as never);
		draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
		cart.set({ subtotal: 1, lines: [{ problem: 'noZonePrice' }] });
		expect(c.canCheckout()).toBe(false);
		cart.set({ subtotal: 1, lines: [{ problem: null }] });
		expect(c.canCheckout()).toBe(true);
		h.fetching = true;
		cart.set({ subtotal: 1, lines: [{ problem: null }, { problem: null }] });
		expect(c.canCheckout()).toBe(false);
		c.stopAdding();
		expect(draft.count()).toBe(0);
	});

	it('fixes a business buyer to an open order, and stops when the order or buyer is not there', async () => {
		const order = (over: Record<string, unknown>) =>
			of({ order: { id: 'ord_9', orderNumber: 'ST-9', status: 'open', revision: 3, ...over } });
		gateway.detail.mockReturnValueOnce(
			order({ buyer: { kind: 'business', businessId: 'biz_1', gstin: null, name: 'Roy Textiles LLP' } }) as never,
		);
		const fixed = make(CreateOrder, { addTo: 'ord_9' });
		await settle();
		expect(gateway.searchBusinesses).toHaveBeenCalledWith('Roy Textiles LLP');
		expect(fixed.draft.buyer()).toMatchObject({ kind: 'business' });
		fixed.draft.clear();
		gateway.detail.mockReturnValueOnce(
			order({ buyer: { kind: 'business', businessId: 'biz_gone', gstin: '19AA', name: 'X' } }) as never,
		);
		const gone = make(CreateOrder, { addTo: 'ord_9' });
		await settle();
		expect(gone.draft.addingTo()).toBeNull();
		gateway.detail.mockReturnValueOnce(
			order({ buyer: { kind: 'person', customerId: 'cus_gone', email: null, name: 'Ghost' } }) as never,
		);
		make(CreateOrder, { addTo: 'ord_9' });
		await settle();
		expect(gateway.searchCustomers).toHaveBeenCalledWith('Ghost');
		gateway.detail.mockReturnValueOnce(order({ status: 'paid', buyer: { kind: 'person' } }) as never);
		make(CreateOrder, { addTo: 'ord_9' });
		await settle();
		gateway.detail.mockReturnValueOnce(order({ buyer: null }) as never);
		make(CreateOrder, { addTo: 'ord_9' });
		await settle();
		gateway.detail.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		make(CreateOrder, { addTo: 'ord_9' });
		await settle();
		expect(notifier.showError).toHaveBeenCalledWith('ord_action_failed');
	});

	it('adds the cart to the open order only when it can, and shows a refusal', async () => {
		const { c, draft } = make(CreateOrder);
		await c.addToOrder();
		expect(gateway.addOpenLines).not.toHaveBeenCalled();
		draft.startAddingTo({ orderId: 'ord_9', orderNumber: 'ST-9', buyerName: 'Asha' }, {
			kind: 'person',
			customer: { id: 'cus_1', name: 'Asha' },
		} as never);
		await c.addToOrder();
		draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
		cart.set({ subtotal: 1, lines: [{ problem: null }] });
		gateway.addOpenLines.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.addToOrder();
		expect(notifier.showError).toHaveBeenCalledWith('ord_action_failed');
		expect(c.addingBusy()).toBe(false);
	});
});
