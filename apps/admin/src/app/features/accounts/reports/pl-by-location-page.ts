import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';

import { accountsRange } from '../accounts-period';
import { indent, statementFigure } from './statement-page';

import type { PlByLocation } from '@saha-textile/contracts';

/** Profit and loss by location (accounts brief U3): each location's own profit, the head office's costs on their own. */
@Component({
	selector: 'app-pl-by-location-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker],
	templateUrl: './pl-by-location-page.html',
})
export class PlByLocationPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly transloco = inject(TranslocoService);

	readonly presets = ACCOUNTS_PRESETS;
	readonly figure = statementFigure;
	readonly indent = indent;
	readonly range = signal(accountsRange({ period: 'this_fy' }));
	readonly report = injectQuery(() => {
		const query = this.range();
		return {
			queryKey: REPORT_KEYS.plByLocation(query),
			queryFn: () => firstValueFrom(this.gateway.plByLocation(query)),
		};
	});

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
	}

	download(r: PlByLocation): void {
		downloadCsv(
			`pl-by-location_${r.from}_${r.to}.csv`,
			['', ...r.locations.map((l) => l.name), this.transloco.translate('total')],
			r.rows.map((row) => [
				`${'  '.repeat(row.depth)}${row.label}`,
				...r.locations.map((l) => (row.byLocation[l.id] ?? 0) / 100),
				row.totalPaise / 100,
			]),
		);
	}
}
