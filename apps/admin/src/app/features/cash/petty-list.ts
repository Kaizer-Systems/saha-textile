import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type { Params } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CASH_KEYS, CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem, escapeHtml } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import { paiseOf } from './cash-format';
import { CASH_PRESETS } from './cash-sheets-list';

import type { ITableConfig } from '@data-access/interfaces/table.interface';
import type { PettyList, PettyListQuery, RefillPreview } from '@saha-textile/contracts';

type PettyRow = PettyList['items'][number] & { [key: string]: unknown };

/**
 * Cash › Petty expenses (accounts brief O4, O13): every petty expense of the period, and Refill for a fixed float:
 * what it spent since its last refill by head, back to its float from a bank.
 */
@Component({
	selector: 'app-cash-petty-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, Table, PeriodPicker],
	templateUrl: './petty-list.html',
})
export class CashPettyListPage {
	private readonly gateway = inject(CashGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly presets = CASH_PRESETS;
	readonly hint = accountsHint;
	readonly inr = (paise: number) => rupees(paise);
	readonly range = signal(accountsRange({ period: 'this_month' }));
	readonly boxId = signal<string | null>(null);
	private readonly params = signal<Params>({});
	readonly preview = signal<RefillPreview | null>(null);
	readonly from = signal('');
	readonly amount = signal('');
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly query = computed((): Partial<PettyListQuery> => {
		const search = typeof this.params()['search'] === 'string' ? String(this.params()['search']).trim() : '';
		return {
			...this.range(),
			...(this.boxId() ? { boxId: this.boxId() } : {}),
			...(search ? { search } : {}),
			page: Number(this.params()['page']) || 1,
			pageSize: Math.min(Number(this.params()['paginate']) || 30, 100),
		};
	});
	readonly list = injectQuery(() => ({
		queryKey: CASH_KEYS.petty(this.query()),
		queryFn: () => firstValueFrom(this.gateway.petty(this.query())),
	}));
	readonly choices = injectQuery(() => ({
		queryKey: CASH_KEYS.choices,
		queryFn: () => firstValueFrom(this.gateway.choices()),
	}));
	readonly floats = computed(() => (this.choices.data()?.boxes ?? []).filter((b) => b.kind === 'fixed_float'));

	readonly tableConfig = computed((): ITableConfig<PettyRow> => {
		this.lang();
		const page = this.list.data();
		return {
			columns: [
				{ title: 'cash_number', dataField: 'number' },
				{ title: 'date', dataField: 'date' },
				{ title: 'cash_box', dataField: 'boxText' },
				{ title: 'cash_expense_head', dataField: 'headText' },
				{ title: 'cash_paid_to', dataField: 'paidToText' },
				{ title: 'cash_what_for', dataField: 'whatForText' },
				{ title: 'amount', dataField: 'amountText', align: 'end' },
				{ title: 'cash_gst', dataField: 'gstText', align: 'end' },
				{ title: 'cash_by', dataField: 'byText' },
			],
			data: (page?.items ?? []).map((row) => {
				const gst = row.gst ? row.gst.cgstPaise + row.gst.sgstPaise + row.gst.igstPaise : null;
				return {
					...row,
					boxText: escapeHtml(row.boxName),
					headText: escapeHtml(row.headName),
					paidToText: escapeHtml(row.paidTo),
					whatForText: escapeHtml(row.whatFor),
					amountText: rupees(row.amountPaise),
					gstText: gst === null ? '—' : rupees(gst),
					byText: escapeHtml(row.byName ?? '—'),
				};
			}),
			total: page?.total ?? 0,
		};
	});

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setBox(id: string): void {
		this.boxId.set(id || null);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(params?: Params): void {
		this.params.set({ ...params });
	}

	/** O13: what the float spent since its last refill, and the amount that brings it back. */
	async openRefill(boxId: string, template: TemplateRef<unknown>): Promise<void> {
		try {
			const preview = await firstValueFrom(this.gateway.refillPreview(boxId));
			this.preview.set(preview);
			this.amount.set(String(preview.refillPaise / 100));
			this.from.set('');
			this.modal = this.modals.open(template, { centered: true, size: 'lg' });
		} catch (error) {
			this.fail(error);
		}
	}

	async refill(): Promise<void> {
		const preview = this.preview() as RefillPreview;
		const amountPaise = paiseOf(this.amount());
		if (amountPaise === null || !this.from()) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.refill(preview.box.id, { fromLedgerId: this.from(), amountPaise }));
			this.modal?.close();
			this.notifier.showSuccess(this.transloco.translate('cash_refilled'));
			await this.queryClient.invalidateQueries({ queryKey: CASH_KEYS.all });
		} catch (error) {
			this.fail(error);
		} finally {
			this.busy.set(false);
		}
	}

	private fail(error: unknown): void {
		const problem = cashProblemKey(apiProblem(error, 'cash_failed'));
		this.notifier.showError(this.transloco.translate(problem.key, problem.params));
	}
}
