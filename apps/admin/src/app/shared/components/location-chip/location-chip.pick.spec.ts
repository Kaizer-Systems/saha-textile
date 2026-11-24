import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';

import { LocationChipComponent } from './location-chip';

describe('picking a location on the header chip', () => {
	it('keeps the chip the API answered and refreshes every list but the locations', async () => {
		const chosen = { current: { id: 'b', name: 'Barasat store', shortCode: 'BAR' }, allLocations: false };
		const gateway = { chip: vi.fn(() => of(chosen)), switchTo: vi.fn(() => of(chosen)) };
		const queries = new QueryClient();
		const refreshed = vi.spyOn(queries, 'invalidateQueries');
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [LocationChipComponent],
			providers: [provideTanStackQuery(queries), { provide: LocationsGateway, useValue: gateway }],
		});
		TestBed.overrideComponent(LocationChipComponent, { set: { imports: [], template: '' } });
		const chip = TestBed.createComponent(LocationChipComponent).componentInstance;
		await chip.pick('b');
		expect(gateway.switchTo).toHaveBeenCalledWith('b');
		expect(queries.getQueryData(LOCATION_KEYS.chip)).toEqual(chosen);
		const predicate = refreshed.mock.lastCall?.[0]?.predicate;
		expect(predicate?.({ queryKey: ['orders'] } as never)).toBe(true);
		expect(predicate?.({ queryKey: ['locations', 'chip'] } as never)).toBe(false);
	});
});
