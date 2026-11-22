import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { IFreePick, IFreeWith } from '@data-access/interfaces/product-detail.interface';

import { FreeItems, FreeItemsState } from '../free-items/free-items';

export interface FreeItemsSheetStart {
	/** The piece the free items come with ("Arni saree"). */
	pieceName: string;
	freeWith: IFreeWith;
	picks: IFreePick[] | null;
}

/**
 * The pop-up a set pick opens when it brings free items (brief D5, D2-S1–S5; approved 22 Nov 2026): a note with OK
 * for a given item, tiles with a counter for a choice, "No thanks" when the choice is optional, and Done waiting for
 * a size. A sheet from the bottom on phones, centred on laptops: the shop's existing pop-up.
 */
@Component({
	selector: 'app-free-items-sheet',
	templateUrl: './free-items-sheet.html',
	imports: [FreeItems, TranslocoModule],
})
export class FreeItemsSheet {
	readonly modal = inject(NgbActiveModal);
	readonly config = signal<FreeItemsSheetStart | null>(null);
	readonly state = signal<FreeItemsState>({ picks: [], valid: false });

	start(config: FreeItemsSheetStart): void {
		this.config.set(config);
	}

	done(): void {
		if (this.state().valid) this.modal.close(this.state().picks);
	}

	noThanks(): void {
		this.modal.close([] as IFreePick[]);
	}
}
