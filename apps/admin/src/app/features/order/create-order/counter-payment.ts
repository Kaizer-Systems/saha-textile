import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { CounterGateway, counterProblemKey } from '@core/counter/counter.gateway';
import { money } from '@core/orders/order-format';
import { apiProblem } from '@core/purchasing/purchasing-format';

import type { CounterHere, CounterPaymentWrite, CounterSaleWrite } from '@saha-textile/contracts';

/** What the counter screen hands the payment popup. */
export interface CounterPaymentStart {
	store: CounterHere['stores'][number];
	totalINR: number;
	taxableINR: number;
	gstINR: number;
	/** Pieces, with a length of fabric counted once. */
	pieces: number;
	sale: Omit<CounterSaleWrite, 'payments' | 'cashHandedINR' | 'print'>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A typed amount in rupees: empty is nothing, anything that isn't a sum of money is null. */
export function rupeesTyped(text: string): number | null {
	const plain = text.replace(/[,\s₹]/g, '');
	if (!plain) return 0;
	return /^\d+(\.\d{1,2})?$/.test(plain) ? Number(plain) : null;
}

/**
 * Take payment (accounts brief P2): split between UPI, cash and card; the change is worked out from the cash handed
 * over; the invoice prints as an A4 tax invoice or on the 80 mm roll. Taking it sells, invoices, moves the stock, the
 * cash sheet and the books at once; a refusal stays here, in words.
 */
@Component({
	selector: 'app-counter-payment',
	templateUrl: './counter-payment.html',
	imports: [TranslocoModule, FormsModule],
})
export class CounterPayment {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(CounterGateway);
	private readonly transloco = inject(TranslocoService);

	readonly data = signal<CounterPaymentStart | null>(null);
	readonly upi = signal('');
	readonly upiRef = signal('');
	readonly cash = signal('');
	readonly card = signal('');
	readonly cardRef = signal('');
	readonly handed = signal('');
	readonly print = signal<'a4' | 'roll80'>('roll80');
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);

	/** The typed amounts, or null while any of them isn't a sum of money. */
	readonly amounts = computed(() => {
		const upi = rupeesTyped(this.upi());
		const cash = rupeesTyped(this.cash());
		const card = rupeesTyped(this.card());
		const handed = rupeesTyped(this.handed());
		return upi === null || cash === null || card === null || handed === null ? null : { upi, cash, card, handed };
	});
	readonly cashINR = computed(() => this.amounts()?.cash ?? 0);
	readonly paidINR = computed(() => {
		const typed = this.amounts();
		return typed ? round2(typed.upi + typed.cash + typed.card) : 0;
	});
	readonly changeINR = computed(() => {
		const typed = this.amounts();
		return typed && typed.cash > 0 && typed.handed > typed.cash ? round2(typed.handed - typed.cash) : 0;
	});
	readonly canTake = computed(() => {
		const data = this.data();
		const typed = this.amounts();
		if (!data || !typed || this.busy()) return false;
		if (Math.abs(this.paidINR() - data.totalINR) > 0.005) return false;
		return !typed.cash || (data.store.sheetOpen && typed.handed >= typed.cash);
	});

	/** Cash by default when the till's sheet is open, else UPI. */
	start(data: CounterPaymentStart): void {
		this.data.set(data);
		const total = data.totalINR.toFixed(2);
		if (data.store.sheetOpen) {
			this.cash.set(total);
			this.handed.set(total);
		} else this.upi.set(total);
	}

	/** English digits in both languages. */
	rupees(amount: number): string {
		return money(amount, 'INR');
	}

	/** The books line of "What this changes": cash and the UPI and card clearing debited, sales and GST credited. */
	readonly booksWords = computed(() => {
		const data = this.data();
		const typed = this.amounts();
		if (!data || !typed) return '';
		const cash = typed.cash;
		const clearing = round2(typed.upi + typed.card);
		const debits = [
			...(cash > 0 ? [this.transloco.translate('counter_dr_cash', { amount: this.rupees(cash) })] : []),
			...(clearing > 0
				? [this.transloco.translate('counter_dr_clearing', { amount: this.rupees(clearing) })]
				: []),
		];
		return this.transloco.translate('counter_effect_books', {
			debits: debits.join(' · '),
			taxable: this.rupees(data.taxableINR),
			gst: this.rupees(data.gstINR),
		});
	});

	async take(): Promise<void> {
		const data = this.data();
		const typed = this.amounts();
		if (!data || !typed || !this.canTake()) return;
		const payments: CounterPaymentWrite[] = [
			{ method: 'upi' as const, amountINR: typed.upi, reference: this.upiRef().trim() },
			{ method: 'cash' as const, amountINR: typed.cash, reference: '' },
			{ method: 'card' as const, amountINR: typed.card, reference: this.cardRef().trim() },
		].filter((p) => p.amountINR > 0);
		this.busy.set(true);
		this.problem.set(null);
		try {
			const sold = await firstValueFrom(
				this.gateway.sell({
					...data.sale,
					payments,
					cashHandedINR: typed.cash > 0 ? typed.handed : 0,
					print: this.print(),
				}),
			);
			this.modal.close(sold);
		} catch (error) {
			this.problem.set(counterProblemKey(apiProblem(error, 'cash_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
