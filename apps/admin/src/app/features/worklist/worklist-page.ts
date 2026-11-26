import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { apiProblem, shortDateTime } from '@core/purchasing/purchasing-format';
import { WORKLIST_KEYS, WorklistGateway } from '@core/worklist/worklist.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { askReason } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';

import type { WorklistRow } from '@saha-textile/contracts';

export const WORKLIST_NEEDS = ['approve', 'fix', 'check'] as const;
export const WORKLIST_AREAS = ['payroll', 'stock', 'accounts'] as const;

/**
 * The worklist (brief 26 WL1, approved 2026-11-26): every item waiting on the signed-in person, from anywhere in
 * the admin, filtered by what it needs and where it comes from; ✓ approves a yes-or-no item at once, ✕ asks for a
 * reason; Open lands on the item's own page.
 */
@Component({
	selector: 'app-worklist-page',
	imports: [PageWrapper, TranslocoModule, RouterLink, ExportMenu],
	templateUrl: './worklist-page.html',
})
export class WorklistPage {
	private readonly gateway = inject(WorklistGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);
	private readonly modals = inject(NgbModal);
	private readonly router = inject(Router);

	readonly needs = WORKLIST_NEEDS;
	readonly areas = WORKLIST_AREAS;
	readonly need = signal<(typeof WORKLIST_NEEDS)[number] | ''>('');
	readonly area = signal<(typeof WORKLIST_AREAS)[number] | ''>('');
	readonly busy = signal('');
	readonly when = shortDateTime;

	readonly list = injectQuery(() => ({
		queryKey: WORKLIST_KEYS.rows,
		queryFn: () => firstValueFrom(this.gateway.rows()),
	}));
	readonly rows = computed(() =>
		(this.list.data() ?? []).filter(
			(r) => (!this.need() || r.needs === this.need()) && (!this.area() || r.area === this.area()),
		),
	);
	countOf(need: (typeof WORKLIST_NEEDS)[number] | ''): number {
		return (this.list.data() ?? []).filter((r) => !need || r.needs === need).length;
	}

	/** What a row says, in the reader's words. */
	what(r: WorklistRow): string {
		return this.transloco.translate(`wl_what_${r.kind}`, r.params);
	}

	/** ✓ approves at once. */
	async approve(r: WorklistRow): Promise<void> {
		this.busy.set(r.id);
		try {
			await firstValueFrom(this.gateway.approve(r.id));
			this.notifier.showSuccess(this.transloco.translate('wl_approved'));
			await this.queries.invalidateQueries({ queryKey: WORKLIST_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set('');
		}
	}

	/** ✕ asks for a reason, which reaches the asker; a refusal keeps the pop-up open with its sentence. */
	async reject(r: WorklistRow): Promise<void> {
		// WL2: opening leave above a cap is put right on the employee's form, not refused here.
		if (r.kind === 'opening_leave_over_cap') {
			await this.router.navigate(r.open.path, { queryParams: r.open.query });
			return;
		}
		const done = await askReason(this.modals, {
			title: 'wl_reject_title',
			label: 'wl_reject_reason',
			confirm: 'wl_reject',
			confirmClass: 'btn-danger',
			act: (reason: string) => firstValueFrom(this.gateway.reject(r.id, reason)),
		});
		if (done === null) return;
		this.notifier.showSuccess(this.transloco.translate('wl_rejected'));
		await this.queries.invalidateQueries({ queryKey: WORKLIST_KEYS.all });
	}

	readonly exportSource = (): ExportSource => {
		const t = (key: string) => this.transloco.translate(key);
		return {
			fileName: 'worklist',
			title: t('wl_title'),
			header: [t('wl_col_needs'), t('wl_col_from'), t('wl_col_what'), t('wl_col_asked_by'), t('wl_col_since')],
			rows: this.rows().map((r) => [
				t(`wl_needs_${r.needs}`),
				t(`wl_area_${r.area}`),
				this.what(r),
				r.askedBy ?? '',
				r.since,
			]),
		};
	};
}
