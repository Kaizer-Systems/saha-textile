import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsListsGateway } from '@core/accounts/accounts-lists.gateway';
import { AuthStore } from '@core/state/auth.store';

import { viewLink } from './accounts-list-columns';
import { AccountsOverviewPage, WAITING_LINKS, monthName } from './accounts-overview';

import type { AccountsOverview } from '@saha-textile/contracts';

/** Accounts › Overview (accounts brief Q0). */

const overview = (over: Partial<AccountsOverview> = {}): AccountsOverview => ({
	month: '2026-11',
	cashPaise: 882_400,
	cashLedgers: 3,
	cashBoxes: 0,
	bankPaise: 43_438_800,
	bankNames: ['HDFC'],
	customersPaise: 9_950_000,
	suppliersPaise: 41_000_000,
	gstPaise: 4_065_000,
	gstDueOn: '2026-12-20',
	monthLocked: false,
	lastLocked: '2026-10',
	profitPaise: 31_460_000,
	profitTo: '2026-11-24',
	stockPaise: 572_120_000,
	inTransitPaise: 4_620_000,
	codPaise: 0,
	waiting: [{ kind: 'voucherDrafts', count: 3 }],
	...over,
});

function setup(data: AccountsOverview, permissions = ['accounts.index', 'accounts.post']) {
	const gateway = { overview: vi.fn(() => of(data)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			AccountsOverviewPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: AccountsListsGateway, useValue: gateway },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	const fixture = TestBed.createComponent(AccountsOverviewPage);
	return { fixture, page: fixture.componentInstance, gateway };
}

const text = (fixture: { nativeElement: unknown }, id: string) =>
	(fixture.nativeElement as HTMLElement).querySelector(`#${id}`)?.textContent?.trim();

describe('the accounts overview', () => {
	it('shows the eight cards and what is waiting, each opening where it is worked on', async () => {
		const { fixture, page, gateway } = setup(overview());
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.overview.data()).toBeTruthy());
		fixture.detectChanges();
		expect(gateway.overview).toHaveBeenCalledWith(null);
		expect(text(fixture, 'ov_cash')).toBe('₹8,824');
		expect(text(fixture, 'ov_gst')).toBe('₹40,650');
		expect(text(fixture, 'ov_period')).toBe('ov_open_state');
		expect(page.monthLabel()).toBe('November');
		expect(page.nameOf('2026-10')).toBe('October');
		expect(text(fixture, 'ov_waiting')).toContain('ov_waiting_voucherDrafts');
		expect((fixture.nativeElement as HTMLElement).querySelector('#ov_new_voucher')).not.toBeNull();
		page.setMonth({ period: 'last_month' });
		expect(page.month()).toMatch(/^\d{4}-\d{2}$/);
	});

	it('shows input credit carried, a locked month, none locked, no stock in transit, and nothing waiting', async () => {
		const { fixture, page } = setup(
			overview({
				gstPaise: -120_000,
				monthLocked: true,
				lastLocked: null,
				inTransitPaise: 0,
				waiting: [],
				bankNames: [],
			}),
			[],
		);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.overview.data()).toBeTruthy());
		fixture.detectChanges();
		expect(text(fixture, 'ov_gst')).toBe('₹1,200');
		expect(text(fixture, 'ov_period')).toBe('ov_locked_state');
		expect(text(fixture, 'ov_waiting')).toBe('ov_nothing_waiting');
		expect(page.canPost()).toBe(false);
	});

	it('names months in either language, sends each waiting kind somewhere, and opens a voucher draft in its form', () => {
		expect(monthName('2026-11', 'bn')).not.toBe('November');
		expect(Object.keys(WAITING_LINKS)).toEqual([
			'voucherDrafts',
			'creditNoteDrafts',
			'selfInvoicesDue',
			'adjustmentsWaiting',
			'refundsFailed',
			'cashDifferences',
			'expenseClaims',
			'bankLinesToMatch',
			'paymentsNotInPayout',
		]);
		const label = setup(overview()).page.monthLabel();
		expect(label).toBe('');
		expect(viewLink({ id: 'vd_1', tab: 'journal', extra: { draft: 'voucher' } } as never)).toEqual([
			'/accounts/vouchers/drafts',
			'vd_1',
		]);
	});

	it('asks the API for a month', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), AccountsListsGateway],
		});
		const gateway = TestBed.inject(AccountsListsGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.overview('2026-10').subscribe();
		expect(http.expectOne((req) => req.url.endsWith('/admin/accounts/overview')).request.params.get('month')).toBe(
			'2026-10',
		);
		gateway.overview(null).subscribe();
		expect(http.expectOne((req) => req.url.endsWith('/admin/accounts/overview')).request.params.keys()).toEqual([]);
	});
});
