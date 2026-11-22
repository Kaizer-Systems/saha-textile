import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { Details } from './details';

import type { AdminOrderDetail } from '@saha-textile/contracts';

const data = signal<AdminOrderDetail | undefined>(undefined);
vi.mock('@core/orders/orders.gateway', async (original) => ({
	...(await original<typeof import('@core/orders/orders.gateway')>()),
	injectAdminOrderQuery: (id: () => string | null) => (id(), { data, isPending: () => false, isError: () => false }),
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));

const detail = (over: Partial<AdminOrderDetail['order']> = {}): AdminOrderDetail =>
	({
		order: {
			id: 'ord_1',
			orderNumber: 'ST-2611-482190',
			currency: 'GBP',
			status: 'processing',
			revision: 4,
			lines: [],
			history: [
				{ at: '2026-11-19T10:00:00.000Z', kind: 'created', by: null, byName: null, messages: [] },
				{
					at: '2026-11-19T11:00:00.000Z',
					kind: 'status',
					to: 'processing',
					by: 'u1',
					byName: 'Moulik',
					messages: [],
				},
			],
			totalINR: 31_000,
			totalPaid: 280.97,
			...over,
		},
		payments: [
			{ id: 'p1', paypal: { exchangeRate: { value: 117.2 } } },
			{ id: 'p2', paypal: null },
		],
		requests: [{ id: 'q1' }, { id: 'q2' }],
		shipments: [],
		allowedNext: [{ to: 'packed', allowed: true }],
		attention: ['invoiceAddressNeeded'],
		credit: null,
		eDocuments: { shown: false },
	}) as unknown as AdminOrderDetail;

const render = () => {
	const gateway = { comment: vi.fn(() => of({})), checkRequest: vi.fn(() => of({ recorded: true })) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: 'ord_1' })) },
			},
		],
	});
	TestBed.overrideComponent(Details, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Details);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, notifier };
};

