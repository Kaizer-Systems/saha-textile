import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type Params } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { ACCOUNTS_LIST_KEYS, AccountsListsGateway } from '@core/accounts/accounts-lists.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, downloadCsv, openPdf, rupees } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ADJUST_REASONS } from '@features/stock/adjust-popup';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import { LIST_COLUMNS, listCell, viewLink, type ListKind } from './accounts-list-columns';
import { accountsHint, accountsRange } from './accounts-period';

import type { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import type { AccountsListQuery, AccountsListRow, AccountsListTab } from '@saha-textile/contracts';

/** The tabs of Accounts › Vouchers, in the order A1 draws them. */
export const VOUCHER_TABS: readonly AccountsListTab[] = [
	'receipts',
	'paymentVouchers',
	'contra',
	'journal',
	'creditNotes',
	'debitNotes',
	'refundVouchers',
	'selfInvoices',
	'stockAdjustments',
];

/**
 * The chips each tab and the Day book offer: `ACCOUNTS_LIST_CHIPS` and `DAY_BOOK_CHIPS` from the contracts, repeated
 * because this app takes only types from that package; the spec fails if they ever differ.
 */
export const LIST_CHIPS: Readonly<Record<ListKind, readonly string[]>> = {
	receipts: ['all', 'against_orders', 'on_account', 'refunded'],
	paymentVouchers: ['all', 'reverse_charge', 'supplier_bills', 'cancelled'],
	contra: ['all'],
	journal: ['all', 'set_offs', 'reversals', 'itc_reversed'],
	creditNotes: ['all', 'drafts', 'waiting_for_buyer', 'issued', 'cancelled'],
	debitNotes: ['all'],
	refundVouchers: ['all', 'refunded', 'waiting_for_gateway', 'failed'],
	selfInvoices: ['all', 'drafts', 'due_soon', 'unpaid', 'paid'],
	stockAdjustments: ['all', 'waiting', 'posted', 'reversed'],
	taxInvoices: ['all', 'counter', 'online', 'staff_orders', 'business'],
	purchaseBills: ['all', 'posted', 'void'],
	dayBook: ['all', 'receipts', 'refunds', 'creditNotes', 'payments', 'selfInvoices', 'journals', 'stockAdjustments'],
};

/** The two tabs of Accounts › Sales and purchases (Q8). */
export const SALES_TABS: readonly AccountsListTab[] = ['taxInvoices', 'purchaseBills'];

/** The period each list opens on, as the pictures draw them. */
const START: Readonly<Record<ListKind, PeriodChoice['period']>> = {
	receipts: 'last_30_days',
	paymentVouchers: 'this_fy',
	contra: 'this_month',
	journal: 'this_fy',
	creditNotes: 'last_30_days',
	debitNotes: 'last_30_days',
	refundVouchers: 'this_fy',
	selfInvoices: 'this_fy',
	stockAdjustments: 'last_30_days',
	taxInvoices: 'this_month',
	purchaseBills: 'this_month',
	dayBook: 'this_month',
};

/** The lists whose documents print (journal and contra vouchers have no print of their own). */
const PRINTABLE = new Set<ListKind>([
	'receipts',
	'paymentVouchers',
	'creditNotes',
	'debitNotes',
	'refundVouchers',
	'selfInvoices',
	'stockAdjustments',
]);

/** Every reason a stock adjustment can carry, once each (A9 "Every reason"). */
export const ADJUSTMENT_REASONS = [...new Set([...ADJUST_REASONS.remove, ...ADJUST_REASONS.add])];

interface ListTableRow {
	id: string;
	row: AccountsListRow;
	[cell: string]: unknown;
}

/** The CSV's columns: every list's rows in one plain shape, for the CA. */
export function csvRows(rows: readonly AccountsListRow[], t: (key: string) => string): string[][] {
	return rows.map((row) => [
		t(`al_voucher_${row.tab}`),
		row.number ?? '',
		row.date,
		row.party ?? '',
		row.against ?? '',
		row.reference ?? '',
		row.amountINR === null ? '' : String(row.amountINR),
		row.moneyInINR === null ? '' : String(row.moneyInINR),
		row.moneyOutINR === null ? '' : String(row.moneyOutINR),
		row.stock === null ? '' : String(row.stock),
		row.by ?? '',
		t(`al_status_${row.status}`),
	]);
}
export const CSV_HEAD = [
	'al_col_voucher',
	'al_col_number',
	'date',
	'al_col_party',
	'al_col_against',
	'al_col_reference',
	'al_col_amount',
	'al_col_money_in',
	'al_col_money_out',
	'al_col_stock',
	'al_col_by',
	'al_col_status',
];

/**
 * Accounts › Vouchers (accounts brief A1–A9) and the Day book (A3), on the admin's own table: a tab per kind of
 * voucher, chips with their counts, the period (A1/A2), a search that runs on the server, ticks that stay through
 * pages and search with their picks bar, each row's view and print, and the CSV for the CA.
 */
@Component({
	selector: 'app-accounts-list-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, PeriodPicker, Table],
	templateUrl: './accounts-list-page.html',
})
export class AccountsListPage {
	private readonly gateway = inject(AccountsListsGateway);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly auth = inject(AuthStore);
	private readonly places = inject(LocationsGateway);

	readonly kind = toSignal(inject(ActivatedRoute).data.pipe(map((data) => data['list'] as ListKind)), {
		initialValue: 'dayBook' as ListKind,
	});
	readonly tabs = VOUCHER_TABS;
	readonly salesTabs = SALES_TABS;
	/** Which page this list sits on: Vouchers, Sales and purchases, or the Day book. */
	readonly group = computed(() =>
		this.kind() === 'dayBook' ? 'day' : SALES_TABS.includes(this.kind() as AccountsListTab) ? 'sales' : 'vouchers',
	);
	readonly presets = ACCOUNTS_PRESETS;
	readonly hint = accountsHint;
	readonly reasons = ADJUSTMENT_REASONS;
	readonly canPost = computed(() => this.auth.permissions().includes('accounts.post'));
	readonly chips = computed(() => LIST_CHIPS[this.kind()]);
	readonly start = computed(() => START[this.kind()]);

	readonly chip = signal('all');
	readonly reason = signal<string | null>(null);
	readonly location = signal<string | null>(null);
	readonly range = signal<{ from: string; to: string } | null>(null);
	private readonly params = signal<Params>({});
	readonly busy = signal(false);
	/** Every row seen, so picks on earlier pages still export. */
	private readonly seen = new Map<string, AccountsListRow>();

	readonly query = computed((): Partial<AccountsListQuery> => {
		const range = this.range() ?? accountsRange({ period: this.start() });
		const search = typeof this.params()['search'] === 'string' ? String(this.params()['search']).trim() : '';
		return {
			...range,
			chip: this.chip(),
			...(this.reason() ? { reason: this.reason() } : {}),
			...(this.location() ? { location: this.location() } : {}),
			...(search ? { search } : {}),
			page: Number(this.params()['page']) || 1,
			pageSize: Math.min(Number(this.params()['paginate']) || 30, 100),
		};
	});
	readonly list = injectQuery(() => ({
		queryKey: ACCOUNTS_LIST_KEYS.list(this.kind(), this.query()),
		queryFn: () => firstValueFrom(this.fetch(this.query())),
	}));
	readonly counts = computed(() => this.list.data()?.counts ?? {});
	/** Sales and purchases: the other tab's count over the same period, for its tab (Q8). */
	readonly sibling = injectQuery(() => {
		const other = SALES_TABS.find((tab) => tab !== this.kind()) as AccountsListTab;
		const { from, to } = this.query();
		return {
			queryKey: ACCOUNTS_LIST_KEYS.list(other, { from, to, pageSize: 1 }),
			queryFn: () => firstValueFrom(this.gateway.list(other, { from, to, pageSize: 1 })),
			enabled: this.group() === 'sales',
		};
	});
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.places.list()),
		enabled: this.kind() === 'taxInvoices',
	}));
	readonly totals = computed(() => this.list.data()?.totals ?? {});

	readonly tableConfig = computed((): ITableConfig<ListTableRow> => {
		this.lang();
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const columns = LIST_COLUMNS[this.kind()];
		const page = this.list.data();
		for (const row of page?.items ?? []) this.seen.set(row.id, row);
		return {
			columns: columns.map((column) => ({
				title: column.title,
				dataField: column.field,
				...(column.align ? { align: column.align } : {}),
			})),
			rowActions: [
				{ label: 'al_view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'accounts.index' },
				{ label: 'inv_print', actionToPerform: 'print', icon: 'ri-printer-line', permission: 'accounts.index' },
			],
			bulkActions: [
				...(PRINTABLE.has(this.kind())
					? [{ label: 'inv_print', actionToPerform: 'print_picked', icon: 'ri-printer-line', direct: true }]
					: []),
				{ label: 'al_export_picked', actionToPerform: 'export', icon: 'ri-download-2-line', direct: true },
			],
			bulkDelete: false,
			pickView: (row) => ({
				title: row.row.number ?? t('al_no_number'),
				detail: [row.row.party, row.row.amountINR === null ? null : rupees(row.row.amountINR)]
					.filter(Boolean)
					.join(' · '),
			}),
			data: (page?.items ?? []).map((row) => ({
				id: row.id,
				row,
				...Object.fromEntries(columns.map((column) => [column.field, listCell(row, column.field, t)])),
			})),
			total: page?.total ?? 0,
		};
	});
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly inr = (value: number | undefined) => rupees(value ?? 0);

	private fetch(query: Partial<AccountsListQuery>) {
		const kind = this.kind();
		return kind === 'dayBook' ? this.gateway.dayBook(query) : this.gateway.list(kind, query);
	}

	setChip(chip: string): void {
		this.chip.set(chip);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	/** How many rows a Sales and purchases tab holds: this one's from its own list, the other's from its count. */
	tabCount(tab: AccountsListTab): number | null {
		return tab === this.kind() ? (this.list.data()?.total ?? null) : (this.sibling.data()?.total ?? null);
	}

	setLocation(location: string): void {
		this.location.set(location || null);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setReason(reason: string): void {
		this.reason.set(reason || null);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(params?: Params): void {
		this.params.set({ ...params });
	}

	open(row: ListTableRow): void {
		const link = viewLink(row.row);
		if (link) void this.router.navigate(link);
	}

	async onAction(action: ITableClickedAction): Promise<void> {
		if (action.actionToPerform === 'export' || action.actionToPerform === 'print_picked') {
			const ids = (action.data as string[] | undefined) ?? [];
			if (action.actionToPerform === 'export')
				this.save(
					ids.flatMap((id) => this.seen.get(id) ?? []),
					'picked',
				);
			else await this.printPicked(ids);
			return;
		}
		const row = action.data as ListTableRow | undefined;
		if (!row) return;
		if (action.actionToPerform === 'view') this.open(row);
		else if (action.actionToPerform === 'print') await this.print(row.row);
	}

	async print(row: AccountsListRow): Promise<void> {
		const path = this.gateway.pdfPath(row);
		if (!path) {
			this.notifier.showError(this.transloco.translate('al_no_print'));
			return;
		}
		await this.run(async () => openPdf(await firstValueFrom(this.gateway.pdf(path))));
	}

	/** One PDF of the picked documents, those without a print left out. */
	printPicked(ids: readonly string[]): Promise<void> {
		return this.run(async () =>
			openPdf(await firstValueFrom(this.gateway.printPicked(this.kind() as AccountsListTab, ids))),
		);
	}

	/** Export CSV: every row of the chip, period and search, page by page. */
	exportCsv(): Promise<void> {
		return this.run(async () => {
			const rows: AccountsListRow[] = [];
			for (let page = 1; ; page++) {
				const part = await firstValueFrom(this.fetch({ ...this.query(), page, pageSize: 100 }));
				rows.push(...part.items);
				if (rows.length >= part.total || !part.items.length) break;
			}
			this.save(rows, 'all');
		});
	}

	private save(rows: readonly AccountsListRow[], what: string): void {
		const t = (key: string) => this.transloco.translate(key);
		const { from, to } = this.query();
		downloadCsv(`${this.kind()}-${what}-${from}-${to}.csv`, CSV_HEAD.map(t), csvRows(rows, t));
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
		} catch (error) {
			const problem = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
			this.notifier.showError(
				problem === 'nothing_to_print' ? this.transloco.translate('al_problem_nothing_to_print') : problem,
			);
		} finally {
			this.busy.set(false);
		}
	}
}
