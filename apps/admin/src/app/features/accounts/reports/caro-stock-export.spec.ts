import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReportsGateway } from '@core/accounts/reports.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';

import { CaroStockPage } from './caro-stock-page';

/** The CARO stock report through the Export menu (brief 25 EX1): each class of each count, with the period and place. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const klass = (soldBy: string, over: Record<string, unknown> = {}) => ({
	soldBy,
	bookQty: 120,
	countedQty: 105,
	differenceQty: -15,
	percent: 12.5,
	differenceINR: -45_000,
	reportable: true,
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
				klass('piece'),
				klass('metre', {
					bookQty: 2_500,
					countedQty: 2_475,
					differenceQty: -25,
					percent: null,
					differenceINR: -1_250,
					reportable: false,
				}),
			],
		},
	],
	reportable: 1,
};

function mount(options: { report?: unknown; locations?: unknown } = {}) {
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
			{
				provide: ReportsGateway,
				useValue: { caroStock: vi.fn(() => (options.report === null ? NEVER : of(options.report ?? REPORT))) },
			},
			{
				provide: LocationsGateway,
				useValue: {
					list: vi.fn(() =>
						options.locations === null
							? NEVER
							: of(options.locations ?? [{ id: 'loc_b', name: 'Barasat', active: true }]),
					),
				},
			},
		],
	});
	// The Export menu is its own component; this page hands it the source and whether there is anything yet.
	TestBed.overrideComponent(CaroStockPage, {
		remove: { imports: [ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(CaroStockPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

describe('the CARO stock report for the Export menu (EX1)', () => {
	it('has nothing to export, and its menu is off, until the report is read', () => {
		const { fixture, page } = mount({ report: null });
		expect(page.exportSource()).toBeNull();
		const menu = fixture.nativeElement.querySelector('#caro_export') as HTMLElement & { disabled: boolean };
		expect(menu.disabled).toBe(true);
	});

	it('writes each class of each count with its quantities, percent, value and whether to report it', async () => {
		const { fixture, page } = mount();
		await settle(fixture);
		expect(
			(fixture.nativeElement.querySelector('#caro_export') as HTMLElement & { disabled: boolean }).disabled,
		).toBe(false);
		expect(fixture.nativeElement.querySelector('h5.mb-1')?.textContent?.trim()).toBe('caro_clause');
		const source = page.exportSource();
		expect(source).toMatchObject({
			fileName: 'caro-stock_2026-04-01_2026-11-24',
			title: 'report_caro_stock',
			area: 'accounts',
			kinds: { 7: 'money' },
			filters: [
				{ label: 'export_from', value: shortDate('2026-04-01') },
				{ label: 'export_to', value: shortDate('2026-11-24') },
				{ label: 'caro_location', value: 'count_every_location' },
			],
		});
		expect(source?.header).toHaveLength(9);
		expect(source?.rows).toEqual([
			[
				'SC/26-27/000004 · Barasat, sarees',
				'2026-10-31',
				'caro_class_piece',
				'120 pc',
				'105 pc',
				'-15 pc',
				12.5,
				-45_000,
				'yes',
			],
			[
				'SC/26-27/000004 · Barasat, sarees',
				'2026-10-31',
				'caro_class_metre',
				'250 m',
				'247.5 m',
				'-2.5 m',
				null,
				-1_250,
				'',
			],
		]);
	});

	it('names the location picked, or every location when it is not known or the locations are not read', async () => {
		const { fixture, page } = mount();
		await settle(fixture);
		page.locationId.set('loc_b');
		expect(page.exportSource()?.filters?.[2]).toEqual({ label: 'caro_location', value: 'Barasat' });
		page.locationId.set('loc_gone');
		expect(page.exportSource()?.filters?.[2]?.value).toBe('count_every_location');
		const unread = mount({ locations: null });
		await settle(unread.fixture);
		unread.page.locationId.set('loc_b');
		expect(unread.page.exportSource()?.filters?.[2]?.value).toBe('count_every_location');
	});
});
