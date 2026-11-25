import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LocationsGateway } from '@core/locations/locations.gateway';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CountPage } from './count-page';

import type { StockCount } from '@saha-textile/contracts';

/** Where a stock count is taken, named beside its number (brief 25 SC1): one location, or every location. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const count = (locationId: string | null): StockCount =>
	({
		id: 'cnt_1',
		number: 'SC/26-27/000004',
		label: 'Year end',
		scope: { kind: 'all', categoryIds: [], variantIds: [] },
		locationId,
		blind: true,
		counterIds: [],
		counterNames: [],
		status: 'open',
		startedAt: '2026-11-25T06:00:00.000Z',
		startedBy: 'adm_1',
		lines: [],
		totals: { skus: 0, counted: 0, differences: 0 },
	}) as unknown as StockCount;

function mount(locationId: string | null, locations: unknown = [{ id: 'loc_b', name: 'Barasat', active: true }]) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			CountPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'cnt_1' }) } } },
			{ provide: StockGateway, useValue: { count: vi.fn(() => of(count(locationId))) } },
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => (locations === null ? NEVER : of(locations))) },
			},
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{
				provide: AuthStore,
				useValue: { permissions: signal(['stock_count.post']), user: signal({ id: 'adm_1' }) },
			},
		],
	});
	TestBed.overrideComponent(CountPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(CountPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

describe('where a stock count is taken, beside its number (SC1)', () => {
	it('says every location for a count with none, and names the location of one that has it', async () => {
		const everywhere = mount(null);
		await settle(everywhere.fixture);
		expect(everywhere.page.where()).toEqual({ every: true, name: '' });
		const barasat = mount('loc_b');
		await settle(barasat.fixture);
		expect(barasat.page.where()).toEqual({ every: false, name: 'Barasat' });
	});

	it('names nothing while the locations load, before the count is read, or for a location no longer listed', async () => {
		const loading = mount('loc_b', null);
		expect(loading.page.where()).toEqual({ every: true, name: '' });
		await settle(loading.fixture);
		expect(loading.page.where()).toEqual({ every: false, name: '' });
		const gone = mount('loc_gone');
		await settle(gone.fixture);
		expect(gone.page.where()).toEqual({ every: false, name: '' });
	});
});
