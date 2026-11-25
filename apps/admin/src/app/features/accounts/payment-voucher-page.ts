import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway, selfInvoiceProblemKey } from '@core/accounts/self-invoices.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ReasonPopup } from '@features/purchasing/shared/reason-popup';

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
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

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

	/** Cancel (brief table): a super admin, while its month is open; the API says why not. */
	readonly canCancel = computed(
		() => this.voucher.data()?.status === 'paid' && this.auth.permissions().includes('purchase.payment'),
	);

	async cancel(voucher: PaymentVoucher): Promise<void> {
		const popup = this.modals.open(ReasonPopup, { centered: true });
		(popup.componentInstance as ReasonPopup).start({
			title: 'pv_cancel_title',
			params: { number: voucher.number },
			body: 'pv_cancel_body',
			label: 'si_cancel_reason',
			confirm: 'pv_cancel_confirm',
			confirmClass: 'btn-danger',
			act: (reason) =>
				firstValueFrom(this.gateway.cancelVoucher(voucher.id, reason)).catch((error: unknown) => {
					const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
					const known = selfInvoiceProblemKey(message);
					throw { error: { message: known ? this.transloco.translate(known.key, known.params) : message } };
				}),
		});
		if (await popup.result.catch(() => null)) {
			await this.queryClient.invalidateQueries({ queryKey: ['payment-vouchers'] });
			await this.queryClient.invalidateQueries({ queryKey: ['self-invoices'] });
		}
	}

	/** The page of what it paid: the self-invoice, the expense bill, or the purchase entry. */
	againstLink(voucher: PaymentVoucher): string[] {
		if (voucher.against.kind === 'selfInvoice') return ['/accounts/self-invoices', voucher.against.id];
		if (voucher.against.kind === 'expenseBill') return ['/expense-bills', voucher.against.id];
		return ['/purchase-entries', voucher.against.id];
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
