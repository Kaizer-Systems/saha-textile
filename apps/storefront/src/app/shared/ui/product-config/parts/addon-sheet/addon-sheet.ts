import { Component, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { AddonGroup } from '../addon-group/addon-group';

export interface AddonSheetStart {
	product: IProduct;
	basePrice: number;
	selections: Record<string, string>;
	measurements: Record<string, number>;
	/** `designs`: the pencil (designs, the measurement row, the total, Done). `all`: Edit add-on (the full form, Save). */
	mode: 'designs' | 'all';
}

export interface AddonSheetResult {
	selections: Record<string, string>;
	measurements: Record<string, number>;
	measured: boolean;
}

/**
 * The buy bar's add-on sheet (owner, 21 Nov 2026, product page brief P4 and A4): the page's own add-on part inside
 * the shop's pop-up, a sheet from the bottom on phones. It starts from the page's choices and hands them back.
 */
@Component({
	selector: 'app-addon-sheet',
	templateUrl: './addon-sheet.html',
	providers: [CurrencySymbolPipe],
	imports: [AddonGroup, CurrencySymbolPipe, TranslocoModule],
})
export class AddonSheet {
	readonly modal = inject(NgbActiveModal);
	private readonly part = viewChild(AddonGroup);

	readonly config = signal<AddonSheetStart | null>(null);
	readonly total = signal(0);

	start(config: AddonSheetStart): void {
		this.config.set(config);
	}

	onState(state: { total: number }): void {
		this.total.set(state.total);
	}

	save(): void {
		const snapshot = this.part()?.snapshot();
		if (snapshot) this.modal.close(snapshot satisfies AddonSheetResult);
	}
}
