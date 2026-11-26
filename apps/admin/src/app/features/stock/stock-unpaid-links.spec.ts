import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';

import { Reports } from './reports';

/** Unpaid bills on Stock › Reports (brief 25 EB2): an expense bill opens on Expense bills, a purchase on its entry. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const unpaid = (id: string, kind?: 'purchaseEntry' | 'expenseBill') => ({
	...(kind ? { kind } : {}),
	id,
	number: `N-${id}`,
	supplierId: 'sup_1',
	supplierName: 'Bose Properties',
	billNumber: `BP-${id}`,
	billDate: '2026-11-01',
	dueOn: '2026-12-01',
	totalINR: 59_000,
	leftINR: 50_000,
	days: 24,
	nearLimit: false,
});

describe('unpaid bills open where each bill lives (EB2)', () => {
	it('links an expense bill to Expense bills, and a purchase entry, named or not, to Purchase entries', async () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				Reports,
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
					useValue: { snapshot: { data: { tab: 'unpaid' }, queryParamMap: convertToParamMap({}) } },
				},
				{
					provide: StockGateway,
					useValue: {
						unpaidBills: vi.fn(() =>
							of({
								alertDays: 150,
								rows: [unpaid('eb_1', 'expenseBill'), unpaid('pe_1', 'purchaseEntry'), unpaid('pe_2')],
							}),
						),
					},
				},
				{ provide: NgbModal, useValue: { open: vi.fn() } },
				{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
				{
					provide: AuthStore,
					useValue: { permissions: signal(['stock.index']), user: signal({ id: 'adm_1' }) },
				},
			],
		});
		// The Export menu is its own component; the unpaid rows are what this checks.
		TestBed.overrideComponent(Reports, {
			remove: { imports: [ExportMenu] },
			add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
		});
		const fixture = TestBed.createComponent(Reports);
		fixture.detectChanges();
		await settle(fixture);
		const links = [...fixture.nativeElement.querySelectorAll('tbody tr td:first-child a')] as HTMLAnchorElement[];
		expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['N-eb_1', '/expense-bills/eb_1'],
			['N-pe_1', '/purchase-entries/pe_1'],
			['N-pe_2', '/purchase-entries/pe_2'],
		]);
	});
});
