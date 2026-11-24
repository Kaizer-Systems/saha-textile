import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, type Params } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CASH_KEYS, CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem, escapeHtml } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { rupees } from '@features/accounts/ledger-helpers';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import { paiseOf } from './cash-format';
import { CASH_PRESETS } from './cash-sheets-list';

import type { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import type { ClaimListQuery, ExpenseClaim } from '@saha-textile/contracts';

/** The claims list's chips (the admin repeats the contract's list; a spec holds them equal). */
export const CLAIM_CHIPS = ['all', 'waiting', 'approved', 'paid', 'rejected'] as const;
type Chip = (typeof CLAIM_CHIPS)[number];

/** A claim's pill. */
export const CLAIM_PILL: Record<ExpenseClaim['status'], string> = {
	waiting: 'status-pending',
	approved: 'status-success',
	paid: 'status-success',
	rejected: 'status-danger',
};

type ClaimRow = ExpenseClaim & { locationName: string; [key: string]: unknown };

/**
 * Cash › Expense claims (accounts brief O12): staff members' own-pocket spends, waiting, approved, paid or rejected,
 * and New claim for one's own (or, for a manager, someone else's) with its bill.
 */
@Component({
	selector: 'app-cash-claims-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, Table, PeriodPicker],
	templateUrl: './claims-list.html',
})
export class CashClaimsListPage {
	private readonly gateway = inject(CashGateway);
	private readonly modals = inject(NgbModal);
	private readonly router = inject(Router);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly chips = CLAIM_CHIPS;
	readonly presets = CASH_PRESETS;
	readonly hint = accountsHint;
	readonly chip = signal<Chip>('all');
	readonly range = signal(accountsRange({ period: 'this_month' }));
	private readonly params = signal<Params>({});
	readonly canClaim = computed(() => this.auth.permissions().includes('expense_claim.create'));
	/** The New claim form. */
	readonly staff = signal('');
	readonly location = signal('');
	readonly head = signal('');
	readonly amount = signal('');
	readonly whatFor = signal('');
	readonly spentOn = signal(istDay(new Date()));
	readonly bill = signal<FmPicked | null>(null);
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly query = computed((): Partial<ClaimListQuery> => {
		const search = typeof this.params()['search'] === 'string' ? String(this.params()['search']).trim() : '';
		return {
			...this.range(),
			chip: this.chip(),
			...(search ? { search } : {}),
			page: Number(this.params()['page']) || 1,
			pageSize: Math.min(Number(this.params()['paginate']) || 30, 100),
		};
	});
	readonly list = injectQuery(() => ({
		queryKey: CASH_KEYS.claims(this.query()),
		queryFn: () => firstValueFrom(this.gateway.claims(this.query())),
	}));
	readonly choices = injectQuery(() => ({
		queryKey: CASH_KEYS.choices,
		queryFn: () => firstValueFrom(this.gateway.choices()),
	}));
	readonly counts = computed(() => this.list.data()?.counts);
	readonly ready = computed(
		() => !!this.location() && !!this.head() && paiseOf(this.amount()) !== null && !!this.whatFor().trim(),
	);

	readonly tableConfig = computed((): ITableConfig<ClaimRow> => {
		this.lang();
		const t = (key: string) => this.transloco.translate(key);
		const page = this.list.data();
		return {
			columns: [
				{ title: 'cash_number', dataField: 'number' },
				{ title: 'cash_spent_on', dataField: 'spentOn' },
				{ title: 'cash_staff_member', dataField: 'staffText' },
				{ title: 'cash_expense_head', dataField: 'headText' },
				{ title: 'amount', dataField: 'amountText', align: 'end' },
				{ title: 'cash_pay_back', dataField: 'payBackText' },
				{ title: 'status', dataField: 'statusHtml' },
			],
			rowActions: [{ label: 'al_view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'cash.index' }],
			data: (page?.items ?? []).map((row) => ({
				...row,
				staffText: escapeHtml(`${row.staffName} · ${row.locationName}`),
				headText: escapeHtml(row.headName),
				amountText: rupees(row.amountPaise),
				payBackText: row.payBack ? t(`cash_pay_${row.payBack}`) : '—',
				statusHtml: `<div class="${CLAIM_PILL[row.status]}"><span>${t(`cash_claim_${row.status}`)}</span></div>`,
			})),
			total: page?.total ?? 0,
		};
	});

	setChip(chip: Chip): void {
		this.chip.set(chip);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(params?: Params): void {
		this.params.set({ ...params });
	}

	open(row: ClaimRow): void {
		void this.router.navigate(['/cash/claims', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as ClaimRow | undefined;
		if (action.actionToPerform === 'view' && row) this.open(row);
	}

	newClaim(template: TemplateRef<unknown>): void {
		this.staff.set('');
		this.location.set(this.choices.data()?.locations[0]?.id ?? '');
		this.head.set('');
		this.amount.set('');
		this.whatFor.set('');
		this.bill.set(null);
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	async pickBill(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'cash_pick_bill',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.bill.set(picked[0]);
	}

	async save(): Promise<void> {
		this.busy.set(true);
		try {
			const claim = await firstValueFrom(
				this.gateway.createClaim({
					staffUserId: this.staff() || null,
					locationId: this.location(),
					headLedgerId: this.head(),
					amountPaise: paiseOf(this.amount()) as number,
					whatFor: this.whatFor().trim(),
					billMediaId: this.bill()?.assetId ?? null,
					spentOn: this.spentOn(),
				}),
			);
			this.modal?.close();
			await this.queryClient.invalidateQueries({ queryKey: CASH_KEYS.all });
			void this.router.navigate(['/cash/claims', claim.id]);
		} catch (error) {
			const problem = cashProblemKey(apiProblem(error, 'cash_failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
		} finally {
			this.busy.set(false);
		}
	}
}
