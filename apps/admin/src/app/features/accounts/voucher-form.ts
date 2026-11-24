import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { type JournalRow, journalChecks, rupees, toPaise } from './ledger-helpers';

import type { BookPart, VoucherAttachment, VoucherDraftWrite, VoucherKind } from '@saha-textile/contracts';

const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const blankRow = (locationId = ''): JournalRow => ({ ledgerId: '', locationId, debit: '', credit: '', narration: '' });
type HandKind = Exclude<VoucherKind, 'opening' | 'document'>;

/** How a contra's deposit slip is kept on its bank line, so a saved draft opens with it. */
const SLIP = 'Deposit slip ';

/** A contra draft's fields from its lines: the debit line is To, the credit line From. */
export function contraOf(rows: readonly JournalRow[]): { from: string; to: string; amount: string; slip: string } {
	const to = rows.find((row) => row.debit);
	const from = rows.find((row) => row.credit);
	return {
		from: from?.ledgerId ?? '',
		to: to?.ledgerId ?? '',
		amount: to?.debit ?? '',
		slip: to?.narration.startsWith(SLIP) ? to.narration.slice(SLIP.length) : '',
	};
}

/**
 * Accounts › Vouchers › New or a saved draft (accounts brief Q3, Q4, as drawn): date, kind, an optional reversal
 * date, attached files, the lines with ledger and location, and the checks before Post. Save draft keeps a
 * half-filled voucher with no number; posting it removes the draft. Only ledgers open to hand entries are offered.
 */
