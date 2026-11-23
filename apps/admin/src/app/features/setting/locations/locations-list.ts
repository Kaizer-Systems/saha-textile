import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { gstStateName } from '@saha-textile/core-domain/company';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

/**
 * Settings › Locations (accounts brief K1; owner-approved 2026-11-23): every warehouse, store and office with
 * its kinds, address, GSTIN and people. Stock value per location arrives with stock by location (F4).
 */
@Component({
	selector: 'app-locations-list',
	imports: [PageWrapper, TranslocoModule, RouterLink],
	templateUrl: './locations-list.html',
})
export class LocationsListPage {
	private readonly gateway = inject(LocationsGateway);
	private readonly company = inject(CompanyGateway);
	private readonly auth = inject(AuthStore);
	readonly canEdit = computed(() => this.auth.permissions().includes('location.edit'));
	readonly query = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.gateway.list()),
	}));
	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));

	/** The State's name, as the State picker shows it ("Tripura"), not its GST code. */
	stateName(code: string): string {
		return gstStateName(code) ?? code;
	}

	gstinOf(id: string | null): string {
		return (id && this.registrations.data()?.find((r) => r.id === id)?.gstin) || '—';
	}
}
