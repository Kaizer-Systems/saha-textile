import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	RupeesPipe,
	ShortDatePipe,
	ShortDateTimePipe,
	StockQuantityPipe,
	downloadCsv,
	shortDate,
} from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway, type ValuationResponse } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { ExportMenu, captured, type CsvWriter, type ExportSource } from '@shared/ui/export-menu/export-menu';
import { Pagination } from '@shared/ui/pagination/pagination';

import { AdjustPopup } from './adjust-popup';

import type { AgeingRow, StockListRow } from '@saha-textile/contracts';

export type ReportTab = 'ageing' | 'value' | 'movements' | 'register' | 'unpaid';
const REPORT_TABS: readonly ReportTab[] = ['ageing', 'value', 'movements', 'register', 'unpaid'];

/** The tab a link asks for (route data, or `?tab=` from the bell), else Ageing. */
export function reportTabFrom(fromRoute: unknown, fromQuery: string | null): ReportTab {
	const wanted = (fromRoute ?? fromQuery) as ReportTab | null;
	return wanted && REPORT_TABS.includes(wanted) ? wanted : 'ageing';
}

/** The first and last day of a month as `YYYY-MM-DD`, from `YYYY-MM`. */
export function monthRange(month: string): { from: string; to: string } {
	// Never-run fallback removed: split() always gives a first part, so the year is always there.
	const [year, mon] = month.split('-').map(Number) as [number, number | undefined];
	const last = new Date(Date.UTC(year, mon ?? 1, 0)).getUTCDate();
	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Enough of a stock row for the adjust popup, from an ageing row (i08 Write off). */
export const rowFromAgeing = (row: AgeingRow): StockListRow => ({
	productId: row.productId,
	variantId: row.variantId,
	sku: row.sku,
	title: row.title,
	optionsLabel: row.optionsLabel,
	imageUrl: row.imageUrl,
	categoryName: null,
	soldBy: row.soldBy,
	onHand: row.onHand,
	held: 0,
	inOrders: 0,
	freeToSell: row.onHand,
	lowStockLevel: null,
	status: 'in_stock',
	valueAtCostINR: row.valueAtCostINR,
	lastReceivedOn: null,
	oldestPieceDays: row.oldestPieceDays,
});

/**
 * Stock reports: ageing (i08), stock value on any date (i09), every movement, the purchase register
 * for the CA (i10) and unpaid bills. Value on a date is worked out from history and cost layers as
 * they stood that day, so a closed year never changes.
 */
@Component({
	selector: 'app-reports',
	templateUrl: './reports.html',
	imports: [
		FormsModule,
		HasPermissionDirective,
		PageWrapper,
		Pagination,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		StockQuantityPipe,
		TranslocoModule,
		ExportMenu,
	],
})
export class Reports {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly tabs: readonly ReportTab[] = REPORT_TABS;
	readonly tab = signal<ReportTab>(
		reportTabFrom(this.route.snapshot.data['tab'], this.route.snapshot.queryParamMap.get('tab')),
	);
	readonly canSeeCost = computed(() => this.auth.permissions().includes('stock.cost'));
	readonly today = istDay(new Date());

	/* ageing (i08) */
	readonly band = signal<number | null>(null);
	readonly ageingPage = signal(1);
	readonly ageing = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.reports, 'ageing', this.band(), this.ageingPage()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.ageing({
					...(this.band() !== null ? { band: this.band() as number } : {}),
					page: this.ageingPage(),
					pageSize: 30,
				}),
			),
		enabled: this.tab() === 'ageing',
	}));
	readonly ticked = signal<ReadonlySet<string>>(new Set());

	/* value on a date (i09) */
	readonly asOn = signal(this.today);
	readonly groupBy = signal<ValuationResponse['groupBy']>('category');
	readonly valuation = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.reports, 'valuation', this.asOn(), this.groupBy()],
		queryFn: () => firstValueFrom(this.gateway.valuation(this.asOn(), this.groupBy())),
		enabled: this.tab() === 'value' && !!this.asOn(),
	}));

	/* movements */
	readonly movementFrom = signal('');
	readonly movementTo = signal('');
	readonly movementSearch = signal('');
	readonly movementPage = signal(1);
	readonly movements = injectQuery(() => ({
		queryKey: [
			...STOCK_KEYS.reports,
			'movements',
			this.movementFrom(),
			this.movementTo(),
			this.movementSearch(),
			this.movementPage(),
		],
		queryFn: () =>
			firstValueFrom(
				this.gateway.movements({
					from: this.movementFrom() || undefined,
					to: this.movementTo() || undefined,
					q: this.movementSearch().trim() || undefined,
					page: this.movementPage(),
					pageSize: 30,
				}),
			),
		enabled: this.tab() === 'movements',
	}));

	/* purchase register (i10) */
	readonly month = signal(this.today.slice(0, 7));
	readonly register = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.reports, 'register', this.month()],
		queryFn: () => {
			const range = monthRange(this.month());
			return firstValueFrom(this.gateway.register(range.from, range.to));
		},
		enabled: this.tab() === 'register' && /^\d{4}-\d{2}$/.test(this.month()),
	}));

	/* unpaid bills */
	readonly unpaid = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.reports, 'unpaid'],
		queryFn: () => firstValueFrom(this.gateway.unpaidBills()),
		enabled: this.tab() === 'unpaid',
	}));

	t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);

	setBand(band: number | null): void {
		this.band.set(band);
		this.ageingPage.set(1);
	}

	toggle(id: string): void {
		this.ticked.update((set) => {
			const next = new Set(set);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	/** Put in a sale (uses Events): opens a new event with the ticked products. */
	toSale(productIds: readonly string[]): void {
		if (productIds.length)
			void this.router.navigate(['/event', 'create', 'sale'], {
				queryParams: { products: [...new Set(productIds)].join(',') },
			});
	}

	tickedProducts(): string[] {
		const ticked = this.ticked();
		return (this.ageing.data()?.rows ?? []).filter((row) => ticked.has(row.variantId)).map((row) => row.productId);
	}

	returnToSupplier(row: AgeingRow): void {
		void this.router.navigate(['/purchase-returns', 'create'], { queryParams: { sku: row.sku, reason: 'other' } });
	}

	async writeOff(row: AgeingRow): Promise<void> {
		const popup = this.modals.open(AdjustPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'adjust_popup_title',
		});
		await (popup.componentInstance as AdjustPopup).start(rowFromAgeing(row), { action: 'remove' });
		if (await popup.result.catch(() => null))
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.reports });
	}

	/** EX1: for the Export menu, written by the same code as the CSV. */
	exportAgeingSource(): () => ExportSource | null {
		return () => captured(this.t('report_stock_ageing'), 'other', (save) => this.exportAgeing(save));
	}

	exportAgeing(save: CsvWriter = downloadCsv): void {
		save(
			'stock-ageing.csv',
			[
				this.t('sku'),
				this.t('item'),
				this.t('on_hand'),
				this.t('oldest_piece'),
				this.t('last_sold'),
				...(this.canSeeCost() ? [this.t('value_at_cost')] : []),
			],
			(this.ageing.data()?.rows ?? []).map((row) => [
				row.sku,
				[row.title, row.optionsLabel].filter(Boolean).join(' · '),
				row.soldBy === 'metre' ? row.onHand / 10 : row.onHand,
				row.oldestPieceDays,
				row.lastSoldOn,
				...(this.canSeeCost() ? [row.valueAtCostINR] : []),
			]),
		);
	}

	/** EX1: for the Export menu, written by the same code as the CSV. */
	exportValuationSource(): () => ExportSource | null {
		return () => captured(this.t('report_stock_value'), 'other', (save) => this.exportValuation(save));
	}

	exportValuation(save: CsvWriter = downloadCsv): void {
		const data = this.valuation.data();
		if (!data) return;
		save(
			`stock-value-${data.asOn}.csv`,
			[
				this.t(`group_${data.groupBy}`),
				this.t('pieces'),
				this.t('value_at_cost'),
				this.t('selling_value'),
				this.t('share'),
			],
			[
				...data.rows.map((row) => [
					row.label,
					row.units,
					row.valueAtCostINR,
					row.sellingValueINR,
					row.sharePct,
				]),
				[this.t('total'), data.totalUnits, data.totalValueINR, null, 100],
			],
		);
	}

	/** The register as the CA's capture list (21 Aug 2026); the GSTR-2B layout waits on the CA (B8.5). */
	/** EX1: for the Export menu, written by the same code as the CSV. */
	exportRegisterSource(): () => ExportSource | null {
		return () => captured(this.t('report_stock_register'), 'other', (save) => this.exportRegister(save));
	}

	exportRegister(save: CsvWriter = downloadCsv): void {
		const rows = this.register.data()?.rows ?? [];
		save(
			`purchase-register-${this.month()}.csv`,
			[
				'Bill date',
				'Supplier',
				'GSTIN',
				'Their bill',
				'Place of supply',
				'Taxable',
				'CGST',
				'SGST',
				'IGST',
				'Total',
				'Reverse charge',
				'Entry',
			],
			rows.map((row) => [
				row.billDate,
				row.supplierName,
				row.gstin,
				row.billNumber,
				row.placeOfSupply,
				row.taxableINR,
				row.cgstINR,
				row.sgstINR,
				row.igstINR,
				row.totalINR,
				row.reverseCharge ? 'Y' : 'N',
				row.entryNumber,
			]),
		);
	}

	/** EX1: for the Export menu, written by the same code as the CSV. */
	exportUnpaidSource(): () => ExportSource | null {
		return () => captured(this.t('filter_unpaid'), 'other', (save) => this.exportUnpaid(save));
	}

	exportUnpaid(save: CsvWriter = downloadCsv): void {
		const data = this.unpaid.data();
		if (!data) return;
		save(
			'unpaid-bills.csv',
			[
				this.t('entry_no'),
				this.t('supplier'),
				this.t('their_bill_no'),
				this.t('bill_date'),
				this.t('due_date'),
				this.t('left_to_pay'),
				this.t('days_since_bill'),
			],
			data.rows.map((row) => [
				row.number,
				row.supplierName,
				row.billNumber,
				shortDate(row.billDate),
				shortDate(row.dueOn),
				row.leftINR,
				row.days,
			]),
		);
	}
}
