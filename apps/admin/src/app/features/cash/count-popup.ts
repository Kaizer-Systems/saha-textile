import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { rupees } from '@features/accounts/ledger-helpers';

import { countingOrder } from './cash-format';

import type { CountRow, Denomination } from '@saha-textile/contracts';

export interface CountPopupOptions {
	title: string;
	titleParams?: Record<string, string>;
	info: string;
	infoParams?: Record<string, string>;
	tone?: 'info' | 'warning';
	action: string;
	cancel?: boolean;
	total?: string;
	denominations: readonly Denomination[];
	/** Counts to start from (the float a box last closed with); blank for a recount. */
	start?: readonly CountRow[];
}

/**
 * The count (accounts brief O2, O5, O6, O5T): how many of each note and coin, the amount per row and the total
 * counted, never what the books expect. On a touch screen the boxes are large and the number keypad opens on tap.
 */
@Component({
	selector: 'app-cash-count-popup',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './count-popup.html',
})
export class CashCountPopup {
	readonly modal = inject(NgbActiveModal);
	readonly options = signal<CountPopupOptions>({ title: '', info: '', action: '', denominations: [] });
	readonly rows = signal<{ denomination: Denomination; count: string }[]>([]);
	/** O5T: large boxes on a tablet at the till. */
	readonly touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
	readonly inr = (paise: number) => rupees(paise);

	readonly total = computed(() => this.rows().reduce((sum, row) => sum + (this.amount(row) ?? 0), 0));

	use(options: CountPopupOptions): void {
		this.options.set(options);
		const start = new Map((options.start ?? []).map((row) => [`${row.kind}:${row.valuePaise}`, row.count]));
		this.rows.set(
			countingOrder(options.denominations).map((denomination) => {
				const count = start.get(`${denomination.kind}:${denomination.valuePaise}`);
				return { denomination, count: count === undefined ? '' : String(count) };
			}),
		);
	}

	/** A row's amount, or null while it is blank or zero (drawn as a dash). */
	amount(row: { denomination: Denomination; count: string }): number | null {
		const count = Number(row.count);
		return row.count !== '' && Number.isInteger(count) && count > 0 ? count * row.denomination.valuePaise : null;
	}

	setCount(index: number, value: string): void {
		this.rows.update((rows) =>
			rows.map((row, at) => (at === index ? { ...row, count: value.replace(/\D/g, '') } : row)),
		);
	}

	submit(): void {
		this.modal.close({
			rows: this.rows().map((row) => ({
				valuePaise: row.denomination.valuePaise,
				kind: row.denomination.kind,
				count: Number(row.count) || 0,
			})),
		});
	}
}
