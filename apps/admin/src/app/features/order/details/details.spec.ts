import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderService } from '@data-access/services/order.service';

import { Details } from './details';

const statuses = signal<unknown>(undefined);
vi.mock('@data-access/queries/order-status.queries', () => ({
	injectOrderStatusQuery: (p: () => unknown) => (p(), { data: statuses }),
}));

const render = (params: Record<string, unknown>, platform = 'browser') => {
	const orders = { getOrders: vi.fn(() => of({ data: [{ order_number: 7 }, { order_number: 8 }] })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrderService, useValue: orders },
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(params) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Details, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Details);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, orders };
};

afterEach(() => statuses.set(undefined));

describe('Details', () => {
	it('finds the order from the address', () => {
		expect(render({ id: 8 }).page.order).toEqual({ order_number: 8 });
		expect(render({ id: 9 }).page.order).toBeNull();
	});

	it('reads nothing without an id', () => {
		const { page, orders } = render({});
		expect(orders.getOrders).not.toHaveBeenCalled();
		expect(page.order).toBeUndefined();
	});

	it('knows the platform', () => {
		expect(render({}).page.isBrowser).toBe(true);
		expect(render({}, 'server').page.isBrowser).toBe(false);
	});

	it('lists the statuses', async () => {
		const { page } = render({});
		expect(await firstValueFrom(page.orderStatuses$)).toEqual([]);
		statuses.set({ data: [{ id: 1, name: 'Pending' }] });
		TestBed.tick();
		expect(await firstValueFrom(page.orderStatuses$)).toEqual([{ label: 'Pending', value: 1 }]);
		expect(await firstValueFrom(page.orderStatus$)).toEqual({ data: [{ id: 1, name: 'Pending' }] });
	});

	it('accepts a status pick without doing anything yet', () => {
		const { page } = render({});
		expect(() => {
			page.updateOrderStatus({ value: 1 } as never);
			page.updateOrderStatus({ value: 0 } as never);
			page.updateOrderStatus(null as never);
		}).not.toThrow();
	});

	it('clears up when leaving', () => {
		const { page, fixture } = render({});
		page.statuses = [{}] as never;
		fixture.destroy();
		expect(page.statuses).toEqual([]);
	});
});
