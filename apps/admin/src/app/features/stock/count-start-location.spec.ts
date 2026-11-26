import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';

import { CountStart } from './count-start';

/** Where a stock count is taken (brief 25 SC1): one warehouse, or every location. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const LOCATIONS = [
	{ id: 'loc_barasat', name: 'Barasat', active: true, warehouse: true },
	{ id: 'loc_counter', name: 'Shop counter', active: true, warehouse: false },
	{ id: 'loc_old', name: 'Old godown', active: false, warehouse: true },
	{ id: 'loc_hq', name: 'Head office store', active: true, warehouse: true },
];

async function opened() {
	TestBed.resetTestingModule();
	const startCount = vi.fn(() => of({ id: 'cnt_9' }));
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.configureTestingModule({
		imports: [
			CountStart,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: StockGateway, useValue: { startCount } },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of(LOCATIONS)) } },
			{ provide: AdminUsersGateway, useValue: { list: vi.fn(() => of({ items: [] })) } },
			{ provide: CategoryService, useValue: { getCategoryRows: vi.fn(() => of([])) } },
			{
				provide: AuthStore,
				useValue: { permissions: () => ['stock_count.post'], user: () => ({ id: 'adm_1' }) },
			},
			{ provide: NgbActiveModal, useValue: modal },
		],
	});
	// The category and counter pickers and the SKU search are drawn by their own components; only the form is drawn here.
	TestBed.overrideComponent(CountStart, {
		set: { imports: [FormsModule, TranslocoModule], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(CountStart);
	fixture.detectChanges();
	await settle(fixture);
	return { fixture, page: fixture.componentInstance, startCount, modal };
}

const where = (fixture: { nativeElement: HTMLElement }) =>
	fixture.nativeElement.querySelector('#count_where') as HTMLSelectElement;

describe('where a stock count is taken (SC1)', () => {
	it('offers every location, or one active warehouse, with a line saying what it means', async () => {
		const { fixture, page } = await opened();
		expect(page.warehouses.data()?.map((l) => l.id)).toEqual(['loc_barasat', 'loc_hq']);
		expect([...where(fixture).options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['', 'count_every_location'],
			['loc_barasat', 'Barasat'],
			['loc_hq', 'Head office store'],
		]);
		expect(fixture.nativeElement.querySelector('label[for="count_where"]')?.textContent).toContain('count_where');
		expect(where(fixture).parentElement?.querySelector('.help-text')?.textContent).toContain('count_where_help');
		expect(page.locationId()).toBe('');
	});

	it('starts a count everywhere with no location, and at the warehouse picked', async () => {
		const { fixture, page, startCount, modal } = await opened();
		await page.start();
		expect(startCount).toHaveBeenLastCalledWith(expect.objectContaining({ locationId: null }));
		where(fixture).value = 'loc_hq';
		where(fixture).dispatchEvent(new Event('change'));
		expect(page.locationId()).toBe('loc_hq');
		await page.start();
		expect(startCount).toHaveBeenLastCalledWith({
			scope: { kind: 'all', categoryIds: [], variantIds: [] },
			locationId: 'loc_hq',
			blind: true,
			counterIds: [],
			label: '',
		});
		expect(modal.close).toHaveBeenLastCalledWith({ id: 'cnt_9' });
	});
});
