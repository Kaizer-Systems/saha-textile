import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { gstStateName } from '@saha-textile/core-domain/company';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { RETURN_KEYS, ReturnsGateway, returnProblemKey } from '@core/accounts/returns.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { DocumentLockBanner } from '@shared/components/document-lock/document-lock';

import { editLogRows } from './edit-log-rows';
import { rupees } from './ledger-helpers';

import type { CreditNote, CreditNoteCancelChecks, CreditNoteLine } from '@saha-textile/contracts';

/**
 * A credit note (accounts brief B4, B5, B8, B9 as drawn): a draft's lines from its invoice with Save and Issue, and
 * what Issue changes; an issued note's prints, Cancel (super admin, month open) or a debit note when it can't be.
 */
@Component({
	selector: 'app-credit-note-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, DocumentLockBanner],
	templateUrl: './credit-note-page.html',
})
export class CreditNotePage {
	private readonly gateway = inject(ReturnsGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);
	private readonly ledgers = inject(LedgerGateway);
	private readonly auth = inject(AuthStore);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly busy = signal(false);
	readonly quantities = signal<Record<string, number>>({});
	readonly reason = signal('');
	readonly checks = signal<CreditNoteCancelChecks | null>(null);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	private modal: NgbModalRef | null = null;

