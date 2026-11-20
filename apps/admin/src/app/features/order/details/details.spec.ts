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
		expect(page.historyWords(page.history()[0] as never)).toBe('ord_history_status · ord_status_processing');
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
	});
});
