import { Component, HostListener, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiProblem } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { PluralPipe } from '@shared/pipes/language.pipes';

import { canTakeStock } from './line-search';
import { parseRupees } from './payment-popup';

import type { PurchaseItemOption } from '@saha-textile/contracts';

/** A quantity as typed: whole pieces, or metres in steps of 0.1 (stored as tenths, P11). */
export function parseQuantity(text: string, soldBy: 'piece' | 'metre'): { units: number } | { problem: string } | null {
	const cleaned = text.replace(/[,\s]/g, '').replace(/m$/i, '');
	if (!cleaned) return null;
	if (soldBy === 'piece') {
		if (!/^\d+$/.test(cleaned)) return { problem: 'qty_whole_pieces' };
		return { units: Number(cleaned) };
	}
	if (!/^\d+(\.\d+)?$/.test(cleaned)) return { problem: 'qty_metres_shape' };
	const tenths = Number(cleaned) * 10;
	// 2.55 m is refused, not rounded: metres go in steps of 0.1 (edge case in the brief).
	if (Math.abs(tenths - Math.round(tenths)) > 1e-9) return { problem: 'qty_metres_step' };
	return { units: Math.round(tenths) };
}

export interface GridRow {
	option: PurchaseItemOption;
	quantity: string;
	price: string;
	/** A row whose price was typed keeps it; the others follow the price typed last (p04). */
	ownPrice: boolean;
}

export interface GridPick {
	option: PurchaseItemOption;
	units: number;
	priceINR: number;
}

/**
 * Quantities for every colour (or colour × size) in one place (p04, po02). One price fills every
 * row; any row can differ. "New colour not listed" opens the product's Variants in a new tab, and
 * the grid reads the variants again when this tab is shown again.
 */
@Component({
	selector: 'app-variant-grid',
	templateUrl: './variant-grid.html',
	imports: [PluralPipe, RupeesPipe, StockQuantityPipe, TranslocoModule],
})
export class VariantGrid {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly product = signal<PurchaseItemOption | null>(null);
	readonly rows = signal<GridRow[]>([]);
	readonly priceLabel = signal('unit_price_bill');
	readonly error = signal<string | null>(null);
	private supplierId: string | null = null;
	private opened = false;

	readonly parsed = computed(() =>
		this.rows().map((row) => ({
			row,
			quantity: parseQuantity(row.quantity, row.option.soldBy),
			price: row.price.trim() ? parseRupees(row.price) : null,
		})),
	);
	readonly picks = computed<GridPick[]>(() =>
		this.parsed()
			.filter(
				(entry) =>
					entry.quantity && 'units' in entry.quantity && entry.quantity.units > 0 && entry.price !== null,
			)
			.map((entry) => ({
				option: entry.row.option,
				units: (entry.quantity as { units: number }).units,
				priceINR: entry.price as number,
			})),
	);
	readonly hasProblem = computed(() =>
		this.parsed().some(
			(entry) =>
				(entry.quantity && 'problem' in entry.quantity) || (entry.row.price.trim() && entry.price === null),
		),
	);
	readonly summary = computed(() => {
		const picks = this.picks();
		const value = picks.reduce(
			(sum, pick) => sum + (pick.option.soldBy === 'metre' ? pick.units / 10 : pick.units) * pick.priceINR,
			0,
		);
		return { lines: picks.length, value: Math.round(value * 100) / 100 };
	});

	async start(product: PurchaseItemOption, supplierId: string | null, priceLabel = 'unit_price_bill'): Promise<void> {
		this.product.set(product);
		this.supplierId = supplierId;
		this.priceLabel.set(priceLabel);
		await this.load();
	}

	private async load(): Promise<void> {
		// Runs from start(), which sets the product first, and on focus only once a start() has loaded.
		const product = this.product() as PurchaseItemOption;
		try {
			const options = await firstValueFrom(this.gateway.variantGrid(product.productId, this.supplierId));
			const kept = new Map(this.rows().map((row) => [row.option.variantId, row]));
			const common =
				this.rows().find((row) => !row.ownPrice)?.price ??
				(product.lastCostINR ? String(product.lastCostINR) : '');
			this.rows.set(
				options.filter(canTakeStock).map(
					(option) =>
						kept.get(option.variantId) ?? {
							option,
							quantity: '',
							price: option.lastCostINR ? String(option.lastCostINR) : common,
							ownPrice: false,
						},
				),
			);
			this.opened = true;
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	/** Back from the product's Variants tab: a colour added there shows up here. */
	@HostListener('window:focus')
	onWindowFocus(): void {
		if (this.opened) void this.load();
	}

	setQuantity(index: number, value: string): void {
		this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, quantity: value } : row)));
	}

	setPrice(index: number, value: string): void {
		this.rows.update((rows) =>
			rows.map((row, i) => {
				if (i === index) return { ...row, price: value, ownPrice: true };
				return row.ownPrice ? row : { ...row, price: value };
			}),
		);
	}

	problemOf(index: number): string | null {
		const entry = this.parsed()[index];
		if (!entry) return null;
		if (entry.quantity && 'problem' in entry.quantity) return entry.quantity.problem;
		if (entry.row.price.trim() && entry.price === null) return 'payment_amount_invalid';
		return null;
	}

	newVariantLink(): string {
		return `/product/edit/${encodeURIComponent(this.product()?.productId ?? '')}?tab=inventory`;
	}

	add(): void {
		if (this.hasProblem() || !this.picks().length) return;
		this.modal.close(this.picks());
	}
}
