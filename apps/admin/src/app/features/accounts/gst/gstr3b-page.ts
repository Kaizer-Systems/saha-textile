import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { GST_KEYS, GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { saveBlob, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { GST_STATUS_PILL, gstProblem } from './gst-returns-page';
import { GST_STEPS, signedRupees, stepIcon } from './gstr1-page';
import { MarkFiledPopup } from './mark-filed-popup';

import type { GstReturnDraft, GstSetOff, Gstr3bAdjustment } from '@saha-textile/contracts';

type Adjustable = Gstr3bAdjustment['table'];

/** An amount typed for a change, in paise; a change can lower a figure, so "−1,500" or "-1500" is kept negative. */
export function signedPaise(value: string): number {
	const n = Number(value.replace(/[,₹\s]/g, '').replace('−', '-'));
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** A table's words key: dots would read as nesting, so "3.1a" is "31a". */
export const tableKey = (table: string): string => table.replace('.', '');

/** G6's rows: the table, where its figure comes from, and whether (and how) it can be changed here. */
export interface Gstr3bRow {
	table: string;
	tax: number;
	adjustable: Adjustable | null;
}

/** The return's rows as G6 draws them; exports (3.1(b)) only when there were any. */
export function gstr3bRows(draft: Pick<GstReturnDraft, 'summary'>): Gstr3bRow[] {
	const of = (table: string) => draft.summary.find((row) => row.table === table);
	const zeroRated = of('3.1b');
	return [
		{ table: '3.1a', tax: of('3.1a')?.tax ?? 0, adjustable: null },
		...(zeroRated && (zeroRated.records || zeroRated.taxable)
			? [{ table: '3.1b', tax: zeroRated.tax, adjustable: null }]
			: []),
		{ table: '3.1d', tax: of('3.1d')?.tax ?? 0, adjustable: '3.1d' as const },
		{ table: '4A', tax: of('4A')?.tax ?? 0, adjustable: '4A' as const },
		{ table: '4B', tax: of('4B')?.tax ?? 0, adjustable: '4B' as const },
		{ table: '6', tax: of('6')?.tax ?? 0, adjustable: null },
	];
}

/** Q7's set-off rows, IGST, CGST and SGST in paise ('—' where a credit can't be used). */
export function setOffRows(
	s: GstSetOff,
): { key: string; igst: number | null; cgst: number | null; sgst: number | null; bold?: boolean }[] {
	return [
		{ key: 'output', ...s.liability },
		{ key: 'credit', ...s.credit },
		{ key: 'igst_used', ...s.igstUsed },
		{ key: 'own_used', igst: null, cgst: s.cgstUsed.cgst, sgst: s.sgstUsed.sgst },
		{ key: 'own_to_igst', igst: s.cgstUsed.igst + s.sgstUsed.igst, cgst: null, sgst: null },
		{ key: 'cash', ...s.cash, bold: true },
		{
			key: 'reverse_charge',
			igst: s.reverseChargeCash.igst,
			cgst: s.reverseChargeCash.cgst,
			sgst: s.reverseChargeCash.sgst,
		},
		{ key: 'carried', ...s.carried },
	];
}

/**
 * GSTR-3B (accounts brief G6, Q7): sales from the filed GSTR-1, reverse charge from self-invoices, credit from GSTR-2B
 * and the credit the books took back, the accountant's changes with their reasons, the set-off of s.49 and rule 88A
 * with the cash to pay, the steps to approval, the portal file and the ARN once filed.
 */
@Component({
	selector: 'app-gstr3b-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective, RouterLink],
	templateUrl: './gstr3b-page.html',
})
export class Gstr3bPage {
	private readonly gateway = inject(GstReturnsGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);
	private readonly banks = inject(BanksGateway);

	readonly steps = GST_STEPS;
	readonly pill = GST_STATUS_PILL;
	readonly money = signedRupees;
	readonly paise = (value: number | null) => (value === null ? '—' : rupees(value));
	readonly rows = gstr3bRows;
	readonly key = tableKey;
	readonly setOffRows = setOffRows;
	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly draft = injectQuery(() => ({
		queryKey: GST_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly busy = signal(false);
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
	/** Changes can be made until the CA approves. */
	readonly open = computed(() => ['prepared', 'checked'].includes(this.draft.data()?.status ?? ''));

	// The change pop-up (G6 "Can change here").
	readonly changeTable = signal<Adjustable>('4A');
	readonly changeIgst = signal('');
	readonly changeCgst = signal('');
	readonly changeSgst = signal('');
	readonly changeReason = signal('');
	private changeModal: NgbModalRef | null = null;

	icon(draft: GstReturnDraft, index: number): string {
		return stepIcon(draft.status, index);
	}

	day(date: string): string {
		return shortDate(date.slice(0, 10));
	}

	/** The file the GST portal takes, `GSTR3B_<GSTIN>_<MMYYYY>.json`. */
	download(draft: GstReturnDraft): void {
		const [year, month] = draft.month.split('-');
		saveBlob(
			`GSTR3B_${draft.gstin}_${month}${year}.json`,
			new Blob([JSON.stringify(draft.portal, null, 2)], { type: 'application/json' }),
		);
	}

	/** Scrolls to Q7's set-off. */
	toSetOff(): void {
		document.getElementById('gst_setoff')?.scrollIntoView({ behavior: 'smooth' });
	}

	step(draft: GstReturnDraft, to: 'checked' | 'approved'): Promise<boolean> {
		return this.run(
			() => firstValueFrom(this.gateway.step(draft.id, { to, version: draft.version })),
			`gst_done_${to}`,
		);
	}

	/** Prepares it again from the books, with these changes (the current ones unless given). */
	prepareAgain(draft: GstReturnDraft, adjustments: Gstr3bAdjustment[] = draft.adjustments): Promise<boolean> {
		return this.run(
			() =>
				firstValueFrom(
					this.gateway.prepare({
						gstRegistrationId: draft.gstRegistrationId,
						returnType: draft.returnType,
						month: draft.month,
						adjustments,
					}),
				),
			'gst_done_prepared',
		);
	}

	openChange(template: TemplateRef<unknown>, table: Adjustable): void {
		this.changeTable.set(table);
		this.changeIgst.set('');
		this.changeCgst.set('');
		this.changeSgst.set('');
		this.changeReason.set('');
		this.changeModal = this.modals.open(template, { centered: true });
	}

	/** A change needs a reason and an amount. */
	readonly changeReady = computed(
		() =>
			this.changeReason().trim().length > 0 &&
			[this.changeIgst(), this.changeCgst(), this.changeSgst()].some((v) => signedPaise(v) !== 0),
	);

	async saveChange(draft: GstReturnDraft): Promise<void> {
		const change: Gstr3bAdjustment = {
			table: this.changeTable(),
			igst: signedPaise(this.changeIgst()),
			cgst: signedPaise(this.changeCgst()),
			sgst: signedPaise(this.changeSgst()),
			reason: this.changeReason().trim(),
		};
		if (await this.prepareAgain(draft, [...draft.adjustments, change])) this.changeModal?.close();
	}

	removeChange(draft: GstReturnDraft, index: number): Promise<boolean> {
		return this.prepareAgain(
			draft,
			draft.adjustments.filter((_, i) => i !== index),
		);
	}

	// Q7 Post the set-off.
	readonly postOpen = signal(false);
	readonly bankAccounts = injectQuery(() => ({
		queryKey: BANK_KEYS.list,
		queryFn: () => firstValueFrom(this.banks.list()),
		enabled: this.postOpen(),
	}));
	readonly payFrom = signal('');
	readonly paidOn = signal(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
	readonly challan = signal('');
	private postModal: NgbModalRef | null = null;
	/** Posting waits for the CA's approval and happens once. */
	readonly canPost = computed(() => {
		const d = this.draft.data();
		return !!d?.setOff && ['approved', 'filed'].includes(d.status) && !d.setOffVoucherId && !d.challanVoucherId;
	});
	/** The cash the challan pays: tax left after the set-off, and reverse charge. */
	readonly cashPaise = computed(() => {
		const s = this.draft.data()?.setOff;
		if (!s) return 0;
		const add = (t: { igst: number; cgst: number; sgst: number }) => t.igst + t.cgst + t.sgst;
		return add(s.cash) + add(s.reverseChargeCash);
	});
	openPost(template: TemplateRef<unknown>): void {
		this.postOpen.set(true);
		this.challan.set('');
		this.postModal = this.modals.open(template, { centered: true });
	}

	async postSetOff(draft: GstReturnDraft): Promise<void> {
		const ok = await this.run(
			() =>
				firstValueFrom(
					this.gateway.postSetOff(draft.id, {
						bankAccountId: this.payFrom(),
						paidOn: this.paidOn(),
						challan: this.challan(),
						version: draft.version,
					}),
				),
			'gstr3b_set_off_posted',
		);
		if (ok) this.postModal?.close();
	}

	/** G8 Mark filed, the shared pop-up. */
	openFile(draft: GstReturnDraft): void {
		const popup = this.modals.open(MarkFiledPopup, { centered: true });
		(popup.componentInstance as MarkFiledPopup).start({
			gstRegistrationId: draft.gstRegistrationId,
			gstin: draft.gstin,
			returnType: draft.returnType,
			month: draft.month,
			monthName: this.monthName(),
		});
	}

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
