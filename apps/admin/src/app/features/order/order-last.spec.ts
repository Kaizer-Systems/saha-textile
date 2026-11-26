import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Order } from './order';

import type { OrderListResponse } from '@saha-textile/contracts';

const data = signal<OrderListResponse | undefined>(undefined);
const asked: Array<() => unknown> = [];
vi.mock('@core/orders/orders.gateway', async (original) => ({
	...(await original<typeof import('@core/orders/orders.gateway')>()),
	injectAdminOrdersQuery: (query: () => unknown) => {
		asked.push(query);
		return { data };
	},
}));

const response = (over: Partial<OrderListResponse> = {}): OrderListResponse => ({
	items: [
		{
			id: 'ord_1',
			orderNumber: 'ST-2611-482190',
			createdAt: '2026-11-20T10:40:00.000Z',
			channel: 'admin',
			buyerName: 'Kavita Iyer',
			buyerKind: 'person',
			currency: 'INR',
			total: 15_800,
			totalINR: 15_800,
			status: 'awaiting_payment',
			paymentStatus: 'request_sent',
			paymentDetail: { kind: 'request', gateway: 'ccavenue', until: '2026-11-27T09:30:00.000Z' },
			deliveryCountry: 'IN',
			attention: [],
			attentionAt: {},
			open: null,
		},
	],
	total: 1,
	counts: { all: 1, awaitingPayment: 1 } as OrderListResponse['counts'],
	tiles: { needsAttention: 0, awaitingPayment: 1, toPack: 0, shippedNotDelivered: 0, attentionBy: {} },
	...over,
});

const render = (lang = 'en') => {
	const router = { navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params ? `${key}(${Object.values(params).join(',')})` : key,
					getActiveLang: () => lang,
					langChanges$: of(lang),
				},
			},
		],
	});
	TestBed.overrideComponent(Order, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Order);
	TestBed.tick();
	return { page: fixture.componentInstance, router };
};

describe('Orders list: the last cases', () => {
	it('asks with only the filters chosen, reads no tiles or counts before the list, and draws Needs attention’s columns', () => {
		data.set(undefined);
		const { page } = render('bn');
		const query = asked.at(-1) as () => Record<string, unknown>;
		expect(query()).toEqual({ filter: 'all', page: 1, pageSize: 15 });
		page.setPayment('paid');
		page.setBuyerKind('business');
		page.setChannel('shop');
		expect(query()).toMatchObject({ payment: 'paid', buyerKind: 'business', channel: 'shop' });
		expect(page.tiles()).toBeNull();
		expect(page.counts()).toEqual({});
		page.setFilter('needsAttention');
		TestBed.tick();
		expect(page.tableConfig().columns.map((column) => column.dataField)).toContain('why');
		data.set(response({ total: 2 }));
		page.onTableChange({ search: 'Kavita' });
		expect(page.searchLine()).toBe('ord_search_matches_other(2,Kavita).');
	});

	it('moves the table back to page 1 when a filter changes, and opens only a row it was handed', () => {
		data.set(response());
		const { page, router } = render();
		const tableData: Record<string, unknown> = { page: 3 };
		Object.defineProperty(page, 'table', { value: () => ({ tableData }) });
		page.setFilter('open');
		expect(tableData['page']).toBe(1);
		page.onAction({ actionToPerform: 'view', data: undefined } as never);
		page.onAction({ actionToPerform: 'edit', data: { id: 'ord_1' } } as never);
		expect(router.navigate).not.toHaveBeenCalled();
	});
});
