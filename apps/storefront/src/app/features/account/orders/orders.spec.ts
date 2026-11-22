import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { OrderCard } from './order-card/order-card';
import { orderItemsText, orderMoney, orderPill, orderThumbs } from './order-money';
import { Orders } from './orders';

import type { ShopOrderSummary } from '@saha-textile/contracts';

const data = signal<unknown>(undefined);
let asked = 0;
vi.mock('@data-access/queries/order.queries', () => ({
	injectMyOrdersQuery: (page: () => number) => ({ data: () => ((asked = page()), data()) }),
}));

const summary = (over: Partial<ShopOrderSummary>): ShopOrderSummary => ({
	orderNumber: 'ST-2611-482190',
	placedAt: '2026-11-22T05:10:00.000Z',
	status: 'processing',
	currency: 'INR',
	total: 126475,
	sets: 0,
	products: 1,
	pieces: 1,
	freeItems: 0,
	firstTitle: 'Peacock Blue saree',
	firstImageUrl: null,
	thumbs: [],
	statusAt: null,
	...over,
});
const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`;

describe('My orders (bundle builder brief E06)', () => {
	it('names what each order holds', () => {
		expect(orderItemsText(summary({ sets: 2, products: 3, pieces: 12 }), t)).toBe(
			'my_orders_sets{"count":2}, my_orders_products{"count":3} · my_orders_pieces{"count":12}',
		);
		expect(orderItemsText(summary({ sets: 1, products: 0, pieces: 2, firstTitle: 'Pair' }), t)).toBe(
			'Pair · my_orders_pieces{"count":2}',
		);
		expect(orderItemsText(summary({ freeItems: 1 }), t)).toBe(
			'Peacock Blue saree my_orders_plus_free_one{"count":1}',
		);
		expect(orderItemsText(summary({}), t)).toBe('Peacock Blue saree');
	});

	it('writes money in the currency paid, and picks the status pill', () => {
		expect(orderMoney(126475, 'INR')).toBe('₹ 1,26,475.00');
		expect(orderMoney(412.5, 'GBP')).toBe('£412.50');
		expect(['placed', 'packed', 'delivered', 'cancelled'].map((s) => orderPill(s as never))).toEqual([
			'pending',
			'processing',
			'delivered',
			'cancelled',
		]);
	});

	it('fans out the order’s own pictures, or the first line’s on an older answer', () => {
		expect(orderThumbs(summary({ thumbs: ['a.jpg', 'b.jpg'], firstImageUrl: 'a.jpg' }))).toEqual([
			'a.jpg',
			'b.jpg',
		]);
		expect(orderThumbs(summary({ firstImageUrl: 'a.jpg' }))).toEqual(['a.jpg']);
		expect(orderThumbs(summary({}))).toEqual([]);
	});

	it('a phone card counts what lies beyond the first line and its pictures, and says "on" once settled', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(OrderCard, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(OrderCard);
		fixture.componentRef.setInput('order', summary({ sets: 2, products: 3, thumbs: ['a', 'b', 'c', 'd'] }));
		const card = fixture.componentInstance;
		expect([card.more(), card.morePictures(), card.settled()]).toEqual([4, 1, false]);
		fixture.componentRef.setInput('order', summary({ status: 'delivered' }));
		expect([card.more(), card.morePictures(), card.settled()]).toEqual([0, 1, true]);
	});

	it('reads a page of orders and moves between pages', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: TranslocoService, useValue: { translate: t } }] });
		TestBed.overrideComponent(Orders, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Orders).componentInstance;
		data.set({ items: [summary({})], total: 1, page: 1, pageSize: 10 });
		expect(page.orders()).toHaveLength(1);
		page.setPaginate(2);
		page.result();
		expect(asked).toBe(2);
	});
});
