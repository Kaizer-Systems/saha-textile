import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderDetails } from './details';

const order = signal<unknown>(undefined);
const statuses = signal<unknown>(undefined);
vi.mock('@data-access/queries/order.queries', () => ({
	injectOrderByNumberQuery: (number: () => unknown) => {
		number();
		return { data: order };
	},
}));
vi.mock('@data-access/queries/order-status.queries', () => ({
	injectOrderStatusQuery: (params: () => unknown) => {
		params();
		return { data: statuses };
	},
}));

const render = () => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject({ id: '1000' }) } }],
	});
	TestBed.overrideComponent(OrderDetails, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(OrderDetails).componentInstance;
	TestBed.tick();
	return page;
};

afterEach(() => {
	order.set(undefined);
	statuses.set(undefined);
});

describe('OrderDetails', () => {
	it('shows nothing until the order arrives, then keeps it', () => {
		const page = render();
		expect(page.order).toBeUndefined();
		order.set({ order_number: 1000 });
		TestBed.tick();
		expect(page.order).toEqual({ order_number: 1000 });
		order.set(undefined);
		TestBed.tick();
		expect(page.order).toEqual({ order_number: 1000 });
	});

	it('exposes the status list', async () => {
		const page = render();
		statuses.set({ data: [] });
		TestBed.tick();
		expect(await firstValueFrom(page.orderStatus$)).toEqual({ data: [] });
	});
});
