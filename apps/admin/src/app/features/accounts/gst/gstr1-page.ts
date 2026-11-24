import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { GST_KEYS, GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { saveBlob, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { GST_STATUS_PILL, gstProblem } from './gst-returns-page';

import type { GstReturnDraft, VoucherAttachment } from '@saha-textile/contracts';

/** G4's step pills in order; entering the ARN files the return and locks its month at once. */
export const GST_STEPS = ['prepared', 'checked', 'approved', 'filed', 'locked'] as const;
export type GstStep = (typeof GST_STEPS)[number];
const REACHED: Record<GstReturnDraft['status'], number> = { prepared: 0, checked: 1, approved: 2, filed: 4 };
/** Tables whose tick says what was checked (G4's Checks column). */
const TICKS = new Set(['4A', '12', '13']);
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** A step pill's icon: done, the one being waited for, or still ahead. */
export function stepIcon(status: GstReturnDraft['status'], index: number): string {
	const reached = REACHED[status];
	if (index <= reached) return 'ri-checkbox-circle-line text-success';
	if (index === reached + 1) return 'ri-time-line text-warning';
	return 'ri-checkbox-blank-circle-line text-muted';
}

/** A summary amount with its sign: notes reduce a GSTR-1, so table 9B can read "−₹43,600.00". */
export function signedRupees(paise: number): string {
	return `${paise < 0 ? '−' : ''}${rupees(paise)}`;
}

/**
 * A GSTR-1 (accounts brief G4, G8): its tables from the books with their checks, the steps it has passed, the file for
 * the portal, the accountant's check and the CA's approval, and the ARN once filed on the portal, which locks the month's
 * sales for the GSTIN.
 */
@Component({
	selector: 'app-gstr1-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './gstr1-page.html',
})
export class Gstr1Page {
	private readonly gateway = inject(GstReturnsGateway);
	private readonly ledger = inject(LedgerGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly steps = GST_STEPS;
	readonly pill = GST_STATUS_PILL;
	readonly money = signedRupees;
	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly draft = injectQuery(() => ({
		queryKey: GST_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly busy = signal(false);
	readonly arn = signal('');
	readonly filedOn = signal(today());
	readonly acknowledgement = signal<VoucherAttachment | null>(null);
	/** The month as words, "November 2026". */
	readonly monthName = computed(() => {
		const month = this.draft.data()?.month;
		return month
			? new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', {
					month: 'long',
					year: 'numeric',
					timeZone: 'UTC',
				})
			: '';
	});
	private fileModal: NgbModalRef | null = null;

	icon(draft: GstReturnDraft, index: number): string {
		return stepIcon(draft.status, index);
	}

	day(date: string): string {
		return shortDate(date.slice(0, 10));
	}

	/** A table's checks: its problems in words, or a tick (naming what was checked where G4 says so). */
	checks(draft: GstReturnDraft, table: string): string {
		const found = draft.problems.filter((p) => p.table === table);
		if (found.length)
			return found
				.map((p) => this.transloco.translate(`gstr1_check_${p.problem}`, { document: p.document }))
				.join('; ');
		return TICKS.has(table) ? `✓ ${this.transloco.translate(`gstr1_ok_${table}`)}` : '✓';
	}

	/** The file the GST portal takes, named `GSTR1_<GSTIN>_<MMYYYY>.json` as the offline tool names it. */
	download(draft: GstReturnDraft): void {
		const [year, month] = draft.month.split('-');
		saveBlob(
			`GSTR1_${draft.gstin}_${month}${year}.json`,
			new Blob([JSON.stringify(draft.portal, null, 2)], { type: 'application/json' }),
		);
	}

	step(draft: GstReturnDraft, to: 'checked' | 'approved'): Promise<boolean> {
		return this.run(
			() => firstValueFrom(this.gateway.step(draft.id, { to, version: draft.version })),
			`gst_done_${to}`,
		);
	}

	prepareAgain(draft: GstReturnDraft): Promise<boolean> {
		return this.run(
			() =>
				firstValueFrom(
					this.gateway.prepare({
						gstRegistrationId: draft.gstRegistrationId,
						returnType: draft.returnType,
						month: draft.month,
					}),
				),
			'gst_done_prepared',
		);
	}

	/** G8: the Mark filed pop-up, as on Periods and locks. */
	openFile(template: TemplateRef<unknown>): void {
		this.arn.set('');
		this.filedOn.set(today());
		this.acknowledgement.set(null);
		this.fileModal = this.modals.open(template, { centered: true });
	}

	async attachAck(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'accounts_ack_file',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.acknowledgement.set({ assetId: picked[0].assetId, name: picked[0].name });
	}

	/** Enter the ARN and day from the portal: the return is filed, and its month's sales lock for the GSTIN. */
	async markFiled(draft: GstReturnDraft): Promise<void> {
		const done = await this.run(async () => {
			await firstValueFrom(
				this.ledger.markFiled({
					gstRegistrationId: draft.gstRegistrationId,
					returnType: draft.returnType,
					month: draft.month,
					arn: this.arn(),
					filedOn: this.filedOn(),
					acknowledgement: this.acknowledgement(),
				}),
			);
			await this.queries.invalidateQueries({ queryKey: LEDGER_KEYS.periods });
		}, 'accounts_gst_filed_saved');
		if (done) this.fileModal?.close();
	}

	/** Runs one step; true when it went through. */
	private async run(work: () => Promise<unknown>, done: string): Promise<boolean> {
		this.busy.set(true);
		try {
			await work();
			this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: GST_KEYS.all });
			return true;
		} catch (error) {
			this.notifier.showError(this.transloco.translate(gstProblem(error)));
			return false;
		} finally {
			this.busy.set(false);
		}
	}
}
