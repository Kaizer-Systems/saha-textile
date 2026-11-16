import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { computeReturnTotals } from '@saha-textile/core-domain/purchasing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2SearchEvent, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiProblem, apiStatus, shortDate } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import { CapPopup } from './cap-popup';
import { ReturnSend } from './return-send';
import { parseQuantity } from '../shared/variant-grid';

import type {
	PurchaseEntry,
	PurchaseEntryListRow,
	PurchaseReturn,
	PurchaseReturnReason,
	ReturnableLine,
} from '@saha-textile/contracts';

export const RETURN_REASONS: readonly PurchaseReturnReason[] = [
	'damaged_on_arrival',
	'wrong_item',
	'short_supplied',
	'quality_after_accepting',
	'extra_sent',
	'other',
];

/** Short supplied claims for goods that never came: no goods travel, only a debit note (r01). */
export const kindFor = (reason: PurchaseReturnReason) =>
	reason === 'short_supplied' ? 'short_supply' : 'return_goods';

export interface ReturnRow {
	line: ReturnableLine;
	quantity: string;
}

/** Whole stock units typed on a row (pieces, or tenths of a metre), 0 when empty or unreadable. */
export function unitsOf(row: ReturnRow): number {
	const parsed = parseQuantity(row.quantity, row.line.soldBy);
	return parsed && 'units' in parsed ? parsed.units : 0;
}

/**
 * A new purchase return (r02): always from a posted purchase entry, so the cost that comes off is
 * that entry's own. Quantities are capped by received less already returned, and by what is free
 * (not held, not in paid orders); asking for more opens r03 with the reason and the smaller number.
 */
