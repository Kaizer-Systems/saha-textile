import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
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
};

function setup(id: string | null = 'pv_1', failPdf = false) {
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
		],
	});
	const fixture = TestBed.createComponent(PaymentVoucherPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier };
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
});
