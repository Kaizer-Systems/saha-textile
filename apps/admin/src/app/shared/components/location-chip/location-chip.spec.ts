import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LocationsGateway } from '@core/locations/locations.gateway';

import { LocationChipComponent } from './location-chip';

import type { LocationChip } from '@saha-textile/contracts';

async function render(chip: LocationChip) {
	TestBed.configureTestingModule({
		imports: [LocationChipComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: LocationsGateway, useValue: { chip: () => of(chip), switchTo: vi.fn(() => of(chip)) } },
		],
	});
	const fixture = TestBed.createComponent(LocationChipComponent);
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		fixture.detectChanges();
	}
	return fixture.nativeElement as HTMLElement;
}

describe('the header location chip (accounts brief L2, L3)', () => {
	it('is fixed with a lock for staff who may not switch', async () => {
		const el = await render({
			current: { id: 'a', name: 'Barasat store', shortCode: 'BAR' },
			allLocations: false,
			choices: [{ id: 'a', name: 'Barasat store', shortCode: 'BAR' }],
			maySwitch: false,
			maySeeAll: false,
		});
		const chip = el.querySelector('#location_chip') as HTMLButtonElement;
		expect(chip.disabled).toBe(true);
		expect(chip.textContent).toContain('Barasat store');
		expect(el.querySelector('.ri-lock-line')).not.toBeNull();
	});
	it('opens a menu with All locations for owners', async () => {
		const el = await render({
			current: null,
			allLocations: true,
			choices: [{ id: 'a', name: 'Barasat store', shortCode: 'BAR' }],
			maySwitch: true,
			maySeeAll: true,
		});
		expect(el.querySelector('#location_chip [ngbDropdownToggle], #location_chip button')).not.toBeNull();
		expect(el.querySelector('.ri-lock-line')).toBeNull();
	});
});
