import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderDraftStore } from '@core/orders/order-draft.store';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { LoaderStore } from '@core/state/loader.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CreateOrder } from './create-order';
import { buyerLabel } from './order-buyer-card';
import { stockWords } from './order-product-card';

import type { AdminCartView, AdminProductCard } from '@saha-textile/contracts';

const cart = signal<AdminCartView | undefined>(undefined);
const cardQueries: Array<() => Record<string, unknown>> = [];

vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: signal(undefined) }),
}));
vi.mock('@core/orders/orders.gateway', async (original) => ({
	...(await original<typeof import('@core/orders/orders.gateway')>()),
	injectAdminCardsQuery: (query: () => Record<string, unknown>) => {
		cardQueries.push(query);
		return { data: signal(undefined), isPending: () => false };
	},
	injectAdminCartQuery: (body: () => unknown) => (body(), { data: cart, isFetching: () => false }),
}));

const card = (over: Partial<AdminProductCard> = {}): AdminProductCard => ({
	productId: 'p1',
	title: 'Blush Pink Georgette Saree',
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

function render(chosen: unknown = null, addTo: string | null = null, gateway: Record<string, unknown> = {}) {
	const modal = {
		open: vi.fn(() => ({
			componentInstance: { start: vi.fn(async () => undefined) },
			result: chosen ? Promise.resolve(chosen) : Promise.reject(new Error('dismissed')),
		})),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: LoaderStore, useValue: { status: () => false } },
			{ provide: NgbModal, useValue: modal },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { queryParamMap: convertToParamMap(addTo ? { addTo } : {}) } },
			},
			{ provide: Router, useValue: router },
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	TestBed.overrideComponent(CreateOrder, { set: { imports: [], template: '' } });
	const draft = TestBed.inject(OrderDraftStore);
	if (!addTo) draft.clear();
	const fixture = TestBed.createComponent(CreateOrder);
	fixture.detectChanges();
	return { page: fixture.componentInstance, draft, modal };
}
const router = { navigate: vi.fn(async () => true) };
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };

afterEach(() => {
	cart.set(undefined);
	cardQueries.length = 0;
	sessionStorage.clear();
});

describe('Create order (oc01–oc03)', () => {
	it('asks for cards priced for the buyer and currency, by search and category', () => {
		const { page, draft } = render();
		const query = () => cardQueries.at(-1)?.() ?? {};
		expect(query()).toEqual({ page: 1, pageSize: 24, currency: 'INR' });
		draft.setBuyer({
			kind: 'business',
			business: { id: 'biz_1', legalName: 'Bose Textiles Pvt Ltd', tradeName: 'Bose Boutique' } as never,
		});
		draft.setCurrency('USD');
		page.search.set('jamdani');
		page.selectCategoryItem(['7']);
		expect(query()).toMatchObject({ currency: 'USD', businessId: 'biz_1', q: 'jamdani', categoryId: '7', page: 1 });
	});

	it('adds a plain piece at once, fabric by its shortest cut, and a product with variants through the picker', async () => {
		const { page, draft, modal } = render({ variationId: 'v_red' });
		await page.add(card());
		await page.add(card());
		await page.add(card({ productId: 'cloth', soldBy: 'metre', shortestCutTenths: 15 }));
		await page.add(card({ productId: 'p2', hasVariants: true }));
		expect(modal.open).toHaveBeenCalledTimes(1);
		expect(draft.lines().map((line) => [line.productId, line.variationId, line.quantity])).toEqual([
			['p1', null, 2],
			['cloth', null, 15],
			['p2', 'v_red', 1],
		]);
		expect(page.quantityWords(page.rows()[1] as never)).toBe('ord_metres');
	});

	it('goes to checkout only with a buyer and every line sellable', () => {
		const { page, draft } = render();
		draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
		cart.set({
			currency: 'INR',
			markupPercent: 0,
			subtotal: 6_800,
			subtotalINR: 6_800,
			lines: [{ problem: null, lineTotal: 6_800 } as never],
		});
		expect(page.canCheckout()).toBe(false);
		draft.setBuyer({ kind: 'person', customer: { id: 'cus_1', name: 'Kavita Iyer' } as never });
		expect(page.canCheckout()).toBe(true);
		cart.set({ ...(cart() as AdminCartView), lines: [{ problem: 'noZonePrice', lineTotal: 0 } as never] });
		expect(page.canCheckout()).toBe(false);
		page.change(page.rows()[0] as never, -1);
		expect(draft.count()).toBe(0);
	});
});

