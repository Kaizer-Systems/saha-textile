import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { editLogRows } from './edit-log-rows';
import { rupees } from './ledger-helpers';

import type { PaymentVoucher } from '@saha-textile/contracts';

/**
 * A payment voucher (decision D5, Rule 52 for reverse charge): who was paid, how, against which self-invoice or bill,
 * the reverse-charge tax where it applies, its print and edit log. Made with the payment, never edited.
 */
@Component({
	selector: 'app-payment-voucher-page',
	imports: [PageWrapper, TranslocoModule, RouterLink],
	templateUrl: './payment-voucher-page.html',
})
export class PaymentVoucherPage {
	private readonly gateway = inject(SelfInvoicesGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly busy = signal(false);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly voucher = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.voucher(this.id()),
		queryFn: () => firstValueFrom(this.gateway.voucher(this.id())),
		enabled: !!this.id(),
	}));
	readonly log = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.voucherLog(this.id()),
		queryFn: () => firstValueFrom(this.gateway.voucherLog(this.id())),
		enabled: !!this.id(),
	}));
	readonly logRows = computed(() => {
		this.lang();
		return editLogRows(this.log.data() ?? [], (key, params) => this.transloco.translate(key, params), this.inr);
	});

	/** The page of what it paid: the self-invoice, or the purchase entry. */
	againstLink(voucher: PaymentVoucher): string[] {
		return voucher.against.kind === 'selfInvoice'
			? ['/accounts/self-invoices', voucher.against.id]
			: ['/purchase-entries', voucher.against.id];
	}

	day(iso: string): string {
		return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	async print(): Promise<void> {
		this.busy.set(true);
		try {
			openPdf(await firstValueFrom(this.gateway.voucherPdf(this.id())));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
