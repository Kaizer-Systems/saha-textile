import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';

import { paiseOf } from './cash-format';

import type { CashBox, CashMoveWrite } from '@saha-textile/contracts';

/**
 * O3 "typed here": a bank deposit from the box, cash from the bank into it, or a move to another box. Each is a contra
 * the books post, so its line lands on the sheet by itself.
 */
@Component({
	selector: 'app-cash-move-popup',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './move-popup.html',
})
export class CashMovePopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(CashGateway);

	readonly kinds: CashMoveWrite['kind'][] = ['bank_deposit', 'bank_withdrawal', 'box_move'];
	readonly sheetId = signal('');
	readonly box = signal<CashBox | null>(null);
	readonly banks = signal<{ id: string; name: string }[]>([]);
	readonly boxes = signal<{ id: string; name: string }[]>([]);
	readonly kind = signal<CashMoveWrite['kind']>('bank_deposit');
	readonly to = signal('');
	readonly amount = signal('');
	readonly slip = signal('');
	readonly note = signal('');
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);

	readonly targets = computed(() => (this.kind() === 'box_move' ? this.boxes() : this.banks()));
	readonly ready = computed(() => !!this.to() && paiseOf(this.amount()) !== null);

	use(options: {
		sheetId: string;
		box: CashBox;
		banks: { id: string; name: string }[];
		boxes: { id: string; name: string }[];
	}): void {
		this.sheetId.set(options.sheetId);
		this.box.set(options.box);
		this.banks.set(options.banks);
		this.boxes.set(options.boxes.filter((b) => b.id !== options.box.id));
	}

	setKind(kind: CashMoveWrite['kind']): void {
		this.kind.set(kind);
		this.to.set('');
	}

	async save(): Promise<void> {
		this.busy.set(true);
		this.problem.set(null);
		try {
			const write: CashMoveWrite = {
				kind: this.kind(),
				amountPaise: paiseOf(this.amount()) as number,
				toId: this.to(),
				slip: this.slip().trim(),
				note: this.note().trim(),
			};
			this.modal.close(await firstValueFrom(this.gateway.move(this.sheetId(), write)));
		} catch (error) {
			this.problem.set(cashProblemKey(apiProblem(error, 'cash_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
