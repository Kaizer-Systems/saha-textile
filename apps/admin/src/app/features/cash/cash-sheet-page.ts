import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { CASH_KEYS, CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { ALL_SETTLEMENTS, SHEET_PILL, istTime, signedRupees, settlementApplies } from './cash-format';
import { CashCountPopup } from './count-popup';

import type { CashCountWrite, CashSettleWrite, CashSheetRow, CashSheetView } from '@saha-textile/contracts';

type How = CashSettleWrite['how'];

/**
 * A cash sheet (accounts brief O8, O10): a manager's view with what came in and went out and the expected after each
 * line; a sheet waiting with a difference shows the expected against both counts and the ten ways to settle it, each
 * with the entry it adds, what it does to the books, and the result.
 */
@Component({
	selector: 'app-cash-sheet-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, NgTemplateOutlet],
	templateUrl: './cash-sheet-page.html',
})
export class CashSheetPage {
	private readonly gateway = inject(CashGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	// The route is always ':id'.
	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') as string)), {
		initialValue: '',
	});
	readonly ways = ALL_SETTLEMENTS;
	readonly pill = SHEET_PILL;
	readonly inr = (paise: number) => rupees(paise);
	readonly time = istTime;
	readonly signed = signedRupees;
	readonly busy = signal(false);
	readonly how = signal<How | null>(null);
	readonly note = signal('');
	readonly ledgerId = signal('');
	readonly bankLedgerId = signal('');
	readonly depositSlip = signal('');
	readonly depositDate = signal('');
	readonly staffUserId = signal('');
	readonly repayBy = signal<'cash' | 'payroll'>('cash');
	readonly consent = signal(false);
	readonly policeReport = signal('');
	readonly insured = signal(false);
	readonly noteDetails = signal('');
	readonly recount = signal<CashCountWrite | null>(null);

	readonly sheet = injectQuery(() => ({
		queryKey: CASH_KEYS.sheet(this.id()),
		queryFn: () => firstValueFrom(this.gateway.sheet(this.id())),
		enabled: !!this.id(),
	}));
	readonly choices = injectQuery(() => ({
		queryKey: CASH_KEYS.choices,
		queryFn: () => firstValueFrom(this.gateway.choices()),
	}));
	readonly difference = computed(() => this.sheet.data()?.sheet.differencePaise ?? 0);
	readonly waiting = computed(() => this.sheet.data()?.sheet.status === 'difference');
	readonly applies = (how: How) => settlementApplies(how, this.difference());
	/** Whether the chosen way has what it needs before Resolve. */
	readonly ready = computed(() => {
		switch (this.how()) {
			case null:
				return false;
			case 'counting_mistake':
				return !!this.recount();
			case 'missed_payment_out':
			case 'missed_money_in':
				return !!this.ledgerId();
			case 'banked_not_recorded':
				return !!this.bankLedgerId() && !!this.depositDate();
			case 'recover_from_staff':
				return !!this.staffUserId() && (this.repayBy() === 'cash' || this.consent());
			case 'theft':
				return !!this.policeReport().trim();
			default:
				return true;
		}
	});

	/** A row's words, as on today's sheet. */
	rowWhat(row: CashSheetRow): string {
		if (row.kind === 'opening') return this.transloco.translate('cash_row_opening');
		if (row.kind === 'carried') return this.transloco.translate('cash_row_carried', { date: row.what });
		return row.what;
	}

	pick(how: How): void {
		this.how.set(how);
		if (how === 'banked_not_recorded' && !this.depositDate())
			// A way is picked on the loaded sheet.
			this.depositDate.set((this.sheet.data() as CashSheetView).sheet.date);
	}

	/** Counting mistake: the manager counts the till again (both earlier counts are kept). */
	async countAgain(): Promise<void> {
		const view = this.sheet.data();
		if (!view) return;
		const popup = this.modals.open(CashCountPopup, { centered: true, scrollable: true });
		(popup.componentInstance as CashCountPopup).use({
			title: 'cash_manager_recount',
			info: 'cash_close_info',
			action: 'cash_use_recount',
			denominations: view.denominations,
		});
		const count = (await popup.result.catch(() => null)) as CashCountWrite | null;
		if (count) this.recount.set(count);
	}

	async resolve(): Promise<void> {
		const view = this.sheet.data();
		const how = this.how();
		if (!view || !how) return;
		const write: CashSettleWrite = {
			how,
			note: this.note().trim(),
			recount: how === 'counting_mistake' ? this.recount() : null,
			ledgerId: how === 'missed_payment_out' || how === 'missed_money_in' ? this.ledgerId() : null,
			bankLedgerId: how === 'banked_not_recorded' ? this.bankLedgerId() : null,
			depositSlip: how === 'banked_not_recorded' ? this.depositSlip().trim() || null : null,
			depositDate: how === 'banked_not_recorded' ? this.depositDate() : null,
			staffUserId: how === 'recover_from_staff' ? this.staffUserId() : null,
			repayBy: how === 'recover_from_staff' ? this.repayBy() : null,
			consent: how === 'recover_from_staff' && this.consent(),
			policeReport: how === 'theft' ? this.policeReport().trim() : null,
			insured: how === 'theft' && this.insured(),
			noteDetails: how === 'counterfeit' ? this.noteDetails().trim() || null : null,
			version: view.sheet.version,
		};
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.settle(view.sheet.id, write));
			this.notifier.showSuccess(this.transloco.translate('cash_settled'));
			await this.queryClient.invalidateQueries({ queryKey: CASH_KEYS.all });
		} catch (error) {
			const problem = cashProblemKey(apiProblem(error, 'cash_failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
		} finally {
			this.busy.set(false);
		}
	}
}
