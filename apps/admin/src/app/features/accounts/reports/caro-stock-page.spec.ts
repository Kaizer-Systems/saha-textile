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
import { yearToDate } from '@features/accounts/books-export-page';

import { CaroStockPage, caroQty } from './caro-stock-page';
import { REPORT_LIBRARY } from './reports-library';

/** CARO 2020 3(ii)(a): stock counts in a period, each class against the 10% line. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const klass = (soldBy: string, over: Record<string, unknown> = {}) => ({
	soldBy,
	bookQty: 0,
	countedQty: 0,
	differenceQty: 0,
	percent: null,
	differenceINR: 0,
	reportable: false,
	...over,
});
const REPORT = {
	from: '2026-04-01',
	to: '2026-11-24',
	counts: [
		{
			id: 'sc1',
			number: 'SC/26-27/000004',
			label: 'Barasat, sarees',
			postedAt: '2026-10-31T12:00:00.000Z',
			classes: [
				klass('piece', {
					bookQty: 120,
					countedQty: 105,
					differenceQty: -15,
					percent: 12.5,
					differenceINR: -45_000,
					reportable: true,
				}),
				klass('metre', {
					bookQty: 2_500,
					countedQty: 2_475,
					differenceQty: -25,
					percent: 1,
					differenceINR: -1_250,
				}),
			],
		},
		{
			id: 'sc2',
			number: 'SC/26-27/000005',
			label: 'Head office',
			postedAt: '2026-11-15T12:00:00.000Z',
			classes: [klass('piece')],
		},
	],
	reportable: 1,
};

function mount(caroStock: ReturnType<typeof vi.fn>) {
	TestBed.resetTestingModule();
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
		],
	});
	const fixture = TestBed.createComponent(CaroStockPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const enter = (control: HTMLElement | null, value: string) => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event('input'));
};

describe('the CARO stock route and its place in the library', () => {
	it('names its key, reads the period, and is listed under stock', () => {
		const period = { from: '2026-04-01', to: '2026-11-24' };
		expect(REPORT_KEYS.caroStock(period)).toEqual(['reports', 'caro-stock', period]);
		expect(REPORT_LIBRARY.find((g) => g.group === 'stock')?.items.map((i) => i.key)).toContain('caro_stock');
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ReportsGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.caroStock(period).subscribe();
		http.expectOne(
			(req) =>
				req.method === 'GET' &&
				req.urlWithParams ===
					`${runtimeConfig.apiUrl}/admin/accounts/reports/caro-stock?from=2026-04-01&to=2026-11-24`,
		).flush({});
		http.verify();
	});
});

describe('a class’s quantity', () => {
	it('shows fabric in metres from tenths and pieces as whole pieces', () => {
		expect(caroQty({ soldBy: 'metre' }, 25)).toBe('2.5 m');
		expect(caroQty({ soldBy: 'metre' }, 12_340)).toBe('1,234 m');
		expect(caroQty({ soldBy: 'piece' }, 3)).toBe('3 pc');
		expect(caroQty({ soldBy: 'piece' }, -15)).toBe('-15 pc');
	});
});

describe('the CARO stock page', () => {
	it('reads this year so far and warns of each class over the 10% line', async () => {
		const caroStock = vi.fn(() => of(REPORT));
		const { fixture, page } = mount(caroStock);
		await settle(fixture);
		expect(caroStock).toHaveBeenCalledWith(yearToDate());
		const alert = el(fixture, '.alert') as HTMLElement;
		expect([alert.classList.contains('alert-warning'), alert.classList.contains('alert-success')]).toEqual([
			true,
			false,
		]);
		const rows = [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
		expect(rows).toHaveLength(3);
		expect(rows[0]?.textContent).toContain('SC/26-27/000004 · Barasat, sarees');
		expect(rows[0]?.textContent).toContain('-15 pc');
		expect(rows[0]?.textContent).toContain('12.5');
		expect(rows[0]?.querySelector('.badge')?.textContent).toContain('caro_report_it');
		expect(rows[1]?.textContent).toContain('247.5 m');
		expect(rows[1]?.querySelector('.badge')).toBeNull();
		expect(rows[2]?.textContent).toContain('—');
		expect(page.day('2026-10-31T12:00:00.000Z')).toBeTruthy();
	});

	it('says all is well when no class is over the line, and that there were no counts', async () => {
		const { fixture } = mount(vi.fn(() => of({ ...REPORT, counts: [], reportable: 0 })));
		await settle(fixture);
		expect(el(fixture, '.alert')?.classList.contains('alert-success')).toBe(true);
		expect(el(fixture, 'tbody td[colspan]')).not.toBeNull();
	});

	it('reads another period, and nothing while a day is missing or the days are the wrong way round', async () => {
		const caroStock = vi.fn(() => of(REPORT));
		const { fixture } = mount(caroStock);
		await settle(fixture);
		enter(el(fixture, '#caro_from'), '2026-10-01');
		enter(el(fixture, '#caro_to'), '2026-10-31');
		await settle(fixture);
		expect(caroStock).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
		const reads = caroStock.mock.calls.length;
		enter(el(fixture, '#caro_from'), '2026-11-01');
		await settle(fixture);
		enter(el(fixture, '#caro_to'), '');
		await settle(fixture);
		enter(el(fixture, '#caro_from'), '');
		enter(el(fixture, '#caro_to'), '2026-10-31');
		await settle(fixture);
		expect(caroStock).toHaveBeenCalledTimes(reads);
	});
});
