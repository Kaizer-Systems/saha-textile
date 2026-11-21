import { Component, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { AddonGroup } from '../addon-group/addon-group';
import { BundleConfigurator } from '../bundle-configurator/bundle-configurator';

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
}

export interface AddonSheetResult {
	selections: Record<string, string>;
	measurements: Record<string, number>;
	measured: boolean;
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

	start(config: AddonSheetStart): void {
		this.config.set(config);
	}

	onState(state: { total: number }): void {
		this.total.set(state.total);
	}

	save(): void {
		const snapshot = (this.part() ?? this.setPart())?.snapshot();
		if (snapshot) this.modal.close(snapshot satisfies AddonSheetResult);
	}
}
