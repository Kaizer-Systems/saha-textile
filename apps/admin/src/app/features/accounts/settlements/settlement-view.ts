import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';

import type { Settlement } from '@saha-textile/contracts';

/** One payout (accounts brief Q10): its money and every row with the order it paid; printed through the browser. */
@Component({
	selector: 'app-settlement-view',
	templateUrl: './settlement-view.html',
	imports: [TranslocoModule],
})
export class SettlementView {
	readonly modal = inject(NgbActiveModal);
	private readonly document = inject(DOCUMENT);

	readonly settlement = signal<Settlement | null>(null);

	start(settlement: Settlement, print: boolean): void {
		this.settlement.set(settlement);
		// Printing waits for the rows to be drawn.
		if (print) setTimeout(() => this.print(), 0);
	}

	print(): void {
		(this.document.defaultView as Window).print();
	}

	rupees(paise: number): string {
		return rupees(paise);
	}

	day(date: string): string {
		return shortDate(date);
	}
}
