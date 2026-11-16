import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiProblem, downloadCsv } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';

import { DraftProductPopup } from './draft-product-popup';
import { DEFAULT_GST_PCT, lineFromItem, type EntryFormLine } from './entry-lines';
import { LineSearch } from '../shared/line-search';
import { IMPORT_TEMPLATE_EXAMPLE, IMPORT_TEMPLATE_HEADER, importRows, parseCsv } from '../shared/sheet-rows';

import type { PurchaseImportResult, PurchaseItemOption } from '@saha-textile/contracts';

type ResultRow = PurchaseImportResult['rows'][number];

/** One row as the popup shows it: the API's verdict, or a product picked here for a row that needed one. */
export interface ImportRowView extends ResultRow {
	picked: PurchaseItemOption | null;
}

/** Ready rows (and rows given a product here) as entry lines; problems never join the bill. */
export function readyLines(rows: readonly ImportRowView[]): EntryFormLine[] {
	return rows
		.filter((row) => row.result === 'ready' || (row.result === 'needs_product' && row.picked))
		.map((row) => {
			const item = (row.picked ?? row.match) as PurchaseItemOption;
			// A product picked here was not matched by the API, so its quantity is still as typed.
			const units = row.picked
				? item.soldBy === 'metre'
					? Math.round(row.quantity * 10)
					: row.quantity
				: row.quantity;
			const line = lineFromItem(item, units, row.unitPriceINR);
			return {
				...line,
				gstRatePct: row.gstRatePct ?? DEFAULT_GST_PCT,
				hsnOnBill: row.hsn || line.hsnOnBill,
			};
		});
}

/**
 * Import lines from the supplier's spreadsheet (p13): rows matched by SKU or the supplier's code,
 * grouped as Ready, Needs a product and Problems. Only ready rows are added; a row that needs a
 * product can be given one here (picked, or made as a draft).
 */
@Component({
	selector: 'app-import-popup',
	templateUrl: './import-popup.html',
	imports: [LineSearch, RupeesPipe, StockQuantityPipe, TranslocoModule],
})
export class ImportPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly supplierId = signal<string | null>(null);
	readonly fileName = signal('');
	readonly rows = signal<ImportRowView[]>([]);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly picking = signal<number | null>(null);

	readonly counts = computed(() => {
		const rows = this.rows();
		return {
			ready: rows.filter((row) => row.result === 'ready' || (row.result === 'needs_product' && row.picked))
				.length,
			needsProduct: rows.filter((row) => row.result === 'needs_product' && !row.picked).length,
			problems: rows.filter((row) => row.result === 'problem').length,
		};
	});

	start(supplierId: string | null): void {
		this.supplierId.set(supplierId);
	}

	template(): void {
		downloadCsv('purchase-lines-template.csv', IMPORT_TEMPLATE_HEADER, [IMPORT_TEMPLATE_EXAMPLE]);
	}

	async read(file: File | null | undefined): Promise<void> {
		const supplierId = this.supplierId();
		if (!file || !supplierId) return;
		this.fileName.set(file.name);
		this.error.set(null);
		this.rows.set([]);
		if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
			this.error.set(this.transloco.translate('import_csv_only'));
			return;
		}
		const parsed = importRows(parseCsv(await file.text()));
		if (parsed.problem) {
			this.error.set(this.transloco.translate(parsed.problem));
			return;
		}
		this.busy.set(true);
		try {
			const result = await firstValueFrom(this.gateway.importRows({ supplierId, rows: parsed.rows }));
			this.rows.set(result.rows.map((row) => ({ ...row, picked: null })));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	pick(index: number, option: PurchaseItemOption): void {
		this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, picked: option } : row)));
		this.picking.set(null);
	}

	async draft(index: number): Promise<void> {
		const row = this.rows()[index];
		if (!row) return;
		const popup = this.modals.open(DraftProductPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'draft_product_title',
		});
		(popup.componentInstance as DraftProductPopup).start(row.code, this.supplierId());
		const option = (await popup.result.catch(() => null)) as PurchaseItemOption | null;
		if (option) this.pick(index, option);
	}

	problemKey(row: ResultRow): string {
		return `import_problem_${row.problem ?? 'unknown'}`;
	}

	add(): void {
		const lines = readyLines(this.rows());
		if (lines.length) this.modal.close(lines);
	}
}