describe('order draft and card words', () => {
	it('keeps the draft for the tab and clears the buyer when switching between customer and business', () => {
		const { draft } = render();
		draft.setBuyer({ kind: 'person', customer: { id: 'cus_1', name: 'Kavita Iyer' } as never });
		draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
		expect(JSON.parse(sessionStorage.getItem('st_admin_order_draft') ?? '{}')).toMatchObject({
			buyer: { kind: 'person' },
			lines: [{ productId: 'p1' }],
		});
		expect(draft.cartWrite()).toEqual({
			buyer: { kind: 'person', customerId: 'cus_1' },
			currency: 'INR',
			lines: [{ productId: 'p1', variationId: null, quantity: 1, addons: [] }],
		});
		draft.setBuyerKind('business');
		expect(draft.buyer()).toBeNull();
	});

	it('names buyers and stock the way the brief draws them', () => {
		const t = (key: string) => key;
		expect(
			buyerLabel({
				kind: 'business',
				business: {
					legalName: 'Bose Textiles Pvt Ltd',
					tradeName: 'Bose Boutique',
					gstin: '19AABCB1234F1Z5',
					phone: null,
				} as never,
			}),
		).toBe('Bose Boutique (Bose Textiles Pvt Ltd) · GSTIN 19AABCB1234F1Z5');
		expect(
			buyerLabel({
				kind: 'person',
				customer: { name: 'Kavita Iyer', email: 'kavita@example.test', phone: '+91 98311 22334' } as never,
			}),
		).toBe('Kavita Iyer · kavita@example.test · +91 98311 22334');
		expect(stockWords({ stock: 1, soldBy: 'piece' }, t)).toBe('ord_card_one_left');
		expect(stockWords({ stock: 25, soldBy: 'metre' }, t)).toBe('ord_card_metres');
		expect(stockWords({ stock: null, soldBy: 'piece' }, t)).toBe('');
	});
});

describe('Add pieces to an open order (oo02)', () => {
	it('fixes the buyer to the open order, then adds the cart to it and goes back to the order', async () => {
		const customer = { id: 'cus_1', name: 'Nandita Ghosh', email: 'n@example.test', phone: null };
		const order = {
			id: 'ord_9',
			orderNumber: 'ST-2609-102003',
			status: 'open',
			revision: 7,
			buyer: { kind: 'person', customerId: 'cus_1', name: 'Nandita Ghosh', email: 'n@example.test' },
		};
		const addOpenLines = vi.fn(() => of({}));
		const { page, draft } = render(null, 'ord_9', {
			detail: vi.fn(() => of({ order })),
			searchCustomers: vi.fn(() => of([customer])),
			addOpenLines,
		});
		await vi.waitFor(() =>
			expect(draft.addingTo()).toMatchObject({ orderId: 'ord_9', buyerName: 'Nandita Ghosh' }),
		);
		expect(draft.buyer()).toMatchObject({ kind: 'person', customer: { id: 'cus_1' } });
		draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
		cart.set({ lines: [{ problem: null }] } as never);
		await page.addToOrder();
		expect(addOpenLines).toHaveBeenCalledWith('ord_9', {
			lines: [{ productId: 'p1', variationId: null, quantity: 1, addons: [] }],
			revision: 7,
		});
		expect(router.navigate).toHaveBeenCalledWith(['/order/details', 'ord_9']);
		expect(draft.addingTo()).toBeNull();
	});
});