describe('order page (od05–od08, pl01–pl05)', () => {
	it('reads the order from the address and places it on the steps', () => {
		data.set(detail());
		const { page } = render();
		expect(page.id()).toBe('ord_1');
		expect(page.stepAt()).toBe(2);
		expect(page.statusPill()).toBe('processing');
		expect(page.foreign()).toBe(true);
		expect(page.needsInvoiceAddress()).toBe(true);
	});

	it('shows the newest history and requests first, and PayPal’s own rate from its payment', () => {
		data.set(detail());
		const { page } = render();
		expect(page.history()[0]?.kind).toBe('status');
		expect(page.requests()[0]?.id).toBe('q2');
		expect(page.paypalRecord()?.exchangeRate?.value).toBe(117.2);
		expect(page.historyRows()[0]).toMatchObject({ lead: 'ord_status_processing', by: 'Moulik' });
	});

	it('words the history as od05/od06 draw it: one row for a payment and the Placed it caused', () => {
		data.set(
			detail({
				channel: 'shop',
				history: [
					{
						at: '2026-11-18T13:33:00.000Z',
						kind: 'created',
						by: null,
						byName: null,
						messages: [],
						detail: {},
					},
					{
						at: '2026-11-18T13:33:10.000Z',
						kind: 'payment',
						by: null,
						byName: null,
						messages: [],
						detail: { gateway: 'ccavenue', amountINR: 23_050 },
					},
					{
						at: '2026-11-18T13:33:10.000Z',
						kind: 'status',
						to: 'placed',
						by: null,
						byName: null,
						messages: [{ channel: 'email', template: 'order_confirmed' }],
						detail: {},
					},
					{
						at: '2026-11-20T11:40:00.000Z',
						kind: 'status',
						to: 'shipped',
						by: 'u2',
						byName: 'Rupa Sen',
						comment: 'Booked at the Gariahat counter',
						messages: [],
						detail: { courier: 'DTDC', tracking: 'D47512398' },
					},
					{
						at: '2026-11-22T07:36:00.000Z',
						kind: 'comment',
						by: 'u1',
						byName: 'Moulik Patra',
						comment: 'Customer called to say thanks',
						messages: [],
						detail: {},
					},
				],
			} as never),
		);
		const rows = render().page.historyRows();
		expect(rows).toHaveLength(4);
		expect(rows[0]).toMatchObject({ lead: null, text: 'ord_hist_comment', comment: null, by: 'Moulik' });
		expect(rows[1]).toMatchObject({ lead: 'ord_status_shipped', text: 'DTDC D47512398', by: 'Rupa' });
		expect(rows[1]?.comment).toBe('Booked at the Gariahat counter');
		expect(rows[2]).toMatchObject({ text: 'ord_hist_paid_via', placed: true, by: 'ord_by_shop' });
	});

	it('names staff from the server’s list when a history line kept no name (actions taken in the admin)', () => {
		data.set({
			...detail({
				channel: 'admin',
				createdBy: 'adm_7',
				history: [
					{
						at: '2026-11-21T06:47:00.000Z',
						kind: 'created',
						by: 'adm_7',
						byName: null,
						messages: [],
						detail: {},
					},
					{
						at: '2026-11-21T06:50:00.000Z',
						kind: 'comment',
						by: 'adm_gone',
						byName: null,
						comment: 'x',
						messages: [],
						detail: {},
					},
				],
			} as never),
			staff: { adm_7: 'Rupa Sen' },
		} as never);
		const { page } = render();
		expect(page.createdByName()).toBe('Rupa');
		const rows = page.historyRows();
		expect(rows[1]).toMatchObject({ by: 'Rupa' });
		// Someone no longer on the staff list reads as System, never as an id.
		expect(rows[0]).toMatchObject({ by: 'ord_by_system' });
	});

	it('words the payment request card and the payments table (pl01–pl04)', () => {
		data.set(detail({ currency: 'INR', lines: [{ held: true, quantity: 2 }] } as never));
		const { page } = render();
		const request = {
			gateway: 'ccavenue',
			currency: 'INR',
			amount: 15_800,
			amountINR: 15_800,
			status: 'active',
			expiresAt: '2026-11-27T09:32:00.000Z',
			createdAt: '2026-11-20T09:32:00.000Z',
			createdBy: 'u1',
			sentTo: { email: 'kavita@example.test', mobile: '+91 9831122334' },
			attempts: [
				{ at: '2026-11-20T09:35:00.000Z', state: 'failed', method: 'card', reason: 'insufficient funds' },
				{ at: '2026-11-20T09:37:00.000Z', state: 'pending', method: 'UPI', reason: null },
			],
			lastCheckedAt: null,
		} as never;
		expect(page.requestedLine(request)).toBe('ord_req_requested_line');
		expect(page.validLine(request)).toBe('ord_req_valid_held_other');
		expect(page.hasPendingAttempt(request)).toBe(true);
		expect(page.smsReachable(request)).toBe(true);
		expect(page.attemptsSummary(request)).toContain('ord_req_attempt_n_failed (ord_req_declined_method)');
		expect(
			page.paymentMethodWords({ method: 'gateway', gateway: { id: 'ccavenue', requestId: 'q1' } } as never),
		).toBe('ord_pay_method_link');
		expect(
			page.paymentMethodWords({ method: 'gateway', gateway: { id: 'paypal', requestId: null } } as never),
		).toBe('ord_pay_method_shop');
		expect(page.recordedBy({ gateway: { id: 'paypal' } } as never)).toBe('PayPal');
		expect(page.recordedBy({ gateway: null, recordedBy: 'u1' } as never)).toBe('Moulik');
	});

	it('a cancelled order sits off the steps; an open order has none', () => {
		data.set(detail({ status: 'cancelled' }));
		expect(render().page.stepAt()).toBe(-1);
		data.set(detail({ status: 'open' }));
		expect(render().page.stepAt()).toBe(-1);
	});

	it('Check payment status asks the gateway and says what it found', async () => {
		data.set(detail());
		const { page, gateway, notifier } = render();
		await page.checkRequest({ id: 'q2' } as never);
		expect(gateway.checkRequest).toHaveBeenCalledWith('ord_1', 'q2');
		expect(notifier.showSuccess).toHaveBeenCalledWith('ord_request_paid_toast');
		gateway.checkRequest.mockReturnValueOnce(
			of({ recorded: true, payment: { amountINR: 15_800, reference: '313012345678' } }) as never,
		);
		await page.checkRequest({ id: 'q2', gateway: 'ccavenue' } as never);
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_request_paid_detail_toast');
	});
});

