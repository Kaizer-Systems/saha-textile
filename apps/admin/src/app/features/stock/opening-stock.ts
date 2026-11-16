import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	RupeesPipe,
	ShortDatePipe,
	ShortDateTimePipe,
	apiProblem,
	downloadCsv,
	requestKey,
} from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { parseRupees } from '@features/purchasing/shared/payment-popup';
import { metresText } from '@features/purchasing/shared/purchasing-labels';
import { parseCsv } from '@features/purchasing/shared/sheet-rows';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PluralPipe, translateCount } from '@shared/pipes/language.pipes';

import type { OpeningStockCheckResult, OpeningStockRow } from '@saha-textile/contracts';

type RowResult = OpeningStockCheckResult['rows'][number]['result'];

/** A date as people type it in a sheet: 2026-03-14, 14/03/2026, 14-03-2026 or 14.03.2026 → `2026-03-14`; null if unreadable. */
export function sheetDate(text: string): string | null {
	const value = text.trim();
	let year: number;
	let month: number;
	let day: number;
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
	const indian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
	if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
	else if (indian) [day, month, year] = [Number(indian[1]), Number(indian[2]), Number(indian[3])];
	else return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	// 31/02/2026 rolls into March in Date: refuse it instead of moving the day.
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface OpeningSheet {
	rows: OpeningStockRow[];
	/** A translation key, with its params, when the sheet cannot be checked at all. */
	problem: { key: string; params?: Record<string, unknown> } | null;
}

/**
 * Sheet rows → opening stock rows, columns found by their heading: SKU, quantity (pieces, or
 * metres for fabric sold by the metre), cost each, received on, note. Row numbers are the
 * spreadsheet's own (heading = row 1), so a problem points at the line to fix.
 */
export function openingRows(table: readonly string[][]): OpeningSheet {
	const [heading, ...body] = table;
	if (!heading) return { rows: [], problem: { key: 'import_empty' } };
	const find = (pattern: RegExp) => heading.findIndex((cell) => pattern.test(cell.trim()));
	const sku = find(/^sku/i);
	const quantity = find(/^(qty|quantity|pieces|pcs|metres|meters)/i);
	const cost = find(/^(cost|unit.?cost)/i);
	const received = find(/^(received|date)/i);
	const note = find(/^note/i);
	if (sku < 0 || quantity < 0) return { rows: [], problem: { key: 'opening_columns_missing' } };
	const rows: OpeningStockRow[] = [];
	const unreadable: number[] = [];
	body.forEach((cells, index) => {
		const code = (cells[sku] ?? '').trim();
		if (!code) return;
		const typed = (cells[quantity] ?? '').replace(/[,\s]/g, '');
		const qty = typed === '' ? 0 : Number(typed);
		const dateText = received < 0 ? '' : (cells[received] ?? '').trim();
		const receivedOn = dateText ? sheetDate(dateText) : null;
		if (dateText && !receivedOn) unreadable.push(index + 2);
		rows.push({
			row: index + 2,
			sku: code,
			quantity: Number.isFinite(qty) ? qty : 0,
			unitCostINR: cost < 0 ? null : parseRupees(cells[cost] ?? ''),
			receivedOn,
			note: note < 0 ? '' : (cells[note] ?? '').trim().slice(0, 200),
		});
	});
	if (unreadable.length) {
		return {
			rows: [],
			problem: {
				key: 'opening_date_unreadable',
				params: { rows: unreadable.slice(0, 8).join(', ') + (unreadable.length > 8 ? '…' : '') },
			},
		};
	}
	if (rows.length > 20000) return { rows: [], problem: { key: 'opening_too_many_rows' } };
	return { rows, problem: rows.length ? null : { key: 'import_empty' } };
}

export const OPENING_PILL: Record<RowResult, string> = {
	ready: 'completed',
	cost_missing: 'pending',
	unknown_sku: 'danger',
	already_has_stock: 'danger',
	quantity_invalid: 'danger',
	date_invalid: 'danger',
	repeated: 'danger',
};

/**
 * Opening stock (o01): the one-time load of stock already in the shop, with its cost, so profit and
 * stock value are right from day one. Posting stays off until every row is Ready; each SKU can be
 * loaded once; after that, stock only moves through documents.
 */
@Component({
	selector: 'app-opening-stock',
	templateUrl: './opening-stock.html',
	imports: [PageWrapper, PluralPipe, RupeesPipe, ShortDatePipe, ShortDateTimePipe, TranslocoModule],
})
export class OpeningStock {
	private readonly gateway = inject(StockGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	readonly loads = injectQuery(() => ({
		queryKey: STOCK_KEYS.opening,
		queryFn: () => firstValueFrom(this.gateway.openingLoads()),
	}));
	readonly fileName = signal('');
	readonly rows = signal<OpeningStockRow[]>([]);
	readonly check = signal<OpeningStockCheckResult | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly pill = OPENING_PILL;
	private key = requestKey('opening');

	readonly allReady = computed(() => {
		const check = this.check();
		return !!check && check.rows.length > 0 && check.rows.every((row) => row.result === 'ready');
	});

	/** "4,630 pieces", "42.5 m", or both joined the reader's way. */
	readonly readyUnits = computed(() => {
		const counts = this.check()?.counts;
		if (!counts) return '';
		const parts: string[] = [];
		if (counts.readyPieces || !counts.readyTenths) {
			parts.push(translateCount(this.transloco, 'qty_pieces', counts.readyPieces));
		}
		if (counts.readyTenths) {
			parts.push(metresText(counts.readyTenths, (key, params) => this.transloco.translate(key, params)));
		}
		const lang = this.transloco.getActiveLang();
		return new Intl.ListFormat(lang === 'en' ? 'en-IN' : lang, { type: 'conjunction' }).format(parts);
	});

	template(): void {
		downloadCsv(
			'opening-stock-template.csv',
			['SKU', 'Quantity', 'Cost each', 'Received on', 'Note'],
			[
				['ST-BAN-0412', '2', '8200', '2026-03-14', ''],
				['ST-FAB-0007', '42.5', '160', '14/03/2026', 'Roll on the top shelf'],
			],
		);
	}

	async read(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		// Clear the picker so choosing the same, corrected file again still triggers a read.
		input.value = '';
		if (!file) return;
		this.reset();
		this.fileName.set(file.name);
		if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
			this.error.set(this.transloco.translate('import_csv_only'));
			return;
		}
		const sheet = openingRows(parseCsv(await file.text()));
		if (sheet.problem) {
			this.error.set(this.transloco.translate(sheet.problem.key, sheet.problem.params ?? {}));
			return;
		}
		this.rows.set(sheet.rows);
		await this.runCheck();
	}

	/** A cost filled in on the screen (instead of in the sheet) is checked again at once. */
	async setCost(rowNumber: number, text: string): Promise<void> {
		const value = parseRupees(text);
		if (value === null) return;
		this.rows.update((rows) => rows.map((row) => (row.row === rowNumber ? { ...row, unitCostINR: value } : row)));
		await this.runCheck();
	}

	async runCheck(): Promise<void> {
		if (!this.rows().length) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			this.check.set(await firstValueFrom(this.gateway.checkOpening(this.rows())));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	/** Cancel: drop the uploaded sheet and start again. */
	reset(): void {
		this.rows.set([]);
		this.check.set(null);
		this.fileName.set('');
		this.error.set(null);
		this.key = requestKey('opening');
	}

	async post(): Promise<void> {
		if (!this.allReady() || this.busy()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const load = await firstValueFrom(this.gateway.postOpening(this.rows(), this.key));
			this.notifier.showSuccess(
				translateCount(this.transloco, 'opening_posted', load.rows.length, { number: load.number }),
			);
			this.reset();
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.opening });
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
			// Stock moved meanwhile, or another load took a SKU: show the rows as they stand now.
			await this.runCheck();
			this.error.set(message);
		} finally {
			this.busy.set(false);
		}
	}
}
