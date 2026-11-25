import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { PaymentVouchersListPage } from './payment-vouchers-list';

/** Accounts › Payment vouchers through the Export menu (brief 25 EX1): every matching voucher, as its CSV writes it. */

const voucher = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	number: `PV/26-27/00000${id}`,
	date: '2026-11-21',
	payeeName: 'Bose Properties',
	against: { kind: 'selfInvoice', id: 'si_2', number: 'SI/26-27/000002', detail: 'shop rent' },
	mode: 'bank_transfer',
	reference: 'NEFT 7712',
	amountINR: 60_000,
	reverseChargeTaxINR: 10_800,
	...over,
});

function setup(voucherList: ReturnType<typeof vi.fn>) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			PaymentVouchersListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: SelfInvoicesGateway, useValue: { voucherList, voucherPdf: vi.fn() } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	TestBed.overrideComponent(PaymentVouchersListPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(PaymentVouchersListPage);
	return { page: fixture.componentInstance, notifier };
}

describe('payment vouchers for the Export menu (EX1)', () => {
	it('reads every page of the chip, period and search and hands over what the CSV would hold', async () => {
		const pages = [[voucher('1'), voucher('2', { reverseChargeTaxINR: null })], [voucher('3')]];
		const voucherList = vi.fn(() => of({ items: pages.shift() ?? [], total: 3, counts: { all: 3 } }));
		const { page } = setup(voucherList);
		const source = await page.exportSource();
		expect(voucherList).toHaveBeenCalledTimes(2);
		expect(voucherList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 100 }));
		expect(source).toMatchObject({ title: 'pv_list_title', area: 'accounts' });
		expect(source?.fileName).toMatch(/^payment-vouchers-.*\.csv$/);
		expect(source?.header).toHaveLength(8);
		expect(source?.rows.map((row) => row[0])).toEqual(['PV/26-27/000001', 'PV/26-27/000002', 'PV/26-27/000003']);
		expect(source?.rows[1]?.[7]).toBeNull();
	});

	it('hands over nothing, with the reason said, when the vouchers cannot be read', async () => {
		const { page, notifier } = setup(vi.fn(() => throwError(() => new Error('down'))));
		expect(await page.exportSource()).toBeNull();
		expect(notifier.showError).toHaveBeenCalled();
	});
});