@Component({
	selector: 'app-return-form',
	templateUrl: './return-form.html',
	imports: [
		FormFields,
		FormsModule,
		PageWrapper,
		RouterModule,
		RupeesPipe,
		Select2,
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class ReturnForm {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	readonly reasons = RETURN_REASONS;
	readonly existing = signal<PurchaseReturn | null>(null);
	readonly entry = signal<PurchaseEntry | null>(null);
	readonly holdId = signal<string | null>(this.route.snapshot.queryParamMap.get('hold'));
	readonly reason = signal<PurchaseReturnReason>('quality_after_accepting');
	readonly note = signal('');
	readonly photos = signal<Array<{ assetId: string; name: string }>>([]);
	readonly rows = signal<ReturnRow[]>([]);
	readonly saving = signal(false);
	readonly conflict = signal<string | null>(null);

	/* the posted entry picker, when the return did not start from an entry */
	readonly entrySearch = signal('');
	readonly entryOptions = signal<PurchaseEntryListRow[]>([]);
	readonly entrySelect = computed<Select2Data>(() =>
		this.entryOptions().map((row) => ({
			value: row.id,
			label: `${row.number ?? ''} · ${row.supplierName} · ${shortDate(row.billDate)}`,
		})),
	);

	readonly kind = computed(() => kindFor(this.reason()));
	readonly totals = computed(() => {
		const entry = this.entry();
		const rows = this.rows();
		return computeReturnTotals(
			entry?.taxType ?? 'none',
			rows.map((row) => ({
				quantity: unitsOf(row),
				unitCostPerStockUnitINR: row.line.unitCostINR,
				gstRatePct: row.line.gstRatePct,
			})),
		);
	});
	readonly picked = computed(() =>
		this.rows()
			.map((row) => ({ row, units: unitsOf(row) }))
			.filter((item) => item.units > 0),
	);
	readonly problems = computed(() =>
		this.rows().map((row) => {
			if (!row.quantity.trim()) return null;
			const parsed = parseQuantity(row.quantity, row.line.soldBy);
			if (!parsed) return null;
			if ('problem' in parsed) return parsed.problem;
			return parsed.units > row.line.freeToReturn ? 'pr_more_than_free' : null;
		}),
	);
	readonly canSave = computed(
		() =>
			!this.saving() &&
			!!this.entry() &&
			this.picked().length > 0 &&
			this.problems().every((problem) => !problem),
	);

	constructor() {
		const id = this.route.snapshot.paramMap.get('id');
		const entryId = this.route.snapshot.queryParamMap.get('entry');
		const reason = this.route.snapshot.queryParamMap.get('reason') as PurchaseReturnReason | null;
		if (reason && RETURN_REASONS.includes(reason)) this.reason.set(reason);
		if (id) void this.loadExisting(id);
		else if (entryId) void this.useEntry(entryId);
		else void this.searchEntries({ search: '' } as Select2SearchEvent);
	}

	private async loadExisting(id: string): Promise<void> {
		try {
			const doc = await firstValueFrom(this.gateway.returnDoc(id));
			if (doc.status !== 'draft') {
				void this.router.navigate(['/purchase-returns', id], { replaceUrl: true });
				return;
			}
			this.existing.set(doc);
			this.reason.set(doc.reason);
			this.note.set(doc.noteToSupplier ?? '');
			this.photos.set(doc.photoAssetIds.map((assetId) => ({ assetId, name: assetId })));
			this.holdId.set(doc.holdId);
			await this.useEntry(doc.purchaseEntryId, doc);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	async searchEntries(event: Select2SearchEvent): Promise<void> {
		const q = (event.search ?? '').trim();
		try {
			const page = await firstValueFrom(
				this.gateway.entries({ filter: 'all', page: 1, pageSize: 30, ...(q ? { q } : {}) }),
			);
			this.entryOptions.set(page.items.filter((row) => row.status === 'posted'));
		} catch {
			this.entryOptions.set([]);
		}
	}

	chooseEntry(event: Select2UpdateEvent): void {
		const value = typeof event.value === 'string' ? event.value : '';
		if (value && value !== this.entry()?.id) void this.useEntry(value);
	}

	/** Loads the entry and what each of its lines can still give back. */
	async useEntry(entryId: string, doc: PurchaseReturn | null = null): Promise<void> {
		try {
			const [entry, lines] = await Promise.all([
				firstValueFrom(this.gateway.entry(entryId)),
				firstValueFrom(this.gateway.returnable(entryId, this.kind(), this.holdId(), doc?.id ?? null)),
			]);
			this.entry.set(entry);
			const typed = new Map((doc?.lines ?? []).map((line) => [line.entryLineId, line.quantity]));
			this.rows.set(
				lines.map((line) => {
					const units = typed.get(line.entryLineId) ?? (this.holdId() ? line.freeToReturn : 0);
					return {
						line,
						quantity: units ? (line.soldBy === 'metre' ? (units / 10).toFixed(1) : String(units)) : '',
					};
				}),
			);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	/** A short claim and a goods return take from different amounts: re-read them on a change of reason. */
	async setReason(reason: PurchaseReturnReason): Promise<void> {
		const before = this.kind();
		this.reason.set(reason);
		const entry = this.entry();
		if (entry && kindFor(reason) !== before) await this.useEntry(entry.id, this.existing());
	}

	setQuantity(index: number, value: string): void {
		this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, quantity: value } : row)));
	}

	/** More than is free (r03): say why, and offer the smaller number. */
	async checkCap(index: number): Promise<void> {
		const row = this.rows()[index];
		if (!row || unitsOf(row) <= row.line.freeToReturn) return;
		const popup = this.modals.open(CapPopup, {
			centered: true,
			windowClass: 'theme-modal text-center',
			ariaLabelledBy: 'cap_popup_title',
		});
		(popup.componentInstance as CapPopup).start(row.line);
		const take = await popup.result.catch(() => null);
		const free = row.line.freeToReturn;
		if (take === 'take')
			this.setQuantity(index, row.line.soldBy === 'metre' ? (free / 10).toFixed(1) : String(free));
	}

	async addPhotos(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'return_photos_pick',
			accept: 'image',
			max: 10,
			already: this.photos().length,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.length)
			this.photos.update((list) =>
				[...list, ...picked.map((p) => ({ assetId: p.assetId, name: p.name }))].slice(0, 10),
			);
	}

	async save(quietly = false): Promise<PurchaseReturn | null> {
		const entry = this.entry();
		if (!entry || !this.canSave()) return null;
		this.saving.set(true);
		this.conflict.set(null);
		const existing = this.existing();
		try {
			const saved = await firstValueFrom(
				this.gateway.saveReturn(existing?.id ?? null, {
					purchaseEntryId: entry.id,
					kind: this.kind(),
					reason: this.reason(),
					noteToSupplier: this.note().trim() || null,
					photoAssetIds: this.photos().map((photo) => photo.assetId),
					lines: this.picked().map((item) => ({
						entryLineId: item.row.line.entryLineId,
						quantity: item.units,
					})),
					holdId: this.holdId(),
					...(existing ? { version: existing.version } : {}),
				}),
			);
			this.existing.set(saved);
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.returns });
			if (!quietly) {
				this.notifier.showSuccess(this.transloco.translate('pr_draft_saved'));
				void this.router.navigate(['/purchase-returns', saved.id]);
			}
			return saved;
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
			if (apiStatus(error) === 409) this.conflict.set(message);
			else this.notifier.showError(message);
			return null;
		} finally {
			this.saving.set(false);
		}
	}

	/** Send to supplier: saved first; sending gives the debit note its number and takes the stock out. */
	async send(): Promise<void> {
		const saved = await this.save(true);
		if (!saved) return;
		const popup = this.modals.open(ReturnSend, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'return_send_title',
		});
		(popup.componentInstance as ReturnSend).start(saved);
		const sent = (await popup.result.catch(() => null)) as PurchaseReturn | null;
		void this.router.navigate(['/purchase-returns', saved.id]);
		if (sent) this.notifier.showSuccess(this.transloco.translate('pr_sent', { number: sent.number ?? '' }));
	}

	valueOf(row: ReturnRow): number {
		return Math.round(unitsOf(row) * row.line.unitCostINR * 100) / 100;
	}
}
