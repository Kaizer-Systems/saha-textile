import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsListsGateway } from '@core/accounts/accounts-lists.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import { AccountsListPage } from './accounts-list-page';

/** The voucher lists' Drafts tab: it opens Accounts › Vouchers › Drafts, for someone who may post. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

async function opened(list: string, permissions: string[]) {
	const page = { items: [], total: 0, counts: {}, totals: {} };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			AccountsListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ActivatedRoute, useValue: { data: of({ list }) } },
			{
				provide: AccountsListsGateway,
				useValue: { list: vi.fn(() => of(page)), dayBook: vi.fn(() => of(page)) },
			},
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([])) } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(permissions), user: signal(null) } },
		],
	});
	// The table, period picker and Export menu are their own components; the tab row is what this checks.
	TestBed.overrideComponent(AccountsListPage, {
		remove: { imports: [Table, PeriodPicker, ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(AccountsListPage);
	fixture.detectChanges();
	await settle(fixture);
	return fixture;
}

describe('the Drafts tab on the voucher lists', () => {
	it('links to the voucher drafts for someone who may post', async () => {
		const fixture = await opened('receipts', ['accounts.index', 'accounts.post']);
		const drafts = fixture.nativeElement.querySelector('#al_tab_drafts') as HTMLAnchorElement;
		expect([drafts.getAttribute('href'), drafts.textContent?.trim()]).toEqual([
			'/accounts/vouchers/drafts',
			'accounts_tab_drafts',
		]);
	});

	it('is not there for someone who may not post, nor on the sales and purchases lists', async () => {
		expect((await opened('receipts', ['accounts.index'])).nativeElement.querySelector('#al_tab_drafts')).toBeNull();
		expect(
			(await opened('taxInvoices', ['accounts.index', 'accounts.post'])).nativeElement.querySelector(
				'#al_tab_drafts',
			),
		).toBeNull();
	});
});
