import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BooksImportGateway } from '@core/accounts/books-import.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, saveBlob } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BooksExportFormat } from '@saha-textile/contracts';

export const EXPORT_FORMATS: readonly BooksExportFormat[] = [
	'tally_xml',
	'trial_balance_csv',
	'ledger_lines_csv',
	'edit_log_csv',
];

/** This financial year so far: 1 April to today (India). */
export function yearToDate(now = new Date()): { from: string; to: string } {
	const to = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
	const y = Number(to.slice(0, 4));
	return { from: to.slice(5) >= '04-01' ? `${y}-04-01` : `${y - 1}-04-01`, to };
}

/**
 * Export the books (accounts brief W4): for the CA, an auditor or another program. Every export is logged; personal
 * numbers never leave. The PDF set and the GST portal files come from Reports and the GST pages.
 */
@Component({
	selector: 'app-books-export-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './books-export-page.html',
})
export class BooksExportPage {
	private readonly gateway = inject(BooksImportGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);

	readonly formats = EXPORT_FORMATS;
	readonly format = signal<BooksExportFormat>('tally_xml');
	readonly from = signal(yearToDate().from);
	readonly to = signal(yearToDate().to);
	readonly locationId = signal('');
	readonly busy = signal(false);
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));

	async make(): Promise<void> {
		this.busy.set(true);
		try {
			const file = await firstValueFrom(
				this.gateway.export({
					format: this.format(),
					from: this.from(),
					to: this.to(),
					...(this.locationId() ? { locationId: this.locationId() } : {}),
				}),
			);
			const type = file.fileName.endsWith('.xml') ? 'application/xml' : 'text/csv';
			saveBlob(file.fileName, new Blob([file.text], { type: `${type};charset=utf-8` }));
			this.notifier.showSuccess(this.transloco.translate('export_made'));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`import_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
