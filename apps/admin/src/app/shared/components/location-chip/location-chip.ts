import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbDropdown, NgbDropdownItem, NgbDropdownMenu, NgbDropdownToggle } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';

/**
 * The header's location chip (accounts brief L2, L3; owner-approved 2026-11-23). Owners and admins switch the
 * location or pick All locations, and every list follows (the API enforces it); staff see a fixed chip with a lock.
 * Built from ngbDropdown, as the language switch is; no styles of its own.
 */
@Component({
	selector: 'app-location-chip',
	imports: [TranslocoModule, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu, NgbDropdownItem],
	templateUrl: './location-chip.html',
})
export class LocationChipComponent {
	private readonly gateway = inject(LocationsGateway);
	private readonly queryClient = inject(QueryClient);
	readonly query = injectQuery(() => ({
		queryKey: LOCATION_KEYS.chip,
		queryFn: () => firstValueFrom(this.gateway.chip()),
	}));

	async pick(locationId: string | null): Promise<void> {
		const chip = await firstValueFrom(this.gateway.switchTo(locationId));
		this.queryClient.setQueryData(LOCATION_KEYS.chip, chip);
		// Every list follows the chip: refetch whatever is on screen.
		await this.queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'locations' });
	}
}
