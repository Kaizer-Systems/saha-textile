import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ExpenseBillFormPage } from './bill-form';

import type { ExpenseBill } from '@saha-textile/contracts';

/** A saved expense bill opened before its supplier is in the picker's list (brief 25 EB1): its saved name is shown. */

const flush = async () => {
	for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const BOSE = {
	id: 'sup_wb',
	shortName: 'Bose',
	legalName: 'Bose Properties',
	gstin: '19AAPFU0939F1ZV',
	stateName: 'West Bengal',
	active: true,
};
const RUBY = {
	id: 'sup_ruby',
	shortName: '',
	legalName: 'Ruby Electricals',
	gstin: null,
	stateName: 'West Bengal',
	active: true,
};
const bill = (over: Partial<ExpenseBill> = {}): ExpenseBill =>
	({
		id: 'eb_1',
		number: null,
		supplierId: 'sup_wb',
		supplierName: 'Bose Properties',
		billNumber: 'BP-77',
		billDate: '2026-11-20',
		locationId: 'loc_b',
		lines: [],
		note: '',
		status: 'draft',
		interState: false,
		taxableINR: 0,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 0,
		blockedTaxINR: 0,
		totalINR: 0,
		paidINR: 0,
		voucherId: null,
		postedAt: null,
		postedBy: null,
		createdAt: '2026-11-20T06:00:00.000Z',
		updatedAt: '2026-11-20T06:00:00.000Z',
		version: 1,
		...over,
	}) as ExpenseBill;

function mount(options: { id?: string; bill?: ExpenseBill; suppliers?: unknown } = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			ExpenseBillFormPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id ? { id: options.id } : {})) },
			},
			{
				provide: ExpenseBillsGateway,
				useValue: {
					get: vi.fn(() => of(options.bill ?? bill())),
					form: vi.fn(() => of({ locations: [], ledgers: [] })),
					paymentVouchers: vi.fn(() => of([])),
				},
			},
			{
				provide: PurchasingGateway,
				useValue: {
					suppliers: vi.fn(() =>
						options.suppliers === null ? NEVER : of({ items: options.suppliers ?? [RUBY], total: 1 }),
					),
				},
			},
			{ provide: LedgerGateway, useValue: { chart: vi.fn() } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
		],
	});
	TestBed.overrideComponent(ExpenseBillFormPage, {
		remove: { imports: [Select2] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(ExpenseBillFormPage);
	return { fixture, page: fixture.componentInstance };
}

describe('the supplier picker on a saved expense bill (EB1)', () => {
	it('shows the bill’s saved supplier name first while that supplier is not in the list yet', async () => {
		const { fixture, page } = mount({ id: 'eb_1' });
		fixture.detectChanges();
		await flush();
		fixture.detectChanges();
		expect(page.supplierOptions()).toEqual([
			{ value: 'sup_wb', label: 'Bose Properties' },
			{ value: 'sup_ruby', label: 'Ruby Electricals' },
		]);
	});

	it('uses the list’s own option once the supplier is in it, and adds none for a supplier with no saved name', async () => {
		const listed = mount({ id: 'eb_1', suppliers: [BOSE, RUBY] });
		listed.fixture.detectChanges();
		await flush();
		// Read before the page has noted the list's suppliers: the row is there, the supplier not yet known.
		expect(listed.page.supplierOptions()).toEqual([
			{ value: 'sup_wb', label: 'Bose' },
			{ value: 'sup_ruby', label: 'Ruby Electricals' },
		]);
		listed.fixture.detectChanges();
		expect(listed.page.supplier()?.id).toBe('sup_wb');
		expect(listed.page.supplierOptions().map((o) => (o as { value: string }).value)).toEqual([
			'sup_wb',
			'sup_ruby',
		]);
		const fresh = mount({ suppliers: [RUBY] });
		fresh.fixture.detectChanges();
		await flush();
		fresh.page.chooseSupplier({ value: 'sup_elsewhere' } as never);
		expect(fresh.page.supplierOptions()).toEqual([{ value: 'sup_ruby', label: 'Ruby Electricals' }]);
	});
});

describe('the bill’s heading line (EB1)', () => {
	it('shows only the status of a bill with no number yet, with no gap before it', async () => {
		const { fixture } = mount({ id: 'eb_1' });
		fixture.detectChanges();
		await flush();
		fixture.detectChanges();
		const heading = fixture.nativeElement.querySelector('h5.mb-1') as HTMLElement;
		expect(heading.textContent?.trim()).toBe('eb_status_draft');
		expect(heading.querySelector('.status-pending')?.classList.contains('ms-2')).toBe(false);
	});
});
