import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SupplierPage } from './supplier-page';

/** A supplier's statement through the Export menu (brief 25 EX1), written by the statement's CSV code. */

const settle = async () => {
	for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const summary = (supplier: Record<string, unknown>) => ({
	supplier: { id: 'sup_1', taxType: 'intra_state', ...supplier },
	statement: [
		{
			date: '2026-11-01',
			documentNumber: 'PE/26-27/00031',
			details: 'Sarees',
			billINR: 40_000,
			paidOrCreditedINR: 0,
			balanceINR: 40_000,
		},
		{
			date: '2026-11-15',
			documentNumber: 'PAY/26-27/0009',
			details: 'NEFT',
			billINR: 0,
			paidOrCreditedINR: 15_000,
			balanceINR: 25_000,
		},
	],
});

function mount(read: unknown) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			SupplierPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'sup_1' }) } } },
			{ provide: PurchasingGateway, useValue: { supplierSummary: vi.fn(() => (read ? of(read) : NEVER)) } },
			{ provide: StockGateway, useValue: { settings: vi.fn(() => of({ unpaidAlertDays: 150 })) } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['purchase.index']) } },
		],
	});
	TestBed.overrideComponent(SupplierPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(SupplierPage);
	fixture.detectChanges();
	return fixture.componentInstance;
}

describe('a supplier’s statement for the Export menu (EX1)', () => {
	it('is what its CSV writes, titled with the short name, or the legal name when there is none', async () => {
		const page = mount(summary({ shortName: '', legalName: 'Nadia Weavers Co-op' }));
		await settle();
		expect(page.statementSource()).toEqual({
			fileName: 'statement-nadia-weavers-co-op.csv',
			title: 'Nadia Weavers Co-op',
			header: ['date', 'document', 'details', 'bill_amount', 'paid_or_credited', 'balance'],
			rows: [
				[expect.any(String), 'PE/26-27/00031', 'Sarees', 40_000, null, 40_000],
				[expect.any(String), 'PAY/26-27/0009', 'NEFT', null, 15_000, 25_000],
			],
			area: 'accounts',
		});
		const short = mount(summary({ shortName: 'Nadia', legalName: 'Nadia Weavers Co-op' }));
		await settle();
		expect(short.statementSource()?.title).toBe('Nadia');
	});

	it('has nothing to export before the statement is read', () => {
		expect(mount(null).statementSource()).toBeNull();
	});
});
