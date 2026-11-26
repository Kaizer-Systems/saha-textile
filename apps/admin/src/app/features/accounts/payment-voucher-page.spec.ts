import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PaymentVoucherPage } from './payment-voucher-page';

/** A payment voucher (decision D5). */

const voucher = {
	id: 'pv_1',
	number: 'PV/26-27/000007',
	date: '2026-11-21',
	payeeName: 'Bose Properties',
	against: { kind: 'selfInvoice', id: 'si_1', number: 'SI/26-27/000002' },
	amountINR: 60_000,
	mode: 'bank_transfer',
	reference: 'NEFT 7712',
	reverseChargeTaxINR: 10_800,
	status: 'paid',
};

function setup(
	id: string | null = 'pv_1',
	failPdf = false,
	options: { result?: unknown; failCancel?: string; permissions?: string[] } = {},
) {
	const asked = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => ({
			componentInstance: asked,
			result:
				options.result === 'dismissed'
					? Promise.reject(new Error('x'))
					: Promise.resolve(options.result ?? null),
		})),
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		voucher: () => of(voucher),
		voucherLog: () =>
			of([
				{
					at: '2026-11-21T08:35:00.000Z',
					who: null,
					role: null,
					action: 'paymentVoucher.print',
					diffs: [],
					metadata: {},
				},
			]),
		voucherPdf: vi.fn(() => (failPdf ? throwError(() => new Error('down')) : of(new Blob(['%PDF'])))),
		cancelVoucher: vi.fn(() =>
			options.failCancel
				? throwError(() => ({ error: { error: { message: options.failCancel } } }))
				: of({ ...voucher, status: 'cancelled' }),
		),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [PaymentVoucherPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) } },
			{ provide: SelfInvoicesGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modals },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['purchase.payment']) } },
		],
	});
	const fixture = TestBed.createComponent(PaymentVoucherPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier, asked };
}

describe('a payment voucher’s page', () => {
	it('shows the voucher, links what it paid, prints and keeps the log', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		vi.spyOn(window, 'open').mockReturnValue(null);
		const { fixture, page, gateway } = setup();
		expect(page.logRows()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.voucher.data()).toBeTruthy());
		await vi.waitFor(() => expect(page.logRows()).toHaveLength(1));
		expect(page.againstLink(voucher as never)).toEqual(['/accounts/self-invoices', 'si_1']);
		expect(page.againstLink({ against: { kind: 'purchaseEntry', id: 'pe_31' } } as never)).toEqual([
			'/purchase-entries',
			'pe_31',
		]);
		expect([page.day('2026-11-21'), page.inr(60_000)]).toEqual(['21 Nov 2026', '₹60,000.00']);
		await page.print();
		expect(gateway.voucherPdf).toHaveBeenCalledWith('pv_1');
		expect(setup(null).page.id()).toBe('');
		const failing = setup('pv_1', true);
		await failing.page.print();
		expect(failing.notifier.showError).toHaveBeenCalled();
		expect(failing.page.busy()).toBe(false);
	});

	it('cancels through the reason popup, with the refusal in words, only with the right to pay', async () => {
		const { fixture, page, gateway, asked } = setup('pv_1', false, { result: { status: 'cancelled' } });
		expect(page.canCancel()).toBe(false);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.canCancel()).toBe(true));
		await page.cancel(voucher as never);
		const ask = asked.start.mock.calls[0]?.[0] as { act: (reason: string) => Promise<unknown> };
		await ask.act('Paid twice');
		expect(gateway.cancelVoucher).toHaveBeenCalledWith('pv_1', 'Paid twice');
		const refused = setup('pv_1', false, { failCancel: 'month_locked', result: 'dismissed' });
		await refused.page.cancel(voucher as never);
		const refusedAsk = refused.asked.start.mock.calls[0]?.[0] as { act: (reason: string) => Promise<unknown> };
		await expect(refusedAsk.act('x')).rejects.toMatchObject({
			error: { message: expect.stringContaining('si_problem_month_locked') },
		});
		const other = setup('pv_1', false, { failCancel: 'Network down' });
		await other.page.cancel(voucher as never);
		const otherAsk = other.asked.start.mock.calls[0]?.[0] as { act: (reason: string) => Promise<unknown> };
		await expect(otherAsk.act('x')).rejects.toMatchObject({ error: { message: 'Network down' } });
		const noRight = setup('pv_1', false, { permissions: [] });
		noRight.fixture.detectChanges();
		await vi.waitFor(() => expect(noRight.page.voucher.data()).toBeTruthy());
		expect(noRight.page.canCancel()).toBe(false);
	});
});
