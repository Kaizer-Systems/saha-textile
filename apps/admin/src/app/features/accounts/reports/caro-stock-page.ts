import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { yearToDate } from '../books-export-page';

import type { CaroClassRow } from '@saha-textile/contracts';

/** A class's quantity as people read it: pieces whole, fabric in metres (kept in tenths). */
export function caroQty(row: Pick<CaroClassRow, 'soldBy'>, qty: number): string {
	return row.soldBy === 'metre'
		? `${(qty / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 })} m`
		: `${qty} pc`;
}

/** CARO 2020 3(ii)(a): stock counts posted in a period, each class's discrepancy against the 10% line. */
@Component({
	selector: 'app-caro-stock-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './caro-stock-page.html',
})
export class CaroStockPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly locationsGateway = inject(LocationsGateway);

	readonly qty = caroQty;
	readonly from = signal(yearToDate().from);
	readonly to = signal(yearToDate().to);
	/** SC2: one location's counts, or every count ('' for every location). */
	readonly locationId = signal('');
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	private query() {
		return { from: this.from(), to: this.to(), ...(this.locationId() ? { locationId: this.locationId() } : {}) };
	}
	readonly report = injectQuery(() => ({
		queryKey: REPORT_KEYS.caroStock(this.query()),
		queryFn: () => firstValueFrom(this.gateway.caroStock(this.query())),
		enabled: !!this.from() && !!this.to() && this.from() <= this.to(),
	}));

	day(iso: string): string {
		return shortDate(iso);
	}
}
