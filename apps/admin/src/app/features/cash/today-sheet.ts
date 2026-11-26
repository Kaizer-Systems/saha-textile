import { Component, computed, effect, inject, signal, viewChild, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CASH_KEYS, CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { SHEET_PILL, istTime, signedRupees } from './cash-format';
import { CashCountPopup, type CountPopupOptions } from './count-popup';
import { CashMovePopup } from './move-popup';
import { CashPettyPopup } from './petty-popup';

import type { CashCountWrite, CashSheetRow, TodaysSheet } from '@saha-textile/contracts';

/** What "Arrives by itself" lists (O3), in order: the first three come from other screens, the last is typed here. */
export const ARRIVES = [
	{ key: 'counter_sales', icon: 'ri-checkbox-circle-line text-success' },
	{ key: 'refunds', icon: 'ri-checkbox-circle-line text-success' },
	{ key: 'cod', icon: 'ri-checkbox-circle-line text-success' },
	{ key: 'typed', icon: 'ri-error-warning-line text-warning' },
] as const;

/**
 * Cash › Today's sheet (accounts brief O2, O3, O5–O7, O9, O10, O14): opens by counting the float, lists what the
 * books wrote on it (amounts only for a manager), takes petty expenses and bank deposits, and closes by a blind count:
 * count again once, then submit with a difference for a manager. An earlier sheet still open must close first; a
 * difference nobody has settled waits for the manager or is carried.
 */
@Component({
	selector: 'app-cash-today',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './today-sheet.html',
})
export class CashTodayPage {
	private readonly gateway = inject(CashGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly arrives = ARRIVES;
	readonly pill = SHEET_PILL;
	readonly boxId = signal<string | null>(inject(ActivatedRoute).snapshot.queryParamMap.get('box'));
	readonly busy = signal(false);
	readonly inr = (paise: number) => rupees(paise);
	readonly time = istTime;
	readonly signed = signedRupees;
	readonly stillOpenTpl = viewChild.required<TemplateRef<unknown>>('stillOpen');
	readonly unsettledTpl = viewChild.required<TemplateRef<unknown>>('unsettled');
	readonly differenceTpl = viewChild.required<TemplateRef<unknown>>('difference');

	readonly today = injectQuery(() => ({
		queryKey: CASH_KEYS.today(this.boxId()),
		queryFn: () => firstValueFrom(this.gateway.today(this.boxId())),
	}));
	readonly choices = injectQuery(() => ({
		queryKey: CASH_KEYS.choices,
		queryFn: () => firstValueFrom(this.gateway.choices()),
	}));
	readonly view = computed(() => this.today.data()?.sheet ?? null);
	readonly managerView = computed(() => !!this.view()?.amounts);
	/** The tick on O7. */
	readonly confirmed = signal(false);
	private prompted = '';

	constructor() {
		effect(() => {
			const data = this.today.data();
			if (!data || data.sheet) return;
			const key = `${data.box.id}:${data.today}:${data.stillOpen?.sheetId ?? ''}:${data.unsettled.length}`;
			if (this.prompted === key) return;
			this.prompted = key;
			queueMicrotask(() => void this.prompt(data));
		});
	}

	/** What a row says (O3, O10): the opening and a carried difference in words, the books' own words for the rest. */
	rowWhat(row: CashSheetRow): { key: string | null; text: string } {
		if (row.kind === 'opening') return { key: 'cash_row_opening', text: '' };
		if (row.kind === 'carried') return { key: 'cash_row_carried', text: row.what };
		return { key: null, text: row.what };
	}

	/** O14 first, then O9, else straight to counting the float (O2). */
	async prompt(data: TodaysSheet): Promise<void> {
		if (data.stillOpen) {
			if ((await this.ask(this.stillOpenTpl())) === 'close') await this.close(data.stillOpen.sheetId, data);
			return;
		}
		if (data.unsettled.length) {
			if ((await this.ask(this.unsettledTpl())) === 'open') await this.open(data, true);
			return;
		}
		await this.open(data, false);
	}

	private async ask(template: TemplateRef<unknown>): Promise<unknown> {
		return this.modals.open(template, { centered: true }).result.catch(() => null);
	}

	private async count(
		options: Omit<CountPopupOptions, 'denominations'>,
		data: TodaysSheet,
	): Promise<CashCountWrite | null> {
		const popup = this.modals.open(CashCountPopup, { centered: true, scrollable: true });
		(popup.componentInstance as CashCountPopup).use({ ...options, denominations: data.denominations });
		return (await popup.result.catch(() => null)) as CashCountWrite | null;
	}

	/** O2: count the float and open the sheet (carrying an unsettled difference when asked). */
	async open(data: TodaysSheet, carryDifference: boolean): Promise<void> {
		const count = await this.count(
			{
				title: 'cash_open_title',
				titleParams: { box: data.box.name, place: this.placeOf(data.box.id) },
				info: carryDifference ? 'cash_open_info_carried' : 'cash_open_info',
				action: 'cash_open_action',
				total: 'cash_opening_counted',
			},
			data,
		);
		if (!count) return;
		await this.run(() => this.gateway.open({ boxId: data.box.id, count, carryDifference }));
	}

	/** O5–O7: count the till; count again once; then submit with a difference, by choice. */
	async close(sheetId: string, data: TodaysSheet): Promise<void> {
		let count = await this.count(
			{ title: 'cash_close_title', info: 'cash_close_info', action: 'cash_check_count' },
			data,
		);
		while (count) {
			const answer = await this.run(() => this.gateway.count(sheetId, count as CashCountWrite));
			if (!answer || answer.result === 'closed') return;
			if (answer.result === 'still_off') {
				this.confirmed.set(false);
				const choice = await this.ask(this.differenceTpl());
				if (choice === 'submit') {
					await this.run(() => this.gateway.submitDifference(sheetId));
					return;
				}
				if (choice !== 'again') return;
			}
			count = await this.count(
				{
					title: 'cash_recount_title',
					info: 'cash_recount_info',
					infoParams: { attempt: String(answer.attempt + 1) },
					tone: 'warning',
					action: 'cash_check_count',
					cancel: false,
				},
				data,
			);
		}
	}

	async petty(data: TodaysSheet): Promise<void> {
		const popup = this.modals.open(CashPettyPopup, { centered: true, size: 'lg' });
		(popup.componentInstance as CashPettyPopup).use({
			box: data.box,
			heads: this.choices.data()?.heads ?? [],
			today: data.today,
		});
		if (await popup.result.catch(() => null)) await this.refresh('cash_petty_done');
	}

	async move(data: TodaysSheet, sheetId: string): Promise<void> {
		const popup = this.modals.open(CashMovePopup, { centered: true, size: 'lg' });
		(popup.componentInstance as CashMovePopup).use({
			sheetId,
			box: data.box,
			banks: this.choices.data()?.banks ?? [],
			boxes: this.choices.data()?.boxes ?? [],
		});
		if (await popup.result.catch(() => null)) await this.refresh('cash_move_done');
	}

	/** The box's location's name, from the choices. */
	placeOf(boxId: string): string {
		return this.choices.data()?.boxes.find((b) => b.id === boxId)?.locationName ?? '';
	}

	chooseBox(id: string): void {
		this.boxId.set(id);
	}

	/** Runs a step, says why when it is refused, and reloads the sheet. */
	private async run<T>(step: () => import('rxjs').Observable<T>): Promise<T | null> {
		this.busy.set(true);
		try {
			const result = await firstValueFrom(step());
			await this.refresh(null);
			return result;
		} catch (error) {
			const problem = cashProblemKey(apiProblem(error, 'cash_failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
			return null;
		} finally {
			this.busy.set(false);
		}
	}

	private async refresh(done: string | null): Promise<void> {
		if (done) this.notifier.showSuccess(this.transloco.translate(done));
		await this.queryClient.invalidateQueries({ queryKey: CASH_KEYS.all });
	}
}
