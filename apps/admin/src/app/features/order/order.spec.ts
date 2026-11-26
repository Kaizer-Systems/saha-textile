import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Order } from './order';

import type { OrderListResponse } from '@saha-textile/contracts';

const data = signal<OrderListResponse | undefined>(undefined);
const asked: unknown[] = [];
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

const render = () => {
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
					getActiveLang: () => 'en',
					langChanges$: of('en'),
				},
			},
		],
	});
	TestBed.overrideComponent(Order, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Order);
	TestBed.tick();
	return { page: fixture.componentInstance, router };
};

describe('orders list page (ol02–ol04, oo01)', () => {
	it('fills the table, the tiles and the filter counts from the API', () => {
		const { page } = render();
		expect(page.tableConfig().data).toEqual([]);
		data.set(response());
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
		expect(page.tableConfig().data?.[0]?.payment).toContain('ord_pay_request_sent');
		expect(page.tiles()?.awaitingPayment).toBe(1);
		expect(page.counts().awaitingPayment).toBe(1);
	});

	it('open orders switch to their own columns', () => {
		const { page } = render();
		data.set(response());
		page.setFilter('open');
		TestBed.tick();
		expect(page.tableConfig().columns?.map((column) => column.dataField)).toContain('openSince');
	});

	it('sends the filters, choices, search and date range to the server', () => {
		const { page } = render();
		page.setFilter('needsAttention');
		page.setPayment('paid');
		page.setBuyerKind('business');
		page.setChannel('shop');
		page.onTableChange({ page: 1, paginate: 15, search: '4821', start_date: '2026-11-1', end_date: '2026-11-20' });
		const query = (asked[asked.length - 1] as () => Record<string, unknown>)();
		expect(query).toMatchObject({
			filter: 'needsAttention',
			payment: 'paid',
			buyerKind: 'business',
			channel: 'shop',
			q: '4821',
			from: '2026-11-01',
			to: '2026-11-20',
		});
	});

	it('words the Needs attention tile from its reasons, or "Waiting on staff" (ol02)', () => {
		const { page } = render();
		data.set(response());
		expect(page.attentionLine()).toBeNull();
		data.set(
			response({
				tiles: {
					needsAttention: 3,
					awaitingPayment: 2,
					toPack: 5,
					shippedNotDelivered: 4,
					attentionBy: { invoiceAddressNeeded: 1, requestExpiredUnpaid: 1, pendingAtBank: 1 },
				},
			}),
		);
		expect(page.attentionLine()).toBe(
			'ord_tile_part_invoiceAddressNeeded_one(1) · ord_tile_part_requestExpiredUnpaid_one(1) · ord_tile_part_pendingAtBank_one(1)',
		);
	});

	it('says how many orders a search found, and names the SMS form of a number (ol04)', () => {
		const { page } = render();
		data.set(response());
		expect(page.searchLine()).toBeNull();
		page.onTableChange({ page: 1, paginate: 15, search: '4821390761' });
		expect(page.searchLine()).toBe('ord_search_matches_one(1,4821390761) ord_search_sms_form.');
		page.onTableChange({ page: 1, paginate: 15, search: 'Arjun' });
		expect(page.searchLine()).toBe('ord_search_matches_one(1,Arjun).');
	});

	it('opens an order by its id', () => {
		const { page, router } = render();
		page.onAction({ actionToPerform: 'view', data: { id: 'ord_1' } } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/order/details', 'ord_1']);
	});
});
