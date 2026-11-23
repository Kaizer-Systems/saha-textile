import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { firstValueFrom } from 'rxjs';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { RupeesPipe, apiProblem, rupees } from '@core/purchasing/purchasing-format';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';

import type { PaymentMode } from '@saha-textile/contracts';

/** A posted bill that still has something to pay, as the popup lists it. */
export interface PayableBill {
	id: string;
	number: string;
	billNumber: string;
	totalINR: number;
	paidINR: number;
	leftINR: number;
}

export const PAYMENT_MODES: readonly PaymentMode[] = ['bank_transfer', 'upi', 'cheque', 'cash'];

/** Rupees as typed ("1,83,750" or "183750.5") → a number, or null when it is not one. */
export function parseRupees(text: string): number | null {
	const cleaned = text.replace(/[₹,\s]/g, '');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	return Number(cleaned);
}

/**
 * Record a payment against a posted bill (p11), from the purchase entry or from the supplier
 * page (s03), where a bill picker is shown first. Part payments are fine; the entry reads Part
 * paid until the rest is in. No bank account numbers are asked for or kept. Every payment gets its own payment
 * voucher (accounts brief D4, decision D5).
 */
@Component({
	selector: 'app-payment-popup',
	templateUrl: './payment-popup.html',
	imports: [FormsModule, RupeesPipe, TranslocoModule],
})
export class PaymentPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly vouchers = inject(SelfInvoicesGateway);
	private readonly transloco = inject(TranslocoService);

	readonly bills = signal<readonly PayableBill[]>([]);
	readonly billId = signal<string>('');
	readonly bill = computed(() => this.bills().find((bill) => bill.id === this.billId()) ?? null);
	readonly amount = signal('');
	readonly paidOn = signal(istDay(new Date()));
	readonly mode = signal<PaymentMode>('bank_transfer');
	readonly reference = signal('');
	readonly proof = signal<FmPicked | null>(null);
	readonly error = signal<string | null>(null);
	readonly saving = signal(false);
	readonly modes = PAYMENT_MODES;
	readonly today = istDay(new Date());

	readonly amountValue = computed(() => parseRupees(this.amount()));
	readonly amountProblem = computed(() => {
		const value = this.amountValue();
		const bill = this.bill();
		if (!this.amount().trim()) return null;
		if (value === null || value <= 0) return 'payment_amount_invalid';
		if (bill && value > bill.leftINR + 0.005) return 'payment_amount_over';
		return null;
	});

	start(bills: readonly PayableBill[], billId: string | null = null): void {
		this.bills.set(bills);
		this.choose(billId ?? bills[0]?.id ?? '');
	}

	/** Choosing a bill fills the amount with what is left on it. */
	choose(id: string): void {
		this.billId.set(id);
		const bill = this.bill();
		this.amount.set(bill ? String(bill.leftINR) : '');
		this.error.set(null);
	}

	leftText(): string {
		return rupees(this.bill()?.leftINR ?? 0);
	}

	canSave(): boolean {
		return (
			!!this.bill() && !this.saving() && this.amountValue() !== null && !this.amountProblem() && !!this.paidOn()
		);
	}

	/** Proof: a screenshot or PDF of the transfer, from Media (any file). */
	async pickProof(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'payment_pick_proof',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.proof.set(picked[0]);
	}

	async save(): Promise<void> {
		const bill = this.bill();
		const amount = this.amountValue();
		if (!bill || amount === null || !this.canSave()) return;
		this.saving.set(true);
		this.error.set(null);
		try {
			const { entry } = await firstValueFrom(
				this.vouchers.payPurchaseEntry(bill.id, {
					amountINR: amount,
					paidOn: this.paidOn(),
					mode: this.mode(),
					reference: this.reference().trim() || null,
					proofAssetId: this.proof()?.assetId ?? null,
				}),
			);
			this.modal.close(entry);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.saving.set(false);
		}
	}
}
