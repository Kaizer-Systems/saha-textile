import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { settlementOpen } from '@saha-textile/core-domain/purchasing';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	RupeesPipe,
	ShortDatePipe,
	ShortDateTimePipe,
	StockQuantityPipe,
	apiProblem,
	saveBlob,
} from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { ReturnSend } from './return-send';
import { SettlePopup } from './settle-popup';
import { returnStatus, returnWhy } from '../shared/purchasing-labels';

import type { PurchaseReturn } from '@saha-textile/contracts';

/** The return's steps on the order page's tracking panel (r04). */
export const RETURN_STEPS: ReadonlyArray<{ svg: string; label: string }> = [
	{ svg: 'pending', label: 'pr_status_draft' },
	{ svg: 'shipped', label: 'pr_step_sent' },
	{ svg: 'delivered', label: 'pr_status_settled' },
];

export const returnStep = (doc: Pick<PurchaseReturn, 'status'>): number =>
	doc.status === 'draft' ? 0 : doc.status === 'sent' ? 1 : 2;

/** A purchase return or claim (r04): sent, then settled, with its debit note and challan. */
@Component({
	selector: 'app-return-view',
	templateUrl: './return-view.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class ReturnView {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');
	readonly tab = signal<'lines' | 'activity'>('lines');
	readonly steps = RETURN_STEPS;
	readonly query = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.returns, 'one', this.id()],
		queryFn: () => firstValueFrom(this.gateway.returnDoc(this.id())),
		enabled: !!this.id(),
	}));
	readonly activity = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.returns, 'activity', this.id()],
		queryFn: () => firstValueFrom(this.gateway.returnActivity(this.id())),
		enabled: !!this.id() && this.tab() === 'activity',
	}));
	readonly doc = computed(() => this.query.data() ?? null);
	readonly step = computed(() => {
		const doc = this.doc();
		return doc ? returnStep(doc) : 0;
	});
	readonly open = computed(() => {
		const doc = this.doc();
		return doc ? settlementOpen(doc.totalINR, doc.settledINR) : 0;
	});

	t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
	returnStatus = returnStatus;
	returnWhy = returnWhy;

	private refresh(): void {
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.returns });
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.entries });
	}

	edit(): void {
		void this.router.navigate(['/purchase-returns', this.id(), 'edit']);
	}

	async send(): Promise<void> {
		const doc = this.doc();
		if (!doc) return;
		const popup = this.modals.open(ReturnSend, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'return_send_title',
		});
		(popup.componentInstance as ReturnSend).start(doc);
		const sent = (await popup.result.catch(() => null)) as PurchaseReturn | null;
		if (!sent) return;
		this.notifier.showSuccess(this.t('pr_sent', { number: sent.number ?? '' }));
		this.refresh();
	}

	async settle(): Promise<void> {
		const doc = this.doc();
		if (!doc) return;
		const popup = this.modals.open(SettlePopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'settle_popup_title',
		});
		(popup.componentInstance as SettlePopup).start(doc);
		if (await popup.result.catch(() => null)) {
			this.notifier.showSuccess(this.t('pr_settled_saved'));
			this.refresh();
		}
	}

	async remove(): Promise<void> {
		const doc = this.doc();
		if (!doc) return;
		try {
			await firstValueFrom(this.gateway.deleteReturn(doc.id));
			this.notifier.showSuccess(this.t('pr_draft_deleted'));
			this.refresh();
			void this.router.navigate(['/purchase-returns']);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.t('purchasing_action_failed')));
		}
	}

	async pdf(kind: 'debit-note' | 'challan'): Promise<void> {
		const doc = this.doc();
		if (!doc) return;
		try {
			const number = (kind === 'challan' ? doc.challanNumber : doc.number) ?? doc.id;
			saveBlob(`${number.replace(/\//g, '-')}.pdf`, await firstValueFrom(this.gateway.returnPdf(doc.id, kind)));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.t('purchasing_action_failed')));
		}
	}
}
