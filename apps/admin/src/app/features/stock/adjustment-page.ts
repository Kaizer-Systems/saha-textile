import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import {
	RupeesPipe,
	ShortDatePipe,
	ShortDateTimePipe,
	StockQuantityPipe,
	apiIssues,
	apiProblem,
	openPdf,
	quantity,
	rupees,
} from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { ReasonPopup } from '@features/purchasing/shared/reason-popup';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { AdjustmentDetail, AdjustmentLayer, AdjustmentRequest } from '@saha-textile/contracts';

/** One row of E3's edit log: when, who, and what as a translation key with its words. */
export interface AdjustmentLogRow {
	at: string;
	who: string;
	key: string;
	params: Record<string, string>;
}

/** Refusals Reverse can meet, each said in words (the rest show the API's sentence). */
const KNOWN_PROBLEMS = new Set([
	'adjustment_not_posted',
	'adjustment_already_reversed',
	'adjustment_is_a_reversal',
	'reason_required',
	'stock_moved_meanwhile',
	'reverse_super_admin_only',
]);

/** The pieces' signed change in words: −2, +1.5 m. */
export function signedQuantity(request: Pick<AdjustmentRequest, 'action' | 'quantity' | 'soldBy'>): string {
	return `${request.action === 'remove' ? '−' : '+'}${quantity(request.quantity, request.soldBy)}`;
}

/** A layer's cost per piece or per metre (layers keep it per tenth of a metre for fabric). */
export function layerCost(layer: AdjustmentLayer, soldBy: AdjustmentRequest['soldBy']): string {
	return soldBy === 'metre' ? `${rupees(layer.unitCostINR * 10)} / m` : rupees(layer.unitCostINR);
}

/**
 * E3's edit log, from the adjustment itself: who asked and who approved (or made and posted it at once), the voucher
 * the system posted, a rejection, and the reversal either way.
 */
export function adjustmentLog(
	detail: AdjustmentDetail,
	words: (key: string, params?: Record<string, unknown>) => string,
): AdjustmentLogRow[] {
	const r = detail.request;
	const dash = '—';
	const rows: AdjustmentLogRow[] = [];
	const number = r.number ?? dash;
	if (detail.reverses)
		rows.push({
			at: r.requestedAt,
			who: r.requestedByName ?? dash,
			key: 'sa_log_reverses',
			params: { number: detail.reverses.number ?? dash, why: r.note },
		});
	else if (r.selfApproved)
		rows.push({ at: r.requestedAt, who: r.requestedByName ?? dash, key: 'sa_log_made', params: { number } });
	else {
		rows.push({
			at: r.requestedAt,
			who: r.requestedByName ?? dash,
			key: 'sa_log_asked',
			params: {
				change: signedQuantity(r),
				reason: r.reasonCode ? words(`reason_code_${r.reasonCode}`) : dash,
			},
		});
		if (r.decidedAt)
			rows.push({
				at: r.decidedAt,
				who: r.decidedByName ?? dash,
				key: r.status === 'rejected' ? 'sa_log_rejected' : 'sa_log_approved',
				params: { number, why: r.rejectReason ?? '' },
			});
	}
	if (r.journalNumber)
		rows.push({
			at: r.decidedAt ?? r.requestedAt,
			who: words('sa_system'),
			key: r.itcReversedINR ? 'sa_log_journal_itc' : 'sa_log_journal',
			params: { journal: r.journalNumber, amount: rupees(r.itcReversedINR) },
		});
	if (detail.reversedBy)
		rows.push({
			at: r.reversedAt ?? r.requestedAt,
			who: detail.reversedBy.byName ?? dash,
			key: 'sa_log_reversed',
			params: { number: detail.reversedBy.number ?? dash },
		});
	return rows;
}

/**
 * A stock adjustment (accounts brief D5, E3): its details, edit log and what it changed in the stock ledger, cost
 * layers, stock reports and input credit; Print on its document format; Reverse for a super admin, which makes the
 * opposite adjustment and a reversing voucher and leaves this one as it is, marked reversed.
 */
@Component({
	selector: 'app-adjustment-page',
	imports: [
		PageWrapper,
		TranslocoModule,
		RouterLink,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		StockQuantityPipe,
	],
	templateUrl: './adjustment-page.html',
})
export class AdjustmentPage {
	private readonly gateway = inject(StockGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly busy = signal(false);
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly detail = injectQuery(() => ({
		queryKey: STOCK_KEYS.adjustment(this.id()),
		queryFn: () => firstValueFrom(this.gateway.adjustment(this.id())),
		enabled: !!this.id(),
	}));

	readonly signed = signedQuantity;
	readonly cost = layerCost;

	readonly log = computed(() => {
		this.lang();
		const detail = this.detail.data();
		return detail ? adjustmentLog(detail, (key, params) => this.transloco.translate(key, params)) : [];
	});

	/** Posted, reversed, waiting or rejected. */
	status(detail: AdjustmentDetail): string {
		if (detail.reversedBy) return 'reversed';
		return detail.request.status === 'applied' ? 'posted' : detail.request.status;
	}

	/** The reversal's change: the opposite of this one's. */
	opposite(request: AdjustmentRequest): string {
		return signedQuantity({ ...request, action: request.action === 'remove' ? 'add' : 'remove' });
	}

	async print(): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		try {
			openPdf(await firstValueFrom(this.gateway.adjustmentPdf(this.id())));
		} catch {
			this.notifier.showError(this.transloco.translate('purchasing_action_failed'));
		} finally {
			this.busy.set(false);
		}
	}

	/** Why Reverse was refused, in words. */
	problem(error: unknown): string {
		const issue = apiIssues(error)[0];
		return issue && KNOWN_PROBLEMS.has(issue.code)
			? this.transloco.translate(`sa_problem_${issue.code}`)
			: apiProblem(error, this.transloco.translate('purchasing_action_failed'));
	}

	async reverse(detail: AdjustmentDetail): Promise<void> {
		const popup = this.modals.open(ReasonPopup, { centered: true });
		(popup.componentInstance as ReasonPopup).start({
			title: 'sa_reverse_title',
			params: {
				number: detail.request.number,
				next: detail.reverseNumber,
				change: this.opposite(detail.request),
				journal: detail.request.journalNumber ?? '—',
			},
			body: 'sa_reverse_body',
			label: 'sa_reverse_reason',
			confirm: 'sa_reverse',
			confirmClass: 'btn-danger',
			act: (reason) =>
				firstValueFrom(this.gateway.reverseAdjustment(detail.request.id, reason)).catch((error: unknown) => {
					throw { error: { message: this.problem(error) } };
				}),
		});
		if (await popup.result.catch(() => null)) {
			await this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
			this.notifier.showSuccess(this.transloco.translate('sa_reversed_done'));
		}
	}
}
