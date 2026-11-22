import { Component, computed, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { AddonGroup } from '../addon-group/addon-group';
import { BundleConfigurator, type SetChoice } from '../bundle-configurator/bundle-configurator';

export interface AddonSheetStart {
	product: IProduct;
	basePrice: number;
	selections: Record<string, string>;
	measurements: Record<string, number>;
	/**
	 * `designs`: the pencil (designs, the measurement row, the total, Done). `all`: Edit add-on (the full form, Save).
	 * `set`: Configure set (the whole set block, Save).
	 */
	mode: 'designs' | 'all' | 'set';
	/** Set mode: whether the page can add the set to the cart (sets wait for their pricing, brief B12). */
	buyable?: boolean;
	/** Set mode: the set's choices (picks, sizes, extras, free items). */
	set?: SetChoice;
}

export interface AddonSheetResult {
	selections: Record<string, string>;
	measurements: Record<string, number>;
	measured: boolean;
	/** Set mode: the shopper pressed Add set to cart. */
	add?: boolean;
	set?: SetChoice;
}

/**
 * The buy bar's sheet (owner, 21 Nov 2026, product page brief P4 and A4): the page's own add-on or set part inside
 * the shop's pop-up, a sheet from the bottom on phones. It starts from the page's choices and hands them back.
 */
@Component({
	selector: 'app-addon-sheet',
	templateUrl: './addon-sheet.html',
	providers: [CurrencySymbolPipe],
	imports: [AddonGroup, BundleConfigurator, CurrencySymbolPipe, TranslocoModule],
})
export class AddonSheet {
	readonly modal = inject(NgbActiveModal);
	private readonly part = viewChild(AddonGroup);
	private readonly setPart = viewChild(BundleConfigurator);

	readonly config = signal<AddonSheetStart | null>(null);
	readonly total = signal(0);
	readonly valid = signal(false);
	private readonly chosen = signal<Record<string, string>>({});
	/** Set mode: how many pieces the set holds now (picks and optional pieces count). */
	readonly pieceCount = signal<number | null>(null);
	readonly pieces = computed(
		() =>
			this.pieceCount() ?? this.config()?.product.bundle?.levels.reduce((sum, level) => sum + level.take, 0) ?? 0,
	);

	/** What the add-on adds over the product's own price, and the chosen terms that add it (the footer's line). */
	readonly delta = computed(() => this.total() - (this.config()?.basePrice ?? 0));
	readonly addonNames = computed(() => {
		const chosen = this.chosen();
		return (this.config()?.product.addon_groups ?? [])
			.map((group) => group.terms.find((term) => term.code === chosen[group.code]))
			.filter((term) => !!term && term.price_delta > 0)
			.map((term) => term?.label)
			.join(', ');
	});

	start(config: AddonSheetStart): void {
		this.config.set(config);
	}

	onState(state: { total: number; valid?: boolean; selections?: Record<string, string>; pieces?: string[] }): void {
		this.total.set(state.total);
		this.valid.set(state.valid ?? false);
		this.chosen.set(state.selections ?? {});
		this.pieceCount.set(state.pieces?.length ?? null);
	}

	/** Hands the choices back; in set mode closing keeps them too, since the page shows the same set. */
	save(add = false): boolean {
		const snapshot = (this.part() ?? this.setPart())?.snapshot();
		if (!snapshot) return false;
		this.modal.close({ ...snapshot, ...(add ? { add } : {}) } satisfies AddonSheetResult);
		return true;
	}
}
