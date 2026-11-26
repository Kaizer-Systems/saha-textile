import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { EXPENSE_BILL_KEYS, ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { AuthStore } from '@core/state/auth.store';
import { periodRange } from '@features/accounts/edoc-list';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import type { DashboardPeriodQuery, ExpenseBill, ExpenseBillStatus } from '@saha-textile/contracts';

const PAGE_SIZE = 25;
export type ExpenseBillChip = ExpenseBillStatus | 'all';

/**
 * Purchases › Expense bills (brief 25 EB1): bills for services and expenses by bill date, with their status and the
 * tax claimed; "New expense bill" opens the form. Built from the self-invoice list's parts.
 */
@Component({
	selector: 'app-expense-bill-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, PeriodPicker, ExportMenu],
	templateUrl: './bill-list.html',
})
export class ExpenseBillListPage {
	private readonly gateway = inject(ExpenseBillsGateway);
	private readonly auth = inject(AuthStore);
	private readonly transloco = inject(TranslocoService);

	readonly chips: readonly ExpenseBillChip[] = ['all', 'draft', 'posted', 'cancelled'];
	readonly filter = signal<ExpenseBillChip>('all');
	readonly search = signal('');
	readonly range = signal(periodRange({ period: 'last_12_months' }));
	readonly page = signal(1);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts.edit'));

	private readonly listQuery = computed(() => ({ status: this.filter(), ...this.range() }));
	readonly list = injectQuery(() => ({
		queryKey: EXPENSE_BILL_KEYS.list(this.listQuery()),
		queryFn: () => firstValueFrom(this.gateway.list(this.listQuery())),
	}));
	/** The bills that match the search: supplier, their bill number or ours. */
	readonly rows = computed(() => {
		const words = this.search().trim().toLowerCase();
		const bills = this.list.data() ?? [];
		return words
			? bills.filter((b) =>
					[b.supplierName, b.billNumber, b.number ?? ''].some((v) => v.toLowerCase().includes(words)),
				)
			: bills;
	});
	readonly pages = computed(() => Math.max(1, Math.ceil(this.rows().length / PAGE_SIZE)));
	readonly shown = computed(() => this.rows().slice((this.page() - 1) * PAGE_SIZE, this.page() * PAGE_SIZE));

	setFilter(filter: ExpenseBillChip): void {
		this.filter.set(filter);
		this.page.set(1);
	}

	setPeriod(q: DashboardPeriodQuery): void {
		this.range.set(periodRange(q));
		this.page.set(1);
	}

	/** Claimable input tax: CGST and SGST, or IGST. */
	claimed(bill: ExpenseBill): number {
		return bill.cgstINR + bill.sgstINR + bill.igstINR;
	}

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	/** Every matching bill (not only the page in view), as the table shows them. */
	readonly exportSource = (): ExportSource => {
		const t = (key: string) => this.transloco.translate(key);
		const { from, to } = this.range();
		return {
			fileName: `expense-bills_${from ?? 'all'}_${to ?? 'today'}`,
			title: t('eb_list_title'),
			area: 'accounts',
			filters: [
				{ label: t('eb_filter_status'), value: t(`eb_chip_${this.filter()}`) },
				{ label: t('eb_filter_dates'), value: `${from ?? '—'} – ${to ?? '—'}` },
				...(this.search().trim() ? [{ label: t('search'), value: this.search().trim() }] : []),
			],
			header: [
				t('eb_number'),
				t('eb_supplier'),
				t('eb_their_bill'),
				t('eb_bill_date'),
				t('eb_taxable'),
				t('eb_claimed'),
				t('eb_blocked'),
				t('eb_total'),
				t('status'),
			],
			rows: this.rows().map((b) => [
				b.number ?? '',
				b.supplierName,
				b.billNumber,
				b.billDate,
				b.taxableINR,
				this.claimed(b),
				b.blockedTaxINR,
				b.totalINR,
				t(`eb_status_${b.status}`),
			]),
			kinds: { 4: 'money', 5: 'money', 6: 'money', 7: 'money' },
		};
	};
}
