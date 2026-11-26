import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { PaymentVouchersListPage } from './payment-vouchers-list';

/** Accounts › Payment vouchers (A6, decision D5). */

const rcm = {
	id: 'pv_7',
	number: 'PV/26-27/000007',
	date: '2026-11-21',
	payeeName: 'Bose Properties',
	against: { kind: 'selfInvoice', id: 'si_2', number: 'SI/26-27/000002', detail: 'shop rent' },
	mode: 'bank_transfer',
	reference: 'NEFT 7712',
	amountINR: 60_000,
	reverseChargeTaxINR: 10_800,
};
const bill = {
	...rcm,
	id: 'pv_6',
	number: 'PV/26-27/000006',
	payeeName: 'Nadia Weavers Co-op',
	against: { kind: 'purchaseEntry', id: 'pe_31', number: 'PE/26-27/00031', detail: '' },
	reverseChargeTaxINR: null,
};

function setup(options: { fail?: boolean; pages?: unknown[][] } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const pages = [...(options.pages ?? [[rcm, bill]])];
	const voucherList = vi.fn(() => {
		const items = pages.shift() ?? [];
		return of({ items, total: 2, counts: { all: 2 } });
	});
	const voucherPdf = vi.fn(() => (options.fail ? throwError(() => new Error('down')) : of(new Blob(['%PDF']))));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [PaymentVouchersListPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: SelfInvoicesGateway, useValue: { voucherList, voucherPdf } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	TestBed.overrideComponent(PaymentVouchersListPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(PaymentVouchersListPage);
	return { fixture, page: fixture.componentInstance, voucherList, voucherPdf, notifier };
}

describe('the payment vouchers list (A6)', () => {
	it('asks for the chip, period, search and page, and names payees and what was paid', async () => {
		const { fixture, page, voucherList } = setup();
		expect(page.pages()).toBe(1);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.list.data()).toBeTruthy());
		page.page.set(2);
		page.setFilter('reverse_charge');
		expect(page.page()).toBe(1);
		page.page.set(2);
		page.setPeriod({ period: 'custom' });
		page.search.set(' 7712 ');
		fixture.detectChanges();
		await vi.waitFor(() =>
			expect(voucherList).toHaveBeenLastCalledWith(
				expect.objectContaining({ from: '2017-07-01', search: '7712', filter: 'reverse_charge', page: 1 }),
			),
		);
		expect(page.payee(rcm as never)).toContain('pv_payee_unregistered');
		expect(page.payee(bill as never)).toBe('Nadia Weavers Co-op');
		expect([page.against(rcm as never), page.against(bill as never)]).toEqual([
			'SI/26-27/000002 · shop rent',
			'PE/26-27/00031',
		]);
		expect([page.day('2026-11-21'), page.inr(60_000)]).toEqual(['21 Nov 2026', '₹60,000.00']);
	});

	it('prints a voucher, exports every page as CSV, and says when it failed', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		vi.spyOn(window, 'open').mockReturnValue(null);
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		const { page, voucherPdf } = setup({ pages: [[rcm], [bill]] });
		await page.print(rcm as never);
		expect(voucherPdf).toHaveBeenCalledWith('pv_7');
		const { page: exporting, voucherList } = setup({ pages: [[rcm], [bill]] });
		await exporting.exportCsv();
		expect(
			voucherList.mock.calls.map((c) => (c as unknown as [{ page: number; pageSize: number }])[0].page),
		).toEqual([1, 2]);
		const empty = setup({ pages: [[]] });
		await empty.page.exportCsv();
		expect(click).toHaveBeenCalled();
		const failing = setup({ fail: true });
		await failing.page.print(rcm as never);
		expect(failing.notifier.showError).toHaveBeenCalled();
		expect(failing.page.busy()).toBe(false);
	});
});