	readonly note = injectQuery(() => ({
		queryKey: RETURN_KEYS.creditNote(this.id()),
		queryFn: () => firstValueFrom(this.gateway.creditNote(this.id())),
		enabled: !!this.id(),
	}));
	readonly draft = computed(() => this.note.data()?.status === 'draft');
	readonly canRefund = computed(() => {
		const n = this.note.data();
		return (
			!!n &&
			n.status === 'issued' &&
			!n.debitNoteId &&
			n.refund?.status === 'due' &&
			this.auth.permissions().includes('refund.action')
		);
	});
	readonly refundHow = signal<'gateway' | 'by_hand'>('gateway');
	readonly refundMethod = signal<'bank_transfer' | 'upi'>('bank_transfer');
	readonly refundLedger = signal('');
	readonly refundReference = signal('');
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledgers.chart()),
		enabled: this.canRefund(),
	}));
	/** Cash and bank ledgers (their group, or a group above it, is cash in hand or a bank) for a refund by hand. */
	readonly payFrom = computed(() => {
		const chart = this.chart.data();
		if (!chart) return [];
		const groups = new Map(chart.groups.map((g) => [g.id, g]));
		const isCashOrBank = (groupId: string | null): boolean => {
			const group = groupId ? groups.get(groupId) : undefined;
			if (!group) return false;
			return (
				['cash_in_hand', 'bank_accounts', 'bank_od'].includes(group.systemKey ?? '') ||
				isCashOrBank(group.parentId)
			);
		};
		return chart.ledgers.filter((l) => l.active && isCashOrBank(l.groupId));
	});
	readonly goodsKind = computed(() => this.note.data()?.kind !== 'price_adjustment');
	/** B7: this person holds the draft (the lock banner says so); others only read it. */
	readonly editable = signal(false);
	readonly canEdit = computed(() => this.draft() && this.editable());
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	/** The tax columns as drawn: CGST and SGST at half the rate each, or IGST; no rate when the lines differ. */
	readonly taxHeads = computed(() => {
		const n = this.note.data();
		const rates = [...new Set((n?.lines ?? []).filter((l) => !l.delivery).map((l) => l.ratePercent))];
		const rate = rates.length === 1 ? Math.max(...rates) : null;
		const at = (r: number | null) => (r === null ? '' : ` ${r}%`);
		return n?.interState ? [`IGST${at(rate)}`] : [`CGST${at(rate && rate / 2)}`, `SGST${at(rate && rate / 2)}`];
	});

	private readonly returnId = computed(() => this.note.data()?.returnId ?? '');
	readonly returnEntry = injectQuery(() => ({
		queryKey: RETURN_KEYS.one(this.returnId()),
		queryFn: () => firstValueFrom(this.gateway.getReturn(this.returnId())),
		enabled: !!this.returnId(),
	}));
	readonly log = injectQuery(() => ({
		queryKey: RETURN_KEYS.creditNoteLog(this.id()),
		queryFn: () => firstValueFrom(this.gateway.creditNoteLog(this.id())),
		enabled: !!this.id() && !!this.note.data() && !this.draft(),
	}));
	readonly logRows = computed(() => {
		this.lang();
		return editLogRows(this.log.data() ?? [], (key, params) => this.transloco.translate(key, params), this.inr);
	});

	/** "When you press Issue" / "What it changed" (B4, B5) and Cancel's "What this changes" (B8). */
	readonly goods = computed(() => (this.note.data()?.lines ?? []).filter((l) => !l.delivery && !!l.outcome));
	readonly inputTax = computed(
		() =>
			Math.round(
				this.goods()
					.filter((l) => l.outcome === 'write_off')
					.reduce((sum, l) => sum + (l.unitCostINR ?? 0) * l.quantity * l.ratePercent, 0),
			) / 100,
	);
	readonly month = computed(() =>
		new Date(`${this.note.data()?.date.slice(0, 7) ?? '2026-01'}-01T00:00:00`).toLocaleDateString('en-GB', {
			month: 'long',
		}),
	);

	/** "2026-11" as B8 writes it: "November 2026". */
	monthLabel(month: string): string {
		if (!month) return '';
		return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
	}

	taxOf(n: Pick<CreditNote, 'cgstINR' | 'sgstINR' | 'igstINR'>): number {
		return Math.round((n.cgstINR + n.sgstINR + n.igstINR) * 100) / 100;
	}

	effectLine(line: CreditNoteLine): { key: string; params: Record<string, unknown> } {
		const params = {
			qty: line.quantity,
			title: line.title,
			cost: this.inr((line.unitCostINR ?? 0) * line.quantity),
		};
		return { key: `cn_effect_line_${line.outcome}`, params };
	}

	state(code: string): string {
		return code === '96'
			? this.transloco.translate('inv_outside_india')
			: `${gstStateName(code) ?? code} (${code})`;
	}

	day(iso: string): string {
		return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	quantity(lineId: string, current: number): number {
		return this.quantities()[lineId] ?? current;
	}

	setQuantity(lineId: string, value: number, max: number): void {
		this.quantities.update((all) => ({
			...all,
			[lineId]: Math.min(max, Math.max(0, Math.floor(Number(value) || 0))),
		}));
	}

	private async run(work: () => Promise<void>, done: string | null = null): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			this.modal?.close();
			await this.queryClient.invalidateQueries({ queryKey: RETURN_KEYS.creditNote(this.id()) });
			if (done) this.notifier.showSuccess(this.transloco.translate(done));
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const problem = returnProblemKey(message);
			this.notifier.showError(problem ? this.transloco.translate(problem.key, problem.params) : message);
		} finally {
			this.busy.set(false);
		}
	}

	save(note: CreditNote): Promise<void> {
		const lines = Object.entries(this.quantities()).map(([lineId, quantity]) => ({ lineId, quantity }));
		return this.run(async () => {
			await firstValueFrom(this.gateway.saveDraft(note.id, { version: note.version, lines }));
			this.quantities.set({});
		}, 'cn_saved');
	}

	remove(note: CreditNote): Promise<void> {
		return this.run(async () => {
			await firstValueFrom(this.gateway.deleteDraft(note.id));
			await this.router.navigate(['/order/details', note.orderId]);
		}, 'cn_deleted');
	}

	issue(note: CreditNote): Promise<void> {
		return this.run(
			async () => void (await firstValueFrom(this.gateway.issue(note.id, note.version))),
			'cn_issued',
		);
	}

	print(note: CreditNote): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.creditNotePdf(note.id))));
	}

	printDebit(id: string): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.debitNotePdf(id))));
	}

	/** B8 when the month is open and the person may; B9 otherwise. */
	async openCancel(
		cancelModal: TemplateRef<unknown>,
		blockedModal: TemplateRef<unknown>,
		note: CreditNote,
	): Promise<void> {
		const checks = await firstValueFrom(this.gateway.cancelChecks(note.id));
		this.checks.set(checks);
		this.reason.set('');
		this.modal = this.modals.open(checks.monthFiled || checks.booksClosed ? blockedModal : cancelModal, {
			centered: true,
			size: 'lg',
		});
	}

	openDebit(debitModal: TemplateRef<unknown>): void {
		this.modal?.close();
		this.reason.set('');
		this.modal = this.modals.open(debitModal, { centered: true });
	}

	openRefund(refundModal: TemplateRef<unknown>): void {
		this.refundHow.set('gateway');
		this.refundReference.set('');
		this.modal = this.modals.open(refundModal, { centered: true });
	}

	refund(note: CreditNote): Promise<void> {
		const write =
			this.refundHow() === 'gateway'
				? ({ how: 'gateway' } as const)
				: ({
						how: 'by_hand',
						method: this.refundMethod(),
						ledgerId: this.refundLedger(),
						reference: this.refundReference(),
					} as const);
		return this.run(async () => void (await firstValueFrom(this.gateway.refund(note.id, write))), 'cn_refunded');
	}

	cancel(note: CreditNote): Promise<void> {
		return this.run(
			async () => void (await firstValueFrom(this.gateway.cancel(note.id, this.reason()))),
			'cn_cancelled',
		);
	}

	debit(note: CreditNote): Promise<void> {
		return this.run(
			async () => void (await firstValueFrom(this.gateway.debitNote(note.id, this.reason()))),
			'cn_debit_made',
		);
	}
}