describe('sets and free items on the order page (bundle builder brief E07–E08)', () => {
	const line = (over: Record<string, unknown>) => ({
		title: { en: 'Piece' },
		sku: 'SKU',
		quantity: 1,
		attributes: {},
		addons: [],
		unitPricePaid: 0,
		lineTotalPaid: 0,
		held: true,
		role: 'product',
		parentLineId: null,
		...over,
	});
	const lines = [
		line({
			lineId: 's',
			role: 'bundle',
			title: { en: 'Peacock set' },
			sku: 'BND-1',
			set: { heading: 'components' },
		}),
		line({
			lineId: 's~a',
			role: 'piece',
			parentLineId: 's',
			title: { en: 'Peacock Blue' },
			lineTotalPaid: 33211.16,
		}),
		line({
			lineId: 's~a>f',
			role: 'free',
			parentLineId: 's~a',
			title: { en: 'Petticoat' },
			attributes: { Variation: 'M' },
		}),
		line({ lineId: 's~b', role: 'piece', parentLineId: 's', title: { en: 'Off White' }, lineTotalPaid: 11688.84 }),
		line({ lineId: 'p', title: { en: 'Lavender saree' }, lineTotalPaid: 5600 }),
		line({ lineId: 'p~f', role: 'free', parentLineId: 'p', title: { en: 'Cover bag' } }),
	];

	it('draws the tree: depths, piece numbers, the set’s total from its pieces', () => {
		data.set(detail({ lines: lines as never }));
		const { page } = render();
		const [set, a, free, b, product] = page.order()!.lines;
		expect([set, a, free, b].map((row) => page.depthOf(row!))).toEqual([0, 1, 2, 1]);
		expect([a, b].map((row) => page.pieceNumber(row!))).toEqual([1, 2]);
		expect(page.setTotalPaid(set!)).toBeCloseTo(44900, 2);
		expect(page.setCounts(set!)).toBe('ord_set_pieces');
		expect(page.freeCount(product!)).toBe(1);
	});

	it('lists every physical piece with where it comes from, and opens Mark packed only when all are ticked', () => {
		data.set(detail({ lines: lines as never, packTicks: ['s~a', 's~a>f', 's~b', 'p'] }));
		const { page } = render();
		expect(page.packRows().map((row) => [row.line.lineId, row.from.key, row.options, row.ticked])).toEqual([
			['s~a', 'ord_pack_from_piece', '', true],
			['s~a>f', 'ord_pack_from_free_piece', 'M', true],
			['s~b', 'ord_pack_from_piece', '', true],
			['p', 'ord_pack_from_line', '', true],
			['p~f', 'ord_pack_from_free_line', '', false],
		]);
		expect(page.packDone()).toBe(false);
		expect(page.packing()).toBe(true);
	});

	it('a staff order line saved without options still lists in the Pack list (the page never stops)', () => {
		const bare = { lineId: 'x', parentLineId: null, role: 'product', title: { en: 'Plain saree' }, quantity: 1 };
		data.set(detail({ lines: [bare] as never, packTicks: undefined as never }));
		const { page } = render();
		expect(page.packRows().map((row) => [row.line.lineId, row.options, row.ticked])).toEqual([['x', '', false]]);
		expect(page.attributeValues(page.order()!.lines[0]!)).toEqual([]);
	});

	it('saves a tick and moves the order to Packed', async () => {
		data.set(detail({ lines: lines as never }));
		const { page, gateway } = render();
		const calls: unknown[] = [];
		Object.assign(gateway, {
			packTick: vi.fn((id: string, body: unknown) => (calls.push(['tick', id, body]), of({}))),
			changeStatus: vi.fn((id: string, body: { to: string }) => (calls.push(['status', id, body.to]), of({}))),
		});
		await page.tick(page.order()!.lines[1]!, true);
		await page.markPacked();
		expect(calls).toEqual([
			['tick', 'ord_1', { lineId: 's~a', ticked: true, revision: 4 }],
			['status', 'ord_1', 'packed'],
		]);
	});
});
