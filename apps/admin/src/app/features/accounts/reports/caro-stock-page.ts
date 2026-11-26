import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';

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
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, ExportMenu],
	templateUrl: './caro-stock-page.html',
})
export class CaroStockPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly transloco = inject(TranslocoService);

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

	/** EX1: the report as the screen shows it, with its period and location written above the table. */
	readonly exportSource = (): ExportSource | null => {
		const report = this.report.data();
		if (!report) return null;
		const t = (key: string) => this.transloco.translate(key);
		const where = this.locations.data()?.find((l) => l.id === this.locationId())?.name ?? t('count_every_location');
		return {
			fileName: `caro-stock_${report.from}_${report.to}`,
			title: t('report_caro_stock'),
			area: 'accounts',
			filters: [
				{ label: t('export_from'), value: shortDate(report.from) },
				{ label: t('export_to'), value: shortDate(report.to) },
				{ label: t('caro_location'), value: where },
			],
			header: [
				t('caro_col_count'),
				t('caro_col_posted'),
				t('caro_col_class'),
				t('caro_col_book'),
				t('caro_col_counted'),
				t('caro_col_difference'),
				'%',
				t('caro_col_value'),
				t('caro_report_it'),
			],
			rows: report.counts.flatMap((c) =>
				c.classes.map((k) => [
					`${c.number} · ${c.label}`,
					c.postedAt.slice(0, 10),
					t(`caro_class_${k.soldBy}`),
					caroQty(k, k.bookQty),
					caroQty(k, k.countedQty),
					caroQty(k, k.differenceQty),
					k.percent,
					k.differenceINR,
					k.reportable ? t('yes') : '',
				]),
			),
			kinds: { 7: 'money' },
		};
	};
}
