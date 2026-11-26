import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { REFUND_VOUCHER_KEYS, RefundVouchersGateway, refundProblemKey } from '@core/accounts/refund-vouchers.gateway';
import { ORDERS_KEY, OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { cashAndBankLedgers } from './cash-bank-ledgers';
import { editLogRows } from './edit-log-rows';
import { rupees } from './ledger-helpers';

import type { Ledger } from '@saha-textile/contracts';

/**
 * A refund voucher (accounts brief C2, as drawn): what it gives back and why, its edit log and what it changed.
 * Made with the refund and never edited; a refund the gateway refused is tried again or paid by bank transfer.
 */
@Component({
	selector: 'app-refund-voucher-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './refund-voucher-page.html',
})
export class RefundVoucherPage {
	private readonly gateway = inject(RefundVouchersGateway);
	private readonly orders = inject(OrdersGateway);
	private readonly ledgers = inject(LedgerGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly busy = signal(false);
	readonly ledgerId = signal('');
	readonly reference = signal('');
	readonly payFrom = signal<Ledger[]>([]);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	private modal: NgbModalRef | null = null;
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly voucher = injectQuery(() => ({
		queryKey: REFUND_VOUCHER_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.get(this.id())),
		enabled: !!this.id(),
	}));
	readonly log = injectQuery(() => ({
		queryKey: REFUND_VOUCHER_KEYS.log(this.id()),
		queryFn: () => firstValueFrom(this.gateway.log(this.id())),
		enabled: !!this.id(),
	}));
	private readonly orderId = computed(() => this.voucher.data()?.orderId ?? '');
	readonly order = injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'detail', this.orderId()],
		queryFn: () => firstValueFrom(this.orders.detail(this.orderId())),
		enabled: !!this.orderId(),
	}));
	readonly pieces = computed(() => (this.order.data()?.order.lines ?? []).reduce((sum, l) => sum + l.quantity, 0));
	readonly logRows = computed(() => {
		this.lang();
		return editLogRows(this.log.data() ?? [], (key, params) => this.transloco.translate(key, params), this.inr);
	});
	/** Try again or pay by hand: only while the money hasn't gone back, and only with the right to refund. */
	readonly canAct = computed(
		() =>
			!!this.voucher.data() &&
			this.voucher.data()?.status !== 'refunded' &&
			this.auth.permissions().includes('refund.action'),
	);

	day(iso: string): string {
		return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	private async run(work: () => Promise<void>, done: string | null = null): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			this.modal?.close();
			await this.queryClient.invalidateQueries({ queryKey: REFUND_VOUCHER_KEYS.one(this.id()) });
			await this.queryClient.invalidateQueries({ queryKey: REFUND_VOUCHER_KEYS.log(this.id()) });
			if (done) this.notifier.showSuccess(this.transloco.translate(done));
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const refusal = refundProblemKey(message);
			this.notifier.showError(refusal ? this.transloco.translate(refusal) : message);
		} finally {
			this.busy.set(false);
		}
	}

	print(): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.pdf(this.id()))));
	}

	retry(): Promise<void> {
		return this.run(async () => void (await firstValueFrom(this.gateway.retry(this.id()))), 'rf_retried');
	}

	async openByHand(template: TemplateRef<unknown>): Promise<void> {
		this.ledgerId.set('');
		this.reference.set('');
		if (!this.payFrom().length) this.payFrom.set(cashAndBankLedgers(await firstValueFrom(this.ledgers.chart())));
		this.modal = this.modals.open(template, { centered: true });
	}

	byHand(): Promise<void> {
		return this.run(
			async () =>
				void (await firstValueFrom(
					this.gateway.byHand(this.id(), { ledgerId: this.ledgerId(), reference: this.reference().trim() }),
				)),
			'rf_paid_by_hand',
		);
	}
}
