import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PILLS, RupeesPipe, ShortDatePipe, ShortDateTimePipe } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway, injectSupplierSummaryQuery } from '@core/purchasing/purchasing.gateway';
import { injectInventorySettingsQuery } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe, translateCount } from '@shared/pipes/language.pipes';

import { termsText } from './supplier-list';
import { exportSupplierStatement, recordSupplierPayment } from '../shared/supplier-actions';

import type { SupplierStatementRow } from '@saha-textile/contracts';

export type SupplierTab = 'purchases' | 'payments' | 'returns' | 'statement' | 'activity';

/** Where a statement row's document opens. */
export function statementLink(row: SupplierStatementRow): string[] | null {
	if (row.kind === 'bill' || row.kind === 'payment' || row.kind === 'payment_reversed') {
		return ['/purchase-entries', row.documentId];
	}
	if (
		row.kind === 'debit_note' ||
		row.kind === 'credit_note' ||
		row.kind === 'refund_received' ||
		row.kind === 'claim_written_off'
	) {
		return ['/purchase-returns', row.documentId];
	}
	return null;
}

/** The supplier page (s03): what we owe, what we bought and returned, and every document with a running balance. */
@Component({
	selector: 'app-supplier-page',
	templateUrl: './supplier-page.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		TranslocoModule,
	],
})
export class SupplierPage {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');
	readonly tab = signal<SupplierTab>('statement');
	readonly tabs: readonly SupplierTab[] = ['purchases', 'payments', 'returns', 'statement', 'activity'];
	readonly pills = PILLS;

	readonly summary = injectSupplierSummaryQuery(() => this.id() || null);
	readonly supplier = computed(() => this.summary.data()?.supplier ?? null);
	private readonly settings = injectInventorySettingsQuery(() => this.auth.permissions().includes('setting.index'));
	/** Bills older than this (days) are near the 180-day input-credit limit (x02). */
	readonly alertDays = computed(() => this.settings.data()?.unpaidAlertDays ?? 150);

	readonly entries = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.entries, 'supplier', this.id()],
		queryFn: () =>
			firstValueFrom(this.gateway.entries({ supplierId: this.id(), pageSize: 100, page: 1, filter: 'all' })),
		enabled: !!this.id() && this.tab() === 'purchases',
	}));
	readonly returns = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.returns, 'supplier', this.id()],
		queryFn: () =>
			firstValueFrom(this.gateway.returns({ supplierId: this.id(), pageSize: 100, page: 1, filter: 'all' })),
		enabled: !!this.id() && this.tab() === 'returns' && this.auth.permissions().includes('purchase_return.index'),
	}));
	readonly activity = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.suppliers, 'activity', this.id()],
		queryFn: () => firstValueFrom(this.gateway.supplierActivity(this.id())),
		enabled: !!this.id() && this.tab() === 'activity',
	}));

	/** Payments are the statement's payment rows (one place for the numbers). */
	readonly payments = computed(() =>
		(this.summary.data()?.statement ?? []).filter(
			(row) => row.kind === 'payment' || row.kind === 'payment_reversed',
		),
	);

	readonly terms = computed(() => {
		const supplier = this.supplier();
		if (!supplier) return '';
		return termsText(
			supplier.paymentTermsDays,
			(key, count) => translateCount(this.transloco, key, count),
			(key) => this.transloco.translate(key),
		);
	});
	readonly taxKey = computed(() => {
		const supplier = this.supplier();
		if (!supplier || supplier.taxType === 'none') return 'tax_none';
		return supplier.taxType === 'intra_state' ? 'tax_cgst_sgst' : 'tax_igst';
	});

	link = statementLink;

	edit(): void {
		void this.router.navigate(['/suppliers', this.id(), 'edit']);
	}

	/** The statement as a spreadsheet for the CA or the supplier (s03 Export statement). */
	exportStatement(): void {
		const summary = this.summary.data();
		if (summary) exportSupplierStatement(summary, (key) => this.transloco.translate(key));
	}

	/** Record payment (s03): the same popup as on a purchase entry, with the unpaid bills to pick from. */
	async recordPayment(): Promise<void> {
		await recordSupplierPayment(this.id(), {
			gateway: this.gateway,
			modals: this.modals,
			notifier: this.notifier,
			queryClient: this.queryClient,
			t: (key) => this.transloco.translate(key),
		});
	}
}
