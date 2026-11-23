import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { apiProblem, downloadCsv, openPdf } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { rupees } from './ledger-helpers';

import type { DashboardPeriodQuery, PaymentVoucher, PaymentVoucherListFilter } from '@saha-textile/contracts';

const PAGE_SIZE = 25;

/**
 * Accounts › Payment vouchers (accounts brief A6, decision D5): every payment to a supplier, with the reverse-charge
 * tax where it applies; view, print, and the whole list as a CSV file.
 */
@Component({
	selector: 'app-payment-vouchers-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, PeriodPicker],
	templateUrl: './payment-vouchers-list.html',
})
export class PaymentVouchersListPage {
	private readonly gateway = inject(SelfInvoicesGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly chips: readonly PaymentVoucherListFilter[] = ['all', 'reverse_charge', 'supplier_bills', 'cancelled'];
	readonly today = istDay(new Date());
	readonly filter = signal<PaymentVoucherListFilter>('all');
	readonly search = signal('');
	readonly range = signal(periodRange({ period: 'last_12_months' }));
	readonly page = signal(1);
	readonly busy = signal(false);
	readonly inr = (value: number) => rupees(Math.round(value * 100));

	private readonly listQuery = computed(() => ({
		from: this.range().from ?? '2017-07-01',
		to: this.range().to ?? this.today,
		search: this.search().trim(),
		filter: this.filter(),
		page: this.page(),
		pageSize: PAGE_SIZE,
	}));
	readonly list = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.voucherList(this.listQuery()),
		queryFn: () => firstValueFrom(this.gateway.voucherList(this.listQuery())),
	}));
	readonly pages = computed(() => Math.max(1, Math.ceil((this.list.data()?.total ?? 0) / PAGE_SIZE)));

	setFilter(filter: PaymentVoucherListFilter): void {
		this.filter.set(filter);
		this.page.set(1);
	}

	setPeriod(q: DashboardPeriodQuery): void {
		this.range.set(periodRange(q));
		this.page.set(1);
	}

	/** "Bose Properties (not registered)" for reverse charge, as A6 draws it. */
	payee(voucher: PaymentVoucher): string {
		return voucher.against.kind === 'selfInvoice'
			? this.transloco.translate('pv_payee_unregistered', { name: voucher.payeeName })
			: voucher.payeeName;
	}

	against(voucher: PaymentVoucher): string {
		return voucher.against.detail
			? `${voucher.against.number} · ${voucher.against.detail}`
			: voucher.against.number;
	}

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	print(voucher: PaymentVoucher): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.voucherPdf(voucher.id))));
	}

	/** Export CSV: every voucher of the chosen chip, period and search, page by page. */
	exportCsv(): Promise<void> {
		return this.run(async () => {
			const rows: PaymentVoucher[] = [];
			for (let page = 1; ; page++) {
				const part = await firstValueFrom(
					this.gateway.voucherList({ ...this.listQuery(), page, pageSize: 100 }),
				);
				rows.push(...part.items);
				if (rows.length >= part.total || !part.items.length) break;
			}
			const t = (key: string) => this.transloco.translate(key);
			downloadCsv(
				`payment-vouchers-${this.listQuery().from}-${this.listQuery().to}.csv`,
				[
					t('pv_number'),
					t('date'),
					t('rf_paid_to'),
					t('pv_against'),
					t('payment_how'),
					t('payment_reference'),
					t('doc_amount'),
					t('pv_rcm_we_pay'),
				],
				rows.map((v) => [
					v.number,
					v.date,
					v.payeeName,
					this.against(v),
					t(`payment_mode_${v.mode}`),
					v.reference,
					v.amountINR,
					v.reverseChargeTaxINR,
				]),
			);
		});
	}
}