@Component({
	selector: 'app-voucher-form',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './voucher-form.html',
})
export class VoucherFormPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);
	private readonly modals = inject(NgbModal);

	/** The draft being finished (route `vouchers/drafts/:id`), or null for a new voucher. */
	readonly draftId = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('draftId'))), {
		initialValue: null,
	});
	private draftUpdatedAt: string | null = null;
	readonly draftBy = signal('');
	readonly attachments = signal<VoucherAttachment[]>([]);
	readonly savingDraft = signal(false);
	readonly draft = injectQuery(() => ({
		queryKey: LEDGER_KEYS.draft(this.draftId() ?? ''),
		// Asked only once there is an id.
		queryFn: () => firstValueFrom(this.gateway.draft(this.draftId() as string)),
		enabled: !!this.draftId(),
	}));

	/** Q4: one form with tabs, in the order drawn. */
	readonly kinds: HandKind[] = ['receipt', 'payment', 'contra', 'journal'];
	readonly kind = signal<HandKind>('journal');
	/** Q4 Contra: money moving between your own cash and bank, written as its two lines. */
	readonly contra = signal({ from: '', to: '', amount: '', slip: '' });
	readonly date = signal(today());
	readonly reverseOn = signal('');
	readonly narration = signal('');
	readonly rows = signal<JournalRow[]>([blankRow(), blankRow()]);
	readonly posting = signal(false);
	/** One key per form: a double click or a retry never posts twice. */
	private readonly key = `jv-${crypto.randomUUID()}`;
	readonly rupees = rupees;

	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.gateway.chart()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly periods = injectQuery(() => ({
		queryKey: LEDGER_KEYS.periods,
		queryFn: () => firstValueFrom(this.gateway.periods()),
	}));
	readonly ledgers = computed(() =>
		(this.chart.data()?.ledgers ?? [])
			.filter((l) => l.handPosting && l.active)
			.sort((a, b) => a.name.localeCompare(b.name)),
	);
	readonly activeLocations = computed(() => (this.locations.data() ?? []).filter((l) => l.active));
	/** Cash and bank ledgers, the only ones a contra moves money between. */
	readonly moneyLedgers = computed(() => {
		const groups = this.chart.data()?.groups ?? [];
		const money = new Set(
			groups
				.filter((g) =>
					['cash_in_hand', 'bank_accounts'].some((key) => g.systemKey === key || g.roles.includes(key)),
				)
				.map((g) => g.id),
		);
		const parentOf = new Map(groups.map((g) => [g.id, g.parentId]));
		const under = (groupId: string): boolean => {
			for (let at: string | null | undefined = groupId; at; at = parentOf.get(at)) if (money.has(at)) return true;
			return false;
		};
		return this.ledgers().filter((l) => under(l.groupId));
	});
	readonly checks = computed(() => journalChecks(this.rows(), this.chart.data()?.ledgers ?? []));
	/** The part of the books this voucher counts in, and its state that month (T1). */
	readonly part = computed<BookPart>(() => (this.kind() === 'journal' ? 'journal' : 'cash'));
	readonly periodState = computed(() => {
		const month = this.date().slice(0, 7);
		return this.periods.data()?.locks.find((l) => l.month === month && l.part === this.part())?.state ?? 'open';
	});
	readonly canPost = computed(() => {
		const c = this.checks();
		return (
			c.balanced &&
			c.noSystemLedger &&
			c.enoughLines &&
			c.locationsSet &&
			!c.bothSides &&
			this.periodState() !== 'locked' &&
			(this.kind() !== 'contra' || this.contra().from !== this.contra().to)
		);
	});

	constructor() {
		effect(() => {
			const draft = this.draft.data();
			if (!draft) return;
			untracked(() => {
				this.kind.set(draft.kind);
				this.date.set(draft.date);
				this.reverseOn.set(draft.reverseOn ?? '');
				this.narration.set(draft.narration);
				this.attachments.set(draft.attachments);
				this.draftBy.set(draft.createdByName);
				this.draftUpdatedAt = draft.updatedAt;
				const rows = draft.lines.map((line) => ({
					ledgerId: line.ledgerId,
					locationId: line.locationId,
					debit: line.debitPaise ? String(line.debitPaise / 100) : '',
					credit: line.creditPaise ? String(line.creditPaise / 100) : '',
					narration: line.narration,
				}));
				while (rows.length < 2) rows.push(blankRow());
				this.rows.set(rows);
				if (draft.kind === 'contra') this.contra.set(contraOf(rows));
			});
		});
	}

	/** Q3 Attach: files from the Media Library (bills, receipts), several allowed. */
	async attach(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'accounts_attach_files',
			accept: 'any',
			max: 20,
			already: this.attachments().length,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.length)
			this.attachments.update((list) => [
				...list,
				...picked
					.filter((p) => !list.some((a) => a.assetId === p.assetId))
					.map((p) => ({ assetId: p.assetId, name: p.name })),
			]);
	}

	removeAttachment(assetId: string): void {
		this.attachments.update((list) => list.filter((a) => a.assetId !== assetId));
	}

	private draftWrite(): VoucherDraftWrite {
		return {
			kind: this.kind(),
			date: this.date(),
			narration: this.narration(),
			reverseOn: this.reverseOn() || null,
			attachments: this.attachments(),
			lines: this.rows()
				.filter((row) => row.ledgerId || row.locationId || row.debit || row.credit || row.narration)
				.map((row) => ({
					ledgerId: row.ledgerId,
					locationId: row.locationId,
					debitPaise: toPaise(row.debit),
					creditPaise: toPaise(row.credit),
					narration: row.narration,
				})),
			expectedUpdatedAt: this.draftUpdatedAt,
		};
	}

	/** Q3 Save draft: keeps what is typed, with no number; opens as `vouchers/drafts/:id` to finish later. */
	async saveDraft(): Promise<void> {
		this.savingDraft.set(true);
		try {
			const saved = await firstValueFrom(this.gateway.saveDraft(this.draftId(), this.draftWrite()));
			this.draftUpdatedAt = saved.updatedAt;
			await this.queryClient.invalidateQueries({ queryKey: LEDGER_KEYS.drafts });
			this.notifier.showSuccess(this.transloco.translate('accounts_draft_saved'));
			if (!this.draftId()) await this.router.navigate(['/accounts/vouchers/drafts', saved.id]);
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(code === 'draft_changed' ? 'accounts_draft_changed' : 'accounts_draft_failed'),
			);
		} finally {
			this.savingDraft.set(false);
		}
	}

	setKind(kind: HandKind): void {
		this.kind.set(kind);
		if (kind === 'contra') this.setContra({});
	}

	/** A contra's two lines: the money arrives in To (debit) and leaves From (credit), at the first location. */
	setContra(change: Partial<{ from: string; to: string; amount: string; slip: string }>): void {
		const next = { ...this.contra(), ...change };
		this.contra.set(next);
		const locationId = this.activeLocations()[0]?.id ?? '';
		this.rows.set([
			{
				ledgerId: next.to,
				locationId,
				debit: next.amount,
				credit: '',
				narration: next.slip ? `${SLIP}${next.slip}` : '',
			},
			{ ledgerId: next.from, locationId, debit: '', credit: next.amount, narration: '' },
		]);
	}

	setRow(index: number, change: Partial<JournalRow>): void {
		this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
	}

	addRow(): void {
		// The form always holds at least two lines; a new one starts at the last one's location.
		const last = this.rows()[this.rows().length - 1] as JournalRow;
		this.rows.update((rows) => [...rows, blankRow(last.locationId)]);
	}

	removeRow(index: number): void {
		if (this.rows().length > 2) this.rows.update((rows) => rows.filter((_, i) => i !== index));
	}

	async post(): Promise<void> {
		if (!this.canPost()) return;
		this.posting.set(true);
		try {
			const voucher = await firstValueFrom(
				this.gateway.post({
					kind: this.kind(),
					date: this.date(),
					narration: this.narration(),
					reverseOn: this.reverseOn() || null,
					attachments: this.attachments(),
					idempotencyKey: this.key,
					draftId: this.draftId(),
					lines: this.rows()
						.filter((row) => row.ledgerId && (toPaise(row.debit) || toPaise(row.credit)))
						.map((row) => ({
							ledgerId: row.ledgerId,
							locationId: row.locationId,
							debitPaise: toPaise(row.debit),
							creditPaise: toPaise(row.credit),
							narration: row.narration,
						})),
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: ['accounts'] });
			this.notifier.showSuccess(this.transloco.translate('accounts_voucher_posted', { number: voucher.number }));
			await this.router.navigate(['/accounts/vouchers', voucher.id]);
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code.startsWith('voucher_problem:')
						? `accounts_problem_${code.split(':')[1]}`
						: 'accounts_post_failed',
				),
			);
		} finally {
			this.posting.set(false);
		}
	}
}
