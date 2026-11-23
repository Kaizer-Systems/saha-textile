import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { RefundVouchersGateway } from '@core/accounts/refund-vouchers.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { RefundVoucherPage } from './refund-voucher-page';

const voucher = (patch: Record<string, unknown> = {}) => ({
	id: 'rf_1',
	number: 'RF/26-27/000003',
	date: '2026-11-22',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-688796',
	paymentId: 'pay_1',
	receiptNumber: 'RC/26-27/000013',
	receiptDate: '2026-11-22',
	payee: 'Priya Sharma',
	amountINR: 2_600,
	how: 'gateway',
	reference: 'RFpay1',
	reason: 'order_cancelled',
	status: 'failed',
	...patch,
});

function setup(
	options: {
		current?: Record<string, unknown>;
		fail?: string | null;
		permissions?: string[];
		id?: string | null;
	} = {},
) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const opened: unknown[] = [];
	const fail = () => throwError(() => ({ error: { error: { message: options.fail } } }));
	const gateway = {
		get: () => of(voucher(options.current)),
		log: () =>
			of([
				{
					at: '2026-11-22T08:35:00.000Z',
					who: null,
					role: null,
					action: 'refundVoucher.outcome',
					diffs: [],
					metadata: { how: 'gateway', status: 'failed' },
				},
			]),
		pdf: vi.fn(() => of(new Blob(['%PDF']))),
		retry: vi.fn(() => (options.fail ? fail() : of(voucher({ status: 'refunded' })))),
		byHand: vi.fn(() => of(voucher({ status: 'refunded', how: 'bank_transfer' }))),
	};
	const chart = vi.fn(() =>
		of({
			groups: [{ id: 'g_bank', systemKey: 'bank_accounts', parentId: null }],
			ledgers: [{ id: 'led_hdfc', name: 'HDFC', groupId: 'g_bank', active: true }],
		}),
	);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [RefundVoucherPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id === null ? {} : { id: options.id ?? 'rf_1' })) },
			},
			{ provide: RefundVouchersGateway, useValue: gateway },
			{
				provide: OrdersGateway,
				useValue: {
					detail: () => of({ order: { status: 'cancelled', lines: [{ quantity: 1 }, { quantity: 2 }] } }),
				},
			},
			{ provide: LedgerGateway, useValue: { chart } },
			{ provide: NgbModal, useValue: { open: (t: unknown) => (opened.push(t), { close: () => undefined }) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['refund.action']) } },
		],
	});
	const fixture = TestBed.createComponent(RefundVoucherPage);
	return { fixture, page: fixture.componentInstance, gateway, chart, notifier, opened };
}

describe('a refund voucher’s page (C2)', () => {
	it('loads the voucher, its order’s pieces and its log, and offers Try again only while it hasn’t gone back', async () => {
		const { fixture, page } = setup();
		expect([page.canAct(), page.pieces(), page.logRows()]).toEqual([false, 0, []]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.voucher.data()).toBeTruthy());
		await vi.waitFor(() => expect(page.pieces()).toBe(3));
		await vi.waitFor(() => expect(page.logRows()).toHaveLength(1));
		expect(page.canAct()).toBe(true);
		expect([page.day('2026-11-22'), page.inr(2600)]).toEqual(['22 Nov 2026', '₹2,600.00']);
		for (const options of [{ current: { status: 'refunded' } }, { permissions: [] }]) {
			const other = setup(options);
			other.fixture.detectChanges();
			await vi.waitFor(() => expect(other.page.voucher.data()).toBeTruthy());
			expect(other.page.canAct()).toBe(false);
		}
		expect(setup({ id: null }).page.id()).toBe('');
	});

	it('prints, tries the gateway again, and pays by bank transfer from a cash or bank ledger', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		vi.spyOn(window, 'open').mockReturnValue(null);
		const { page, gateway, chart, notifier, opened } = setup();
		await page.print();
		expect(gateway.pdf).toHaveBeenCalledWith('rf_1');
		await page.retry();
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('rf_retried'));
		await page.openByHand('byHand' as never);
		await page.openByHand('byHand' as never);
		expect([opened, chart.mock.calls.length, page.payFrom().map((l) => l.id)]).toEqual([
			['byHand', 'byHand'],
			1,
			['led_hdfc'],
		]);
		page.ledgerId.set('led_hdfc');
		page.reference.set(' NEFT0001 ');
		await page.byHand();
		expect(gateway.byHand).toHaveBeenCalledWith('rf_1', { ledgerId: 'led_hdfc', reference: 'NEFT0001' });
	});

	it('says why a retry was refused, in words when it knows the refusal', async () => {
		for (const [fail, shown] of [
			['refund_voucher_already_refunded', 'rf_problem_refund_voucher_already_refunded'],
			['Gateway down', 'Gateway down'],
		]) {
			const { page, notifier } = setup({ fail });
			await page.retry();
			expect(notifier.showError).toHaveBeenCalledWith(expect.stringContaining(shown));
			expect(page.busy()).toBe(false);
		}
	});
});
