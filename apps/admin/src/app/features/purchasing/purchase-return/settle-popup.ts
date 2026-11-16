import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { istDay, settlementOpen } from '@saha-textile/core-domain/purchasing';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, apiProblem } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';

import { parseRupees } from '../shared/payment-popup';

import type { PurchaseReturn, SettlementHow } from '@saha-textile/contracts';

export const SETTLE_HOWS: readonly SettlementHow[] = ['credit_note', 'refund', 'later_bill', 'written_off'];

/**
 * Settle a sent return (r04): their credit note, a refund, taken off a later bill, or written off
 * because they refused. Less than the debit note leaves the rest open on their statement.
 */
@Component({
	selector: 'app-settle-popup',
	templateUrl: './settle-popup.html',
	imports: [FormsModule, RupeesPipe, TranslocoModule],
})
export class SettlePopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly doc = signal<PurchaseReturn | null>(null);
	readonly how = signal<SettlementHow>('credit_note');
	readonly reference = signal('');
	readonly date = signal(istDay(new Date()));
	readonly amount = signal('');
	readonly copy = signal<FmPicked | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly hows = SETTLE_HOWS;
	readonly today = istDay(new Date());

	readonly open = computed(() => {
		const doc = this.doc();
		return doc ? settlementOpen(doc.totalINR, doc.settledINR) : 0;
	});
	readonly amountValue = computed(() => parseRupees(this.amount()));
	readonly problem = computed(() => {
		const value = this.amountValue();
		if (!this.amount().trim()) return null;
		if (value === null || value <= 0) return 'payment_amount_invalid';
		if (value > this.open() + 0.005) return 'settle_more_than_open';
		return null;
	});
	/** A credit note or a refund names its reference; the others need none. */
	readonly needsReference = computed(() => this.how() === 'credit_note');
	readonly canSave = computed(
		() =>
			!this.busy() &&
			this.amountValue() !== null &&
			!this.problem() &&
			!!this.date() &&
			(!this.needsReference() || !!this.reference().trim()),
	);

	start(doc: PurchaseReturn): void {
		this.doc.set(doc);
		this.amount.set(String(settlementOpen(doc.totalINR, doc.settledINR)));
	}

	async pickCopy(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'settle_pick_copy',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.copy.set(picked[0]);
	}

	async save(): Promise<void> {
		const doc = this.doc();
		const amount = this.amountValue();
		if (!doc || amount === null || !this.canSave()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const settled = await firstValueFrom(
				this.gateway.settleReturn(doc.id, {
					how: this.how(),
					reference: this.reference().trim() || null,
					date: this.date(),
					amountINR: amount,
					attachmentAssetId: this.copy()?.assetId ?? null,
				}),
			);
			this.modal.close(settled);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
