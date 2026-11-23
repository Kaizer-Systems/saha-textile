import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { INVOICE_KEYS, INVOICE_PRINTS, type InvoicePrint, InvoicesGateway } from '@core/accounts/invoices.gateway';
import { apiProblem, openPdf, saveBlob } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import type { TaxInvoice } from '@saha-textile/contracts';

/**
 * The order page's tax invoice card (accounts brief D1, EI5B as drawn): each invoice issued for the order with its
 * number and day, Print and Download with the three Rule 48 copies or all three, and the way to its books (Q5).
 * Email to buyer is drawn and shown, and waits for invoice emails.
 */
@Component({
	selector: 'app-order-invoices',
	imports: [TranslocoModule, NgbDropdownModule, RouterLink],
	templateUrl: './order-invoices.html',
})
export class OrderInvoicesCard {
	private readonly gateway = inject(InvoicesGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly orderId = input.required<string>();
	readonly prints = INVOICE_PRINTS;
	readonly busy = signal<string | null>(null);
	readonly canSeeBooks = computed(() => this.auth.permissions().includes('accounts.index'));
	readonly invoices = injectQuery(() => ({
		queryKey: INVOICE_KEYS.forOrder(this.orderId()),
		queryFn: () => firstValueFrom(this.gateway.forOrder(this.orderId())),
		enabled: !!this.orderId(),
	}));

	/** "22 Nov 2026", as the picture writes the day. */
	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	async print(invoice: TaxInvoice, copy: InvoicePrint, save: boolean): Promise<void> {
		this.busy.set(`${invoice.id}:${copy}`);
		try {
			const blob = await firstValueFrom(this.gateway.pdf(this.orderId(), invoice.id, copy));
			if (save) saveBlob(`${invoice.number.replace(/\//g, '-')} ${copy}.pdf`, blob);
			else openPdf(blob);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(null);
		}
	}
}
