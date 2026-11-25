import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { BusinessPage } from './business-page';

/** A business's statements through the Export menu (brief 25 EX1): as a customer, and as a supplier. */

const settle = async () => {
	for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const BUSINESS = {
	id: 'biz_1',
	tradeName: '',
	legalName: 'Nadia Weavers Co-op',
	roles: { customer: { zoneId: null }, supplier: {} },
};
const LEDGER = {
	closingINR: 1_500,
	rows: [
		{
			at: '2026-11-02T06:00:00.000Z',
			kind: 'invoice',
			documentNumber: 'INV/26-27/000101',
			amountINR: 2_000,
			balanceINR: 2_000,
			dueOn: '2026-12-02',
		},
		{ at: '2026-11-10T06:00:00.000Z', kind: 'receipt', documentNumber: null, amountINR: -500, balanceINR: 1_500 },
	],
};
const SUMMARY = {
	supplier: { shortName: '', legalName: 'Nadia Weavers Co-op' },
	statement: [
		{
			date: '2026-11-01',
			documentNumber: 'PE/26-27/00031',
			details: 'Sarees',
			billINR: 40_000,
			paidOrCreditedINR: 0,
			balanceINR: 40_000,
		},
	],
};

function mount(options: { business?: unknown; ledger?: unknown; summary?: unknown } = {}) {
	TestBed.resetTestingModule();
	const businesses = {
		get: vi.fn(() => (options.business === null ? NEVER : of(options.business ?? BUSINESS))),
		ledger: vi.fn(() => of(options.ledger ?? LEDGER)),
		zones: vi.fn(() => of([])),
		balances: vi.fn(() => of({ theyOweUsINR: 1_500, weOweThemINR: 40_000 })),
	};
	const purchasing = { supplierSummary: vi.fn(() => of(options.summary ?? SUMMARY)) };
	TestBed.configureTestingModule({
		imports: [
			BusinessPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'biz_1' })) } },
			{ provide: BusinessesGateway, useValue: businesses },
			{ provide: PurchasingGateway, useValue: purchasing },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
		],
	});
	TestBed.overrideComponent(BusinessPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(BusinessPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

describe('a business’s statement as a customer, for the Export menu (EX1)', () => {
	it('gives each line its day, document (or kind), debit or credit, balance and due day, named for the business', async () => {
		const { page } = mount();
		await settle();
		expect(page.statementSource()).toEqual({
			fileName: 'Nadia-Weavers-Co-op-statement',
			title: 'Nadia Weavers Co-op',
			header: [
				'biz_col_date',
				'biz_col_document',
				'biz_col_debit',
				'biz_col_credit',
				'biz_col_balance',
				'biz_col_due',
			],
			rows: [
				['2026-11-02', 'INV/26-27/000101', 2_000, null, 2_000, '2026-12-02'],
				['2026-11-10', 'receipt', null, 500, 1_500, null],
			],
			kinds: { 2: 'money', 3: 'money', 4: 'money' },
			area: 'accounts',
		});
	});

	it('uses the trade name when there is one, and has nothing to export before the business or its ledger is read', async () => {
		const named = mount({ business: { ...BUSINESS, tradeName: 'Nadia Weaves' } });
		await settle();
		expect(named.page.statementSource()?.title).toBe('Nadia Weaves');
		const unread = mount({ business: null });
		expect(unread.page.statementSource()).toBeNull();
		const supplierOnly = mount({ business: { ...BUSINESS, roles: { supplier: {} } } });
		await settle();
		expect(supplierOnly.page.statementSource()).toBeNull();
	});
});

describe('a business’s statement as a supplier, for the Export menu (EX1)', () => {
	it('is what the supplier statement’s CSV writes, under the supplier’s name, once its tab is open', async () => {
		const { page } = mount();
		await settle();
		expect(page.supplierStatementSource()).toBeNull();
		page.tab.set('supplier');
		await settle();
		expect(page.supplierStatementSource()).toEqual({
			fileName: 'statement-nadia-weavers-co-op.csv',
			title: 'Nadia Weavers Co-op',
			header: ['date', 'document', 'details', 'bill_amount', 'paid_or_credited', 'balance'],
			rows: [[expect.any(String), 'PE/26-27/00031', 'Sarees', 40_000, null, 40_000]],
			area: 'accounts',
		});
	});

	it('uses the supplier’s short name when there is one', async () => {
		const { page } = mount({
			summary: { ...SUMMARY, supplier: { shortName: 'Nadia', legalName: 'Nadia Weavers Co-op' } },
		});
		page.tab.set('supplier');
		await settle();
		expect(page.supplierStatementSource()?.title).toBe('Nadia');
	});
});
