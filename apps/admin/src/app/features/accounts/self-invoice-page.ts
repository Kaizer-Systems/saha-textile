import { Component, computed, effect, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { selfInvoiceDay } from '@saha-textile/core-domain/self-invoice';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { SELF_INVOICE_KEYS, SelfInvoicesGateway, selfInvoiceProblemKey } from '@core/accounts/self-invoices.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PAYMENT_MODES, parseRupees } from '@features/purchasing/shared/payment-popup';
import { ReasonPopup } from '@features/purchasing/shared/reason-popup';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { bankLedgers } from './cash-bank-ledgers';
import { editLogRows } from './edit-log-rows';
import { rupees } from './ledger-helpers';

import type { Ledger, PaymentMode, SelfInvoice } from '@saha-textile/contracts';

/**
 * D3: an issued self-invoice (as drawn): its details and the day of the 30 it was made on, Print and Record payment.
 * Paying issues the payment voucher (Rule 52) and reminds you of the reverse-charge tax still to pay. A draft opens
 * the D2 form instead; a super admin cancels an unpaid one while its month isn't filed.
 */
@Component({
	selector: 'app-self-invoice-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './self-invoice-page.html',
})
export class SelfInvoicePage {
	private readonly gateway = inject(SelfInvoicesGateway);
	private readonly ledgers = inject(LedgerGateway);
	private readonly modals = inject(NgbModal);
	private readonly router = inject(Router);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly today = istDay(new Date());
	readonly modes = PAYMENT_MODES;
	readonly busy = signal(false);
	readonly amount = signal('');
	readonly paidOn = signal(this.today);
	readonly mode = signal<PaymentMode>('bank_transfer');
	readonly reference = signal('');
	readonly paidFrom = signal('');
	readonly banks = signal<Ledger[]>([]);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	private modal: NgbModalRef | null = null;
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly invoice = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.get(this.id())),
		enabled: !!this.id(),
	}));
	readonly log = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.log(this.id()),
		queryFn: () => firstValueFrom(this.gateway.log(this.id())),
		enabled: !!this.id(),
	}));
	readonly vouchers = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.vouchers(this.id()),
		queryFn: () => firstValueFrom(this.gateway.paymentVouchers(this.id())),
		enabled: !!this.id(),
	}));

	constructor() {
		// A draft is still the D2 form.
		effect(() => {
			const invoice = this.invoice.data();
			if (invoice?.status === 'draft') void this.router.navigate(['/accounts/self-invoices', invoice.id, 'edit']);
		});
	}

	readonly logRows = computed(() => {
		this.lang();
		return editLogRows(this.log.data() ?? [], (key, params) => this.transloco.translate(key, params), this.inr);
	});
	/** "Made on day 20 of 30". */
	readonly madeOnDay = computed(() => {
		const invoice = this.invoice.data();
		return invoice?.date ? selfInvoiceDay(invoice.receivedOn, invoice.date) : 0;
	});
	readonly owed = computed(() => {
		const invoice = this.invoice.data();
		return invoice ? Math.round((invoice.taxableINR - invoice.paidINR) * 100) / 100 : 0;
	});
	readonly canPay = computed(
		() =>
			this.invoice.data()?.status === 'issued' &&
			this.owed() > 0 &&
			this.auth.permissions().includes('purchase.payment'),
	);
	readonly canCancel = computed(() => {
		const invoice = this.invoice.data();
		return (
			invoice?.status === 'issued' && invoice.paidINR === 0 && this.auth.permissions().includes('accounts.post')
		);
	});
	readonly amountValue = computed(() => parseRupees(this.amount()));
	/** "Paid from" shows only when a transfer could come from more than one bank. */
	readonly choosesBank = computed(() => this.mode() !== 'cash' && this.banks().length > 1);
	readonly canConfirm = computed(() => {
		const value = this.amountValue();
		return (
			!this.busy() &&
			value !== null &&
			value > 0 &&
			value <= this.owed() + 0.005 &&
			!!this.paidOn() &&
			(!this.choosesBank() || !!this.paidFrom())
		);
	});
	readonly settles = computed(() => (this.amountValue() ?? 0) >= this.owed() - 0.005);

	day(iso: string): string {
		return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	monthName(month: string): string {
		return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
	}

	private translateProblem(error: unknown): string {
		const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
		const known = selfInvoiceProblemKey(message);
		return known ? this.transloco.translate(known.key, known.params) : message;
	}

	private async refresh(): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: ['self-invoices', this.id()] });
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			this.modal?.close();
			await this.refresh();
		} catch (error) {
			this.notifier.showError(this.translateProblem(error));
		} finally {
			this.busy.set(false);
		}
	}

	print(): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.pdf(this.id()))));
	}

	async openPay(template: TemplateRef<unknown>): Promise<void> {
		this.amount.set(String(this.owed()));
		this.paidOn.set(this.today);
		this.mode.set('bank_transfer');
		this.reference.set('');
		this.paidFrom.set('');
		if (!this.banks().length) this.banks.set(bankLedgers(await firstValueFrom(this.ledgers.chart())));
		this.modal = this.modals.open(template, { centered: true });
	}

	pay(invoice: SelfInvoice): Promise<void> {
		return this.run(async () => {
			const { voucher } = await firstValueFrom(
				this.gateway.pay(invoice.id, {
					amountINR: this.amountValue() ?? 0,
					paidOn: this.paidOn(),
					mode: this.mode(),
					reference: this.reference().trim() || null,
					paidFromLedgerId: this.choosesBank() ? this.paidFrom() : null,
					version: invoice.version,
				}),
			);
			this.notifier.showSuccess(this.transloco.translate('si_paid_done', { number: voucher.number }));
		});
	}

	async cancel(invoice: SelfInvoice): Promise<void> {
		const popup = this.modals.open(ReasonPopup, { centered: true });
		(popup.componentInstance as ReasonPopup).start({
			title: 'si_cancel_title',
			params: { number: invoice.number },
			body: 'si_cancel_body',
			label: 'si_cancel_reason',
			confirm: 'si_cancel_confirm',
			confirmClass: 'btn-danger',
			act: (reason) =>
				firstValueFrom(this.gateway.cancel(invoice.id, { reason, version: invoice.version })).catch(
					(error: unknown) => {
						throw { error: { message: this.translateProblem(error) } };
					},
				),
		});
		if (await popup.result.catch(() => null)) await this.refresh();
	}
}
