import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { entryOutstanding } from '@saha-textile/core-domain/purchasing';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import {
	PILLS,
	RupeesPipe,
	ShortDatePipe,
	ShortDateTimePipe,
	StockQuantityPipe,
	apiIssues,
	type ApiIssue,
} from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { ENTRY_STEPS, entryStep } from './entry-steps';
import { VoidRefused } from './void-refused';
import { PaymentPopup } from '../shared/payment-popup';
import { askReason } from '../shared/popups';
import { returnStatus, returnWhy } from '../shared/purchasing-labels';

import type { PurchaseEntry, SupplierPayment } from '@saha-textile/contracts';

export type EntryTab = 'lines' | 'payments' | 'returns' | 'activity';

/**
 * A purchase entry (p10, p10b, x03): steps on top, lines, then Summary and Supplier-and-bill on the
 * right. Posted entries are locked: mistakes are fixed with a purchase return or an adjustment, or
 * by voiding while nothing from it has moved on.
 */
@Component({
	selector: 'app-entry-view',
	templateUrl: './entry-view.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class EntryView {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly paymentVouchers = inject(SelfInvoicesGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');
	readonly tab = signal<EntryTab>('lines');
	readonly tabs: readonly EntryTab[] = ['lines', 'payments', 'returns', 'activity'];
	readonly steps = ENTRY_STEPS;
	readonly pills = PILLS;
	readonly canSeeCost = computed(() => this.auth.permissions().includes('stock.cost'));

	readonly query = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.entries, 'one', this.id()],
		queryFn: () => firstValueFrom(this.gateway.entry(this.id())),
		enabled: !!this.id(),
	}));
	readonly payments = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.entries, 'payments', this.id()],
		queryFn: () => firstValueFrom(this.gateway.payments(this.id())),
		enabled: !!this.id() && this.tab() === 'payments',
	}));
	/** Each payment's own voucher (accounts brief D4, decision D5). */
	readonly vouchers = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.entryVouchers(this.id()),
		queryFn: () => firstValueFrom(this.paymentVouchers.purchaseEntryVouchers(this.id())),
		enabled: !!this.id() && this.tab() === 'payments',
	}));
	readonly voucherOf = computed(
		() => new Map((this.vouchers.data() ?? []).map((voucher) => [voucher.supplierPaymentId, voucher])),
	);
	readonly returns = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.returns, 'for-entry', this.id()],
		queryFn: () => firstValueFrom(this.gateway.returnsForEntry(this.id())),
		enabled: !!this.id() && this.tab() === 'returns' && this.auth.permissions().includes('purchase_return.index'),
	}));
	/** Read always: the Activity tab, and who posted for the Supplier-and-bill card. */
	readonly activity = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.entries, 'activity', this.id()],
		queryFn: () => firstValueFrom(this.gateway.entryActivity(this.id())),
		enabled: !!this.id(),
	}));

	readonly entry = computed(() => this.query.data() ?? null);
	readonly step = computed(() => {
		const entry = this.entry();
		return entry ? entryStep(entry) : 0;
	});
	readonly left = computed(() => {
		const entry = this.entry();
		return entry && entry.status === 'posted' ? Math.max(0, entryOutstanding(entry)) : 0;
	});
	readonly postedBy = computed(
		() => (this.activity.data() ?? []).find((row) => row.action === 'purchase.entry.post')?.actorName ?? null,
	);

	t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
	returnStatus = returnStatus;
	returnWhy = returnWhy;

	private refresh(): void {
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.entries });
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
		void this.queryClient.invalidateQueries({ queryKey: SELF_INVOICE_KEYS.entryVouchers(this.id()) });
	}

	edit(): void {
		void this.router.navigate(['/purchase-entries', this.id(), 'edit']);
	}

	check(): void {
		void this.router.navigate(['/purchase-entries', this.id(), 'check']);
	}

	returnToSupplier(): void {
		void this.router.navigate(['/purchase-returns', 'create'], { queryParams: { entry: this.id() } });
	}

	labels(): void {
		void this.router.navigate(['/purchase-entries', this.id(), 'labels']);
	}

	async recordPayment(): Promise<void> {
		const entry = this.entry();
		if (!entry) return;
		const popup = this.modals.open(PaymentPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'payment_popup_title',
		});
		(popup.componentInstance as PaymentPopup).start([
			{
				id: entry.id,
				number: entry.number ?? '',
				billNumber: entry.billNumber,
				totalINR: entry.totals.totalINR,
				paidINR: entry.paidINR,
				leftINR: this.left(),
			},
		]);
		if (await popup.result.catch(() => null)) {
			this.notifier.showSuccess(this.t('payment_saved'));
			this.refresh();
		}
	}

	async reversePayment(payment: SupplierPayment): Promise<void> {
		const done = await askReason(this.modals, {
			title: 'payment_reverse_title',
			body: 'payment_reverse_body',
			params: { amount: payment.amountINR },
			label: 'reason',
			confirm: 'payment_reverse_confirm',
			confirmClass: 'btn-danger',
			act: (reason) => firstValueFrom(this.gateway.reversePayment(this.id(), payment.id, reason)),
		});
		if (done) {
			this.notifier.showSuccess(this.t('payment_reversed'));
			this.refresh();
		}
	}

	/** Void (restricted): a reason, then either done, or p12 naming the pieces that moved on. */
	async voidEntry(): Promise<void> {
		const entry = this.entry();
		if (!entry) return;
		const done = (await askReason(this.modals, {
			title: 'void_title',
			body: 'void_body',
			params: { number: entry.number ?? '' },
			label: 'reason',
			help: 'void_help',
			confirm: 'void_confirm',
			confirmClass: 'btn-danger',
			act: async (reason) => {
				try {
					return await firstValueFrom(this.gateway.voidEntry(entry.id, reason));
				} catch (error) {
					// Pieces that moved on close this popup and open p12; any other refusal stays in it.
					const moved = apiIssues(error).filter((issue) => issue.code === 'void_stock_moved');
					if (moved.length) return { blocked: moved };
					throw error;
				}
			},
		})) as PurchaseEntry | { blocked: ApiIssue[] } | null;
		if (!done) return;
		if ('blocked' in done) {
			await this.showBlocked(done.blocked);
			return;
		}
		this.notifier.showSuccess(this.t('entry_voided', { number: entry.number ?? '' }));
		this.refresh();
	}

	private async showBlocked(issues: ApiIssue[]): Promise<void> {
		const popup = this.modals.open(VoidRefused, {
			centered: true,
			windowClass: 'theme-modal text-center',
			ariaLabelledBy: 'void_refused_title',
		});
		(popup.componentInstance as VoidRefused).start(issues);
		if ((await popup.result.catch(() => null)) === 'return') this.returnToSupplier();
	}

	/** Lines posted under the margin floor stay red (the warning accepted at posting, p10b). */
	readonly lowMargin = computed(() => {
		const entry = this.entry();
		const warnings = [...(entry?.acceptedWarnings ?? []), ...(entry?.warnings ?? [])];
		return new Set(warnings.filter((warning) => warning.code === 'margin_floor').map((warning) => warning.lineId));
	});
}
