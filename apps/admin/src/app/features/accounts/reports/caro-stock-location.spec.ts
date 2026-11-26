import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { yearToDate } from '@features/accounts/books-export-page';

import { CaroStockPage } from './caro-stock-page';

/** The CARO stock report for one location's counts, or every count (brief 25 SC2). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const EMPTY = { from: '2026-04-01', to: '2026-11-25', counts: [], reportable: 0 };

async function opened() {
	TestBed.resetTestingModule();
	const caroStock = vi.fn(() => of(EMPTY));
	TestBed.configureTestingModule({
		imports: [
			CaroStockPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ReportsGateway, useValue: { caroStock } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{
				provide: LocationsGateway,
				useValue: {
					list: vi.fn(() =>
						of([
							{ id: 'loc_barasat', name: 'Barasat', active: true },
							{ id: 'loc_hq', name: 'Head office', active: true },
						]),
					),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(CaroStockPage);
	fixture.detectChanges();
	await settle(fixture);
	return { fixture, page: fixture.componentInstance, caroStock };
}

const location = (fixture: { nativeElement: HTMLElement }) =>
	fixture.nativeElement.querySelector('#caro_location') as HTMLSelectElement;

describe('the CARO stock report by location (SC2)', () => {
	it('reads every location’s counts first, and offers each location by name', async () => {
		const { fixture, caroStock } = await opened();
		expect(caroStock).toHaveBeenCalledWith(yearToDate());
		expect(location(fixture).getAttribute('aria-label')).toBe('caro_location');
		expect([...location(fixture).options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['', 'count_every_location'],
			['loc_barasat', 'Barasat'],
			['loc_hq', 'Head office'],
		]);
	});

	it('reads one location’s counts when it is picked, and every location’s again when cleared', async () => {
		const { fixture, page, caroStock } = await opened();
		location(fixture).value = 'loc_hq';
		location(fixture).dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(page.locationId()).toBe('loc_hq');
		expect(caroStock).toHaveBeenLastCalledWith({ ...yearToDate(), locationId: 'loc_hq' });
		location(fixture).value = '';
		location(fixture).dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(caroStock).toHaveBeenLastCalledWith(yearToDate());
	});

	it('keys and asks for one location’s report with the location on the address', () => {
		const query = { from: '2026-04-01', to: '2026-11-25', locationId: 'loc_hq' };
		expect(REPORT_KEYS.caroStock(query)).toEqual(['reports', 'caro-stock', query]);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const http = TestBed.inject(HttpTestingController);
		TestBed.inject(ReportsGateway).caroStock(query).subscribe();
		http.expectOne(
			(req) =>
				req.method === 'GET' &&
				req.urlWithParams ===
					`${runtimeConfig.apiUrl}/admin/accounts/reports/caro-stock?from=2026-04-01&to=2026-11-25&locationId=loc_hq`,
		).flush(EMPTY);
		http.verify();
	});
});
