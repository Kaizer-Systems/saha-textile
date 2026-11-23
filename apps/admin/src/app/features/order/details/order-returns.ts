import { Component, computed, inject, input, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { RETURN_KEYS, ReturnsGateway, returnProblemKey } from '@core/accounts/returns.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderDocuments } from './order-documents';

import type { RefundTo, ReturnHow, ReturnReason } from '@saha-textile/contracts';

export const RETURN_REASONS: readonly ReturnReason[] = [
	'damaged_on_arrival',
	'wrong_item',
	'not_as_described',
	'size_or_fit',
	'changed_mind',
	'other',
];
export const ADJUSTMENT_REASONS = [
	'adj_reason_discount',
	'adj_reason_flaw',
	'adj_reason_late',
	'adj_reason_other',
] as const;

/**
 * The order page's Returns and credit notes card (accounts brief B1, as drawn), with Start a return (B2), Price
 * adjustment (B10) and, for a parcel not delivered, "Returned to us: make the credit note" (B11). Nothing moves in
 * stock or the books until a credit note is issued.
 */
@Component({
	selector: 'app-order-returns',
	imports: [TranslocoModule, FormsModule, RouterLink, OrderDocuments],
	templateUrl: './order-returns.html',
})
export class OrderReturnsCard {
	private readonly gateway = inject(ReturnsGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);

	readonly orderId = input.required<string>();
	readonly orderNumber = input<string>('');
	readonly reasons = RETURN_REASONS;
	readonly adjustmentReasons = ADJUSTMENT_REASONS;
	readonly canEdit = computed(() => this.auth.permissions().includes('order.edit'));
	readonly view = injectQuery(() => ({
		queryKey: RETURN_KEYS.view(this.orderId()),
		queryFn: () => firstValueFrom(this.gateway.view(this.orderId())),
		enabled: !!this.orderId(),
	}));
	/** Parcels sent but not delivered, without a credit note yet: the courier may bring one back (B11). */
	readonly openParcels = computed(() => {
		const v = this.view.data();
		if (!v) return [];
		return v.parcels.filter(
			(p) =>
				!p.delivered && !v.creditNotes.some((n) => n.shipmentId === p.shipmentId && n.status !== 'cancelled'),
		);
	});
	readonly empty = computed(() => {
		const v = this.view.data();
		return !v || v.returns.length + v.creditNotes.length + v.debitNotes.length === 0;
	});

	readonly quantities = signal<Record<string, number>>({});
	readonly lowerBy = signal<Record<string, number>>({});
	readonly reason = signal<ReturnReason>('damaged_on_arrival');
	readonly adjustmentReason = signal<string>(ADJUSTMENT_REASONS[0]);
	readonly how = signal<ReturnHow>('pickup');
	readonly refundTo = signal<RefundTo>('original_payment');
	readonly note = signal('');
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	day(iso: string | null): string {
		return iso
			? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
				})
			: '';
	}

	rupees(value: number): string {
		return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
	}

	setQuantity(lineId: string, value: number): void {
		this.quantities.update((all) => ({ ...all, [lineId]: Math.max(0, Math.floor(Number(value) || 0)) }));
	}

	setLowerBy(lineId: string, value: number): void {
		this.lowerBy.update((all) => ({ ...all, [lineId]: Math.max(0, Number(value) || 0) }));
	}

	readonly picked = computed(() => Object.values(this.quantities()).some((q) => q > 0));
	readonly lowered = computed(() => Object.values(this.lowerBy()).some((q) => q > 0));

	open(template: TemplateRef<unknown>): void {
		this.quantities.set({});
		this.lowerBy.set({});
		this.note.set('');
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			this.modal?.close();
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const problem = returnProblemKey(message);
			this.notifier.showError(problem ? this.transloco.translate(problem.key, problem.params) : message);
		} finally {
			this.busy.set(false);
		}
	}

	/** B2: Start the return; the return's page takes it from there. */
	start(): Promise<void> {
		return this.run(async () => {
			const lines = Object.entries(this.quantities()).map(([lineId, quantity]) => ({ lineId, quantity }));
			const created = await firstValueFrom(
				this.gateway.start(this.orderId(), {
					lines,
					reason: this.reason(),
					how: this.how(),
					refundTo: this.refundTo(),
					note: this.note(),
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: RETURN_KEYS.view(this.orderId()) });
			this.notifier.showSuccess(this.transloco.translate('ret_started', { number: created.number }));
			await this.router.navigate(['/accounts/returns', created.id]);
		});
	}

	/** B10: Save draft opens the credit note to check and issue. */
	adjust(): Promise<void> {
		return this.run(async () => {
			const lines = Object.entries(this.lowerBy()).map(([lineId, lowerByINR]) => ({ lineId, lowerByINR }));
			const refundTo = this.refundTo() === 'customer_account' ? 'customer_account' : 'original_payment';
			const draft = await firstValueFrom(
				this.gateway.priceAdjustment(this.orderId(), {
					lines,
					reason: this.transloco.translate(this.adjustmentReason()),
					refundTo,
				}),
			);
			await this.router.navigate(['/accounts/credit-notes', draft.id]);
		});
	}

	/** B11: the parcel came back; its credit note draft opens. */
	undelivered(shipmentId: string): Promise<void> {
		return this.run(async () => {
			const draft = await firstValueFrom(this.gateway.undelivered(this.orderId(), shipmentId));
			await this.router.navigate(['/accounts/credit-notes', draft.id]);
		});
	}
}
