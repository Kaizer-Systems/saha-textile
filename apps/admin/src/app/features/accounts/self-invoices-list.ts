import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { selfInvoiceDay, selfInvoiceDeadline } from '@saha-textile/core-domain/self-invoice';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { AuthStore } from '@core/state/auth.store';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { rupees } from './ledger-helpers';

import type { DashboardPeriodQuery, SelfInvoice, SelfInvoiceListFilter } from '@saha-textile/contracts';

const PAGE_SIZE = 25;

/**
 * Accounts › Self-invoices (accounts brief A7): reverse-charge supplies with the 30-day clock (Rule 47A), by the day
 * received; "Record a reverse-charge supply" opens D2.
 */
@Component({
	selector: 'app-self-invoices-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, PeriodPicker],
	templateUrl: './self-invoices-list.html',
})
export class SelfInvoicesListPage {
	private readonly gateway = inject(SelfInvoicesGateway);
	private readonly auth = inject(AuthStore);

	readonly chips: readonly SelfInvoiceListFilter[] = ['all', 'drafts', 'due_soon', 'unpaid', 'paid'];
	readonly today = istDay(new Date());
	readonly filter = signal<SelfInvoiceListFilter>('all');
	readonly search = signal('');
	readonly range = signal(periodRange({ period: 'last_12_months' }));
	readonly page = signal(1);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	readonly canRecord = computed(() => this.auth.permissions().includes('accounts.post'));

	private readonly listQuery = computed(() => ({
		from: this.range().from ?? '2017-07-01',
		to: this.range().to ?? this.today,
		search: this.search().trim(),
		filter: this.filter(),
		page: this.page(),
		pageSize: PAGE_SIZE,
	}));
	readonly list = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.list(this.listQuery()),
		queryFn: () => firstValueFrom(this.gateway.list(this.listQuery())),
	}));
	readonly pages = computed(() => Math.max(1, Math.ceil((this.list.data()?.total ?? 0) / PAGE_SIZE)));

	setFilter(filter: SelfInvoiceListFilter): void {
		this.filter.set(filter);
		this.page.set(1);
	}

	setPeriod(q: DashboardPeriodQuery): void {
		this.range.set(periodRange(q));
		this.page.set(1);
	}

	/** The 30-day clock: "Due in 25 days", "Late by 3 days", or the day of the 30 it was made on. */
	clock(invoice: SelfInvoice): { key: string; count: number; tone: 'pending' | 'danger' | 'success' } {
		if (invoice.date)
			return { key: 'si_clock_made', count: selfInvoiceDay(invoice.receivedOn, invoice.date), tone: 'success' };
		const left = selfInvoiceDay(this.today, selfInvoiceDeadline(invoice.receivedOn));
		return left >= 0
			? { key: 'si_clock_due', count: left, tone: 'pending' }
			: { key: 'si_clock_late', count: -left, tone: 'danger' };
	}

	lastVoucher(invoice: SelfInvoice): string {
		return invoice.paymentVouchers.at(-1)?.number ?? '—';
	}

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}
}
