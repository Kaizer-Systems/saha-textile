import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrderDetails } from './details/details';
import { orderSaved } from './order-lines/order-line-groups';
import { OrderLines } from './order-lines/order-lines';
import { orderItemsText, orderMoney, orderPill } from './order-money';
import { Orders } from './orders';

import type { ShopOrderSummary } from '@saha-textile/contracts';

const one = signal<unknown>(undefined);
const failed = signal(false);
const list = signal<unknown>(undefined);
vi.mock('@data-access/queries/order.queries', () => ({
	injectMyOrderQuery: () => ({ data: one, isError: failed }),
	injectMyOrdersQuery: () => ({ data: list }),
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}(${params['count']})` : key);
const summary = (over: Partial<ShopOrderSummary>) =>
	({ sets: 0, products: 0, pieces: 1, freeItems: 0, firstTitle: 'Saree', ...over }) as ShopOrderSummary;

describe('order words and money, the remaining cases', () => {
	it('shows a processing order as in progress', () => {
		expect(orderPill('processing')).toBe('processing');
	});

	it('writes a currency the browser cannot format by its code', () => {
		expect(orderMoney(12.5, 'NOT-A-CODE')).toBe('NOT-A-CODE 12.50');
	});

	it('names one product with one free item, and counts sets and products in each number', () => {
		expect(orderItemsText(summary({ products: 1, freeItems: 1 }), t)).toBe('Saree my_orders_plus_free_one(1)');
		expect(orderItemsText(summary({ products: 1, freeItems: 2 }), t)).toBe('Saree my_orders_plus_free(2)');
		expect(orderItemsText(summary({ sets: 1, products: 1, pieces: 4 }), t)).toBe(
			'my_orders_sets_one(1), my_orders_products_one(1) · my_orders_pieces(4)',
		);
		expect(orderItemsText(summary({ sets: 2, pieces: 6 }), t)).toBe('my_orders_sets(2) · my_orders_pieces(6)');
		expect(orderItemsText(summary({ products: 3, pieces: 3 }), t)).toBe(
			'my_orders_products(3) · my_orders_pieces(3)',
		);
	});

	it('counts a free item without a printed price as nothing saved', () => {
		expect(orderSaved({ coupon: 0, lines: [{ role: 'free', mrp: null, quantity: 1 }] } as never)).toBe(0);
	});
});

describe('order pages before their data arrives', () => {
	const make = <T>(type: Type<T>, providers: unknown[] = []) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: providers as never[] });
		TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
		return TestBed.createComponent(type);
	};

	it('one order: nothing reached past Placed, no tree, nothing saved, no items', () => {
		one.set(undefined);
		const page = make(OrderDetails, [
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject({ id: 'ST-1' }) } },
		]).componentInstance;
		expect(page.reached('placed')).toBe(true);
		expect(page.reached('shipped')).toBe(false);
		expect(page.hasTree()).toBe(false);
		expect(page.saved()).toBe(0);
		expect(page.itemCount()).toBe(0);
		const line = { lineId: 'a', parentLineId: 'p', role: 'piece' } as never;
		expect(page.pieceNumber(line)).toBe(0);
		expect(page.childCounts(line)).toEqual({ pieces: 0, extras: 0, free: 0 });
		expect(page.missing()).toBe(false);
		failed.set(true);
		expect(page.missing()).toBe(true);
	});

	it('the list: no orders yet, and each order’s items in the page language', () => {
		list.set(undefined);
		const page = make(Orders, [{ provide: TranslocoService, useValue: { translate: t } }]).componentInstance;
		expect(page.orders()).toEqual([]);
		expect(page.items(summary({ products: 1 }))).toBe('Saree');
	});

	it('the order’s lines as cards, grouped under their set', () => {
		const fixture = make(OrderLines);
		fixture.componentRef.setInput('order', { lines: [] });
		expect(fixture.componentInstance.groups()).toEqual([]);
		expect(fixture.componentInstance.money(10, 'INR')).toBe('₹ 10.00');
	});
});
