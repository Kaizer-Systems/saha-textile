import { HttpClient } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { apiProblem, saveBlob } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import type { ExportColumn, ExportFormat, ExportRequestInput } from '@saha-textile/contracts';

type Cell = string | number | null;

/** What a screen exports: the same file name, header and rows its CSV download used, with the filters it had. */
export interface ExportSource {
	/** Without the extension: `trial-balance_2026-11-25`. */
	fileName: string;
	title: string;
	header: readonly string[];
	rows: ReadonlyArray<ReadonlyArray<Cell>>;
	filters?: ReadonlyArray<{ label: string; value: string }>;
	/** A column's kind by its place; numbers and `YYYY-MM-DD` dates are found by themselves. */
	kinds?: Readonly<Record<number, ExportColumn['kind']>>;
	area?: 'accounts' | 'other';
}

/** The shape of a screen's CSV writer (`downloadCsv`), so its own code can feed the Export menu too. */
export type CsvWriter = (fileName: string, header: readonly string[], rows: ReadonlyArray<ReadonlyArray<Cell>>) => void;

/** A screen's CSV code run once with a stand-in writer: what it would have saved, as an export. */
export function captured(
	title: string,
	area: 'accounts' | 'other',
	write: (save: CsvWriter) => void,
): ExportSource | null {
	let out: ExportSource | null = null;
	write((fileName, header, rows) => {
		out = { fileName, title, header, rows, area };
	});
	return out;
}

const MONEY_WORDS = /₹|amount|total|debit|credit|balance|value|paid|due|tax|price|cost|gross|net/i;

/** Each column's kind: as given, else money for numbers under a money heading, number, date, or text. */
export function exportColumns(source: ExportSource): ExportColumn[] {
	return source.header.map((label, i) => {
		const given = source.kinds?.[i];
		if (given) return { key: `c${i}`, label, kind: given };
		const values = source.rows.map((row) => row[i]).filter((v) => v !== null && v !== '');
		const numbers = values.length > 0 && values.every((v) => typeof v === 'number');
		const dates = values.length > 0 && values.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
		const kind: ExportColumn['kind'] = numbers
			? MONEY_WORDS.test(label)
				? 'money'
				: 'number'
			: dates
				? 'date'
				: 'text';
		return { key: `c${i}`, label, kind };
	});
}

/** The export request for a screen's rows in one format. */
export function exportRequest(source: ExportSource, format: ExportFormat): ExportRequestInput {
	const columns = exportColumns(source);
	return {
		format,
		title: source.title,
		fileName:
			source.fileName
				.toLowerCase()
				.replace(/\.csv$/, '')
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 80) || 'export',
		filters: [...(source.filters ?? [])],
		columns,
		rows: source.rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.key, row[i] ?? null]))),
		area: source.area ?? 'other',
	};
}

/**
 * Export ▾ (brief 25 EX1): CSV, Excel or PDF of what the screen shows, written by the API (accounts exports are logged
 * there). Replaces the lists' "Download CSV" buttons, keeping CSV in it.
 */
@Component({
	selector: 'app-export-menu',
	imports: [NgbDropdownModule, TranslocoModule],
	template: `
		<div
			ngbDropdown
			class="d-inline-block"
			placement="bottom-end"
		>
			<button
				type="button"
				class="btn btn-outline"
				ngbDropdownToggle
				[id]="id()"
				[disabled]="busy() || disabled()"
			>
				<i class="ri-download-2-line"></i>
				{{ 'export_menu' | transloco }}
			</button>
			<div ngbDropdownMenu>
				@for (f of formats(); track f) {
					<button
						ngbDropdownItem
						type="button"
						[id]="id() + '_' + f"
						(click)="run(f)"
					>
						{{ 'export_as_' + f | transloco }}
					</button>
				}
			</div>
		</div>
	`,
})
export class ExportMenu {
	private readonly http = inject(HttpClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	/** Gives the rows to export when a format is picked (null: nothing to export yet); may fetch every page first. */
	readonly source = input.required<() => ExportSource | null | Promise<ExportSource | null>>();
	readonly id = input('export_menu');
	readonly disabled = input(false);
	/** The formats offered; a statement with its own printed layout leaves PDF to that. */
	readonly formats = input<ExportFormat[]>(['csv', 'xlsx', 'pdf']);
	readonly busy = signal(false);

	async run(format: ExportFormat): Promise<void> {
		this.busy.set(true);
		try {
			const source = await this.source()();
			if (!source) return;
			const request = exportRequest(source, format);
			const blob = await firstValueFrom(
				this.http.post(`${runtimeConfig.apiUrl}/admin/exports`, request, { responseType: 'blob' }),
			);
			saveBlob(`${request.fileName}.${format}`, blob);
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`export_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
