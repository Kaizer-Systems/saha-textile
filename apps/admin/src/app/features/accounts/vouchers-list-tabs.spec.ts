import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { VOUCHER_TABS } from './accounts-list-page';
import { VouchersListPage } from './vouchers-list';

/** Accounts › Vouchers › Drafts reached from the voucher lists' tabs: their tab row, with Drafts chosen. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

function configure(route: unknown | null) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			VouchersListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			...(route === null ? [] : [provideRouter([]), { provide: ActivatedRoute, useValue: route }]),
			{
				provide: LedgerGateway,
				useValue: {
					vouchers: vi.fn(() => of({ items: [], total: 0, page: 1, pageSize: 25 })),
					drafts: vi.fn(() => of([])),
				},
			},
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.post']) } },
		],
	});
}

describe('the vouchers page opened from the voucher lists’ Drafts tab', () => {
	it('starts on drafts under the voucher lists’ own tabs, with Drafts marked', async () => {
		configure({ snapshot: { data: { tab: 'drafts' } } });
		TestBed.overrideComponent(VouchersListPage, {
			remove: { imports: [PeriodPicker] },
			add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
		});
		const fixture = TestBed.createComponent(VouchersListPage);
		fixture.detectChanges();
		await settle(fixture);
		const page = fixture.componentInstance;
		expect([page.fromVoucherTabs, page.tab()]).toEqual([true, 'drafts']);
		const links = [...fixture.nativeElement.querySelectorAll('.nav-link[href]')] as HTMLAnchorElement[];
		expect(links.map((a) => a.getAttribute('href'))).toEqual(VOUCHER_TABS.map((t) => `/accounts/vouchers/${t}`));
		expect(fixture.nativeElement.querySelector('#vouchers_tab_drafts')?.classList.contains('active')).toBe(true);
		expect(fixture.nativeElement.querySelector('#vouchers_tab_posted')).toBeNull();
	});

	it('starts on posted vouchers with its own tabs from any other route, or with no route at all', async () => {
		configure({ snapshot: { data: {} } });
		TestBed.overrideComponent(VouchersListPage, {
			remove: { imports: [PeriodPicker] },
			add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
		});
		const fixture = TestBed.createComponent(VouchersListPage);
		fixture.detectChanges();
		await settle(fixture);
		expect([fixture.componentInstance.fromVoucherTabs, fixture.componentInstance.tab()]).toEqual([false, 'posted']);
		expect(fixture.nativeElement.querySelector('#vouchers_tab_posted')?.classList.contains('active')).toBe(true);
		configure(null);
		TestBed.overrideComponent(VouchersListPage, { set: { template: '' } });
		const bare = TestBed.createComponent(VouchersListPage).componentInstance;
		expect([bare.fromVoucherTabs, bare.tab()]).toEqual([false, 'posted']);
	});
});
