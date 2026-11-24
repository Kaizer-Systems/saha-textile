import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';

import { istTime, paiseOf } from './cash-format';

import type { CashBox, PettyExpenseWrite } from '@saha-textile/contracts';

/** The GST rates a petty bill may carry. */
export const PETTY_RATES = [5, 12, 18, 28] as const;

/**
 * O4: a petty expense paid from a box with its sheet open: head, amount, paid to, what for, the bill when it is over
 * the limit set, a GST bill with our GSTIN for input credit, and the checks before paying (the cash limit to one
 * payee in a day, s.40A(3), and the open sheet).
 */
@Component({
	selector: 'app-cash-petty-popup',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './petty-popup.html',
})
export class CashPettyPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(CashGateway);

	readonly rates = PETTY_RATES;
	readonly box = signal<CashBox | null>(null);
	readonly heads = signal<{ id: string; name: string }[]>([]);
	readonly head = signal('');
	readonly amount = signal('');
	readonly paidTo = signal('');
	readonly whatFor = signal('');
	readonly bill = signal<FmPicked | null>(null);
	readonly gstOn = signal(false);
	readonly gstin = signal('');
	readonly supplier = signal('');
	readonly billNumber = signal('');
	readonly billDate = signal('');
	readonly rate = signal<number>(18);
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);
	readonly inr = (paise: number) => rupees(paise);
	readonly time = istTime;

	readonly paise = computed(() => paiseOf(this.amount()));
	readonly checks = injectQuery(() => {
		const box = this.box();
		return {
			queryKey: ['cash', 'petty-check', box?.id, this.paidTo(), this.paise()],
			// Runs only when enabled, so there is a box.
			queryFn: () =>
				firstValueFrom(this.gateway.pettyCheck((box as CashBox).id, this.paidTo(), this.paise() ?? 0)),
			enabled: !!box,
		};
	});
	readonly ready = computed(() => {
		const checks = this.checks.data();
		const gstReady =
			!this.gstOn() ||
			(/^\d{2}[A-Z0-9]{13}$/.test(this.gstin().toUpperCase()) && !!this.billNumber() && !!this.billDate());
		return (
			!!checks &&
			checks.sheetOpen &&
			checks.withinLimit &&
			(!checks.billNeeded || !!this.bill()) &&
			!!this.head() &&
			this.paise() !== null &&
			!!this.paidTo().trim() &&
			!!this.whatFor().trim() &&
			gstReady
		);
	});

	use(options: { box: CashBox; heads: { id: string; name: string }[]; today: string }): void {
		this.box.set(options.box);
		this.heads.set(options.heads);
		this.billDate.set(options.today);
	}

	async pickBill(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'cash_pick_bill',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.bill.set(picked[0]);
	}

	async pay(): Promise<void> {
		const box = this.box() as CashBox;
		const write: PettyExpenseWrite = {
			boxId: box.id,
			headLedgerId: this.head(),
			amountPaise: this.paise() as number,
			paidTo: this.paidTo().trim(),
			whatFor: this.whatFor().trim(),
			billMediaId: this.bill()?.assetId ?? null,
			gst: this.gstOn()
				? {
						supplierGstin: this.gstin().trim().toUpperCase(),
						supplierName: this.supplier().trim(),
						billNumber: this.billNumber().trim(),
						billDate: this.billDate(),
						ratePercent: this.rate(),
					}
				: null,
		};
		this.busy.set(true);
		this.problem.set(null);
		try {
			this.modal.close(await firstValueFrom(this.gateway.pay(write)));
		} catch (error) {
			this.problem.set(cashProblemKey(apiProblem(error, 'cash_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
