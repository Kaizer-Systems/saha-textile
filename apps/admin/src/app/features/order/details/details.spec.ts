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
					{ at: '2026-11-18T13:33:00.000Z', kind: 'created', by: null, byName: null, messages: [], detail: {} },
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
		expect(page.paymentMethodWords({ method: 'gateway', gateway: { id: 'paypal', requestId: null } } as never)).toBe(
			'ord_pay_method_shop',
		);
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
