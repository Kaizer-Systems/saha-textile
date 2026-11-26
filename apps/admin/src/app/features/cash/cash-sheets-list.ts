import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, type Params } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CASH_KEYS, CashGateway } from '@core/cash/cash.gateway';
import { escapeHtml } from '@core/purchasing/purchasing-format';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker, type PeriodChoice, type PeriodPreset } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import { SHEET_PILL, signedRupees } from './cash-format';

import type { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import type { CashSheetListQuery, CashSheetListRow } from '@saha-textile/contracts';

/** O11's chips, as drawn (the admin repeats the contract's list; a spec holds them equal). */
export const SHEET_CHIPS = ['all', 'difference', 'open'] as const;
type Chip = (typeof SHEET_CHIPS)[number];

/** The period presets the cash lists offer. */
export const CASH_PRESETS: readonly PeriodPreset[] = [
	'today',
	'last_7_days',
	'this_month',
	'last_month',
	'current_quarter',
	'this_fy',
	'custom',
];

type SheetTableRow = CashSheetListRow & { row: CashSheetListRow; [key: string]: unknown };

/**
 * Cash › Cash sheets (O11): every box and day (opening, in, out, counted, difference, status), with a difference or
 * still open, this month or another, at every location or one; and Differences to resolve, the same list on its chip.
 * Amounts show to managers only.
 */
@Component({
	selector: 'app-cash-sheets-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, Table, PeriodPicker],
	templateUrl: './cash-sheets-list.html',
})
export class CashSheetsListPage {
	private readonly gateway = inject(CashGateway);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly route = inject(ActivatedRoute);

	readonly chips = SHEET_CHIPS;
	readonly presets = CASH_PRESETS;
	readonly hint = accountsHint;
	readonly differences = !!this.route.snapshot.data['differences'];
	readonly chip = signal<Chip>(this.differences ? 'difference' : 'all');
	readonly location = signal<string | null>(null);
	readonly range = signal(accountsRange({ period: 'this_month' }));
	private readonly params = signal<Params>({});
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly query = computed((): Partial<CashSheetListQuery> => {
		const search = typeof this.params()['search'] === 'string' ? String(this.params()['search']).trim() : '';
		return {
			...this.range(),
			chip: this.chip(),
			...(this.location() ? { locationId: this.location() } : {}),
			...(search ? { search } : {}),
			page: Number(this.params()['page']) || 1,
			pageSize: Math.min(Number(this.params()['paginate']) || 30, 100),
		};
	});
	readonly list = injectQuery(() => ({
		queryKey: CASH_KEYS.sheets(this.query()),
		queryFn: () => firstValueFrom(this.gateway.sheets(this.query())),
	}));
	readonly choices = injectQuery(() => ({
		queryKey: CASH_KEYS.choices,
		queryFn: () => firstValueFrom(this.gateway.choices()),
	}));
	readonly counts = computed(() => this.list.data()?.counts);

	readonly tableConfig = computed((): ITableConfig<SheetTableRow> => {
		this.lang();
		const t = (key: string) => this.transloco.translate(key);
		const money = (paise: number | null) => (paise === null ? '—' : rupees(paise));
		const page = this.list.data();
		return {
			columns: [
				{ title: 'date', dataField: 'dateText' },
				{ title: 'cash_box', dataField: 'boxText' },
				{ title: 'cash_opening', dataField: 'openingText', align: 'end' },
				{ title: 'cash_in', dataField: 'inText', align: 'end' },
				{ title: 'cash_out', dataField: 'outText', align: 'end' },
				{ title: 'cash_counted', dataField: 'countedText', align: 'end' },
				{ title: 'cash_difference', dataField: 'differenceText', align: 'end' },
				{ title: 'status', dataField: 'statusHtml' },
			],
			rowActions: [{ label: 'al_view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'cash.index' }],
			data: (page?.items ?? []).map((row) => ({
				...row,
				row,
				dateText: row.date,
				boxText: escapeHtml(`${row.boxName} · ${row.locationName}`),
				openingText: money(row.openingPaise),
				inText: money(row.inPaise),
				outText: money(row.outPaise),
				countedText: money(row.countedPaise),
				differenceText: row.differencePaise === null ? '—' : signedRupees(row.differencePaise),
				statusHtml: `<div class="${SHEET_PILL[row.status]}"><span>${t(`cash_status_${row.status}`)}</span></div>`,
			})),
			total: page?.total ?? 0,
		};
	});

	setChip(chip: Chip): void {
		this.chip.set(chip);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setLocation(location: string): void {
		this.location.set(location || null);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(params?: Params): void {
		this.params.set({ ...params });
	}

	open(row: SheetTableRow): void {
		void this.router.navigate(['/cash/sheets', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as SheetTableRow | undefined;
		if (action.actionToPerform === 'view' && row) this.open(row);
	}
}
