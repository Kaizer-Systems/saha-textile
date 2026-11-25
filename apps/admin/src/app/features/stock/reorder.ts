import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiProblem, downloadCsv } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS } from '@core/purchasing/purchasing.gateway';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { quantityText } from '@features/purchasing/shared/purchasing-labels';
import { parseQuantity } from '@features/purchasing/shared/variant-grid';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { ExportMenu, captured, type CsvWriter, type ExportSource } from '@shared/ui/export-menu/export-menu';

import type { ReorderRow } from '@saha-textile/contracts';

export interface ReorderLine {
	row: ReorderRow;
	ticked: boolean;
	quantity: string;
}

/** Ticked lines as orders: one draft per last supplier (rows never bought before cannot be ordered here). */
export function orderLines(
	lines: readonly ReorderLine[],
): Array<{ variantId: string; quantity: number; supplierId?: string }> {
	return lines
		.filter((line) => line.ticked && line.row.lastSupplierId)
		.map((line) => {
			const parsed = parseQuantity(line.quantity, line.row.soldBy);
			return { line, units: parsed && 'units' in parsed ? parsed.units : 0 };
		})
		.filter((item) => item.units > 0)
		.map((item) => ({
			variantId: item.line.row.variantId,
			quantity: item.units,
			supplierId: item.line.row.lastSupplierId as string,
		}));
}

/**
 * Reorder list (i07): items at or under their low-stock level, or running out within 14 days at
 * the last 60 days' pace; the suggestion covers 45 days and can be changed. Ticked lines become
 * draft purchase orders, one per last supplier.
 */
@Component({
	selector: 'app-reorder',
	templateUrl: './reorder.html',
	imports: [
		FormsModule,
		HasPermissionDirective,
		PageWrapper,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		StockQuantityPipe,
		TranslocoModule,
		ExportMenu,
	],
})
export class Reorder {
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	readonly onlyOutSelling = signal(false);
	readonly supplierId = signal('');
	readonly busy = signal(false);
	readonly query = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.reports, 'reorder'],
		queryFn: () => firstValueFrom(this.gateway.reorder()),
	}));
	readonly lines = signal<ReorderLine[]>([]);
	readonly all = this.lines.asReadonly();

	constructor() {
		// Fresh suggestions keep whatever was typed or ticked on lines already shown.
		effect(() => {
			const data = this.query.data();
			if (!data) return;
			const known = new Map(untracked(this.lines).map((line) => [line.row.variantId, line]));
			const unit = (row: ReorderRow) =>
				row.soldBy === 'metre' ? (row.suggested / 10).toFixed(1) : String(row.suggested);
			this.lines.set(
				data.items.map(
					(row) =>
						known.get(row.variantId) ?? {
							row,
							ticked: !!row.lastSupplierId && row.suggested > 0,
							quantity: unit(row),
						},
				),
			);
		});
	}

	readonly suppliers = computed(() => {
		const map = new Map<string, string>();
		for (const line of this.all())
			if (line.row.lastSupplierId) map.set(line.row.lastSupplierId, line.row.lastSupplierName ?? '');
		return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
	});
	readonly shown = computed(() =>
		this.all().filter(
			(line) =>
				(!this.onlyOutSelling() || (line.row.freeToSell <= 0 && line.row.soldLast60Days > 0)) &&
				(!this.supplierId() || line.row.lastSupplierId === this.supplierId()),
		),
	);
	readonly outSelling = computed(
		() => this.all().filter((line) => line.row.freeToSell <= 0 && line.row.soldLast60Days > 0).length,
	);
	readonly orders = computed(() => new Set(orderLines(this.all()).map((line) => line.supplierId)).size);

	set(variantId: string, change: Partial<Pick<ReorderLine, 'ticked' | 'quantity'>>): void {
		this.lines.update((lines) =>
			lines.map((line) => (line.row.variantId === variantId ? { ...line, ...change } : line)),
		);
	}

	async makeOrders(): Promise<void> {
		const lines = orderLines(this.all());
		if (!lines.length || this.busy()) return;
		this.busy.set(true);
		try {
			const drafts = await firstValueFrom(this.gateway.reorderToOrders(lines));
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.orders });
			this.notifier.showSuccess(this.transloco.translate('reorder_orders_made', { count: drafts.length }));
			void this.router.navigate(['/purchase-orders']);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	/** EX1: for the Export menu, written by the same code as the CSV. */
	exportListSource(): () => ExportSource | null {
		return () => captured(this.transloco.translate('reorder_list'), 'other', (save) => this.exportList(save));
	}

	exportList(save: CsvWriter = downloadCsv): void {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		save(
			'reorder-list.csv',
			[
				t('sku'),
				t('item'),
				t('free_to_sell'),
				t('sold_in_60_days'),
				t('days_left'),
				t('last_supplier'),
				t('suggest'),
			],
			this.shown().map((line) => [
				line.row.sku,
				[line.row.title, line.row.optionsLabel].filter(Boolean).join(' · '),
				quantityText(line.row.freeToSell, line.row.soldBy, t),
				quantityText(line.row.soldLast60Days, line.row.soldBy, t),
				line.row.daysLeft,
				line.row.lastSupplierName,
				line.quantity,
			]),
		);
	}
}
