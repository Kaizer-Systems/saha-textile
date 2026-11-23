import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, type Observable } from 'rxjs';

import { InvoicesGateway } from '@core/accounts/invoices.gateway';
import { ReturnsGateway } from '@core/accounts/returns.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import type { OrderDocumentRow } from '@saha-textile/contracts';

/**
 * B1 Documents: every document of the order (tax invoices, receipt vouchers, packing slips, returns, credit and debit
 * notes) with its number, date and amount; the eye opens it, the printer prints it.
 */
@Component({
	selector: 'app-order-documents',
	imports: [TranslocoModule, RouterLink],
	templateUrl: './order-documents.html',
})
export class OrderDocuments {
	private readonly invoices = inject(InvoicesGateway);
	private readonly returns = inject(ReturnsGateway);
	private readonly orders = inject(OrdersGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly orderId = input.required<string>();
	readonly documents = input.required<readonly OrderDocumentRow[]>();
	readonly busy = signal(false);

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	inr(value: number): string {
		return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	/** Where the eye goes: the document's own page, or null when it has none (it opens as a PDF instead). */
	link(doc: OrderDocumentRow): string[] | null {
		switch (doc.kind) {
			case 'taxInvoice':
				return ['/accounts/invoices', doc.id];
			case 'return':
				return ['/accounts/returns', doc.id];
			case 'creditNote':
				return ['/accounts/credit-notes', doc.id];
			case 'debitNote':
				return doc.creditNoteId ? ['/accounts/credit-notes', doc.creditNoteId] : null;
			default:
				return null;
		}
	}

	/** A draft credit note has no print yet. */
	printable(doc: OrderDocumentRow): boolean {
		return doc.status !== 'draft';
	}

	private pdf(doc: OrderDocumentRow): Observable<Blob> {
		switch (doc.kind) {
			case 'taxInvoice':
				return this.invoices.pdf(this.orderId(), doc.id, 'original');
			case 'receipt':
				return this.orders.receiptPdf(this.orderId(), doc.id);
			case 'packingSlip':
				return this.orders.packingSlip(this.orderId());
			case 'return':
				return this.returns.returnNotePdf(doc.id);
			case 'creditNote':
				return this.returns.creditNotePdf(doc.id);
			case 'debitNote':
				return this.returns.debitNotePdf(doc.id);
		}
	}

	async print(doc: OrderDocumentRow): Promise<void> {
		this.busy.set(true);
		try {
			openPdf(await firstValueFrom(this.pdf(doc)));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
