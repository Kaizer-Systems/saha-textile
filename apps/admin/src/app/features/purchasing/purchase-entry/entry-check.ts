import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiIssues, apiProblem, apiStatus } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { translateCount } from '@shared/pipes/language.pipes';

import { ENTRY_STEPS } from './entry-steps';
import { adjust, countBody, countFrom, countProblem, countTotals, lineForCode, type CountLine } from './goods-check';
import { PostConfirm } from './post-confirm';
import { linesQuantity } from '../shared/purchasing-labels';
import { ScanPopup } from '../shared/scan-popup';

import type { DamageReason, PurchaseEntry } from '@saha-textile/contracts';

/**
 * Check goods (p08 on a desktop, g01 on a phone): count the parcel line by line. Damaged or wrong
 * pieces need a reason (and may have photos); missing pieces never came. On posting, damaged
 * pieces go onto a return draft and missing ones onto a debit-note draft for the supplier.
 */
@Component({
	selector: 'app-entry-check',
	templateUrl: './entry-check.html',
	imports: [FormsModule, PageWrapper, RouterModule, RupeesPipe, StockQuantityPipe, TranslocoModule],
})
export class EntryCheck {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);
	private readonly document = inject(DOCUMENT);

	readonly steps = ENTRY_STEPS;
	readonly reasons: readonly DamageReason[] = ['damaged_on_arrival', 'wrong_item', 'other'];
	readonly entry = signal<PurchaseEntry | null>(null);
	readonly lines = signal<CountLine[]>([]);
	readonly busy = signal(false);
	readonly lineErrors = signal<Record<string, string>>({});
	readonly highlighted = signal<string | null>(null);
	readonly canPost = computed(() => this.auth.permissions().includes('purchase.post'));
	readonly problems = computed(() => this.lines().map(countProblem));
	readonly totals = computed(() => countTotals(this.lines()));

	constructor() {
		const id = this.route.snapshot.paramMap.get('id');
		if (id) void this.load(id);
	}

	private async load(id: string): Promise<void> {
		try {
			const entry = await firstValueFrom(this.gateway.entry(id));
			if (entry.status === 'posted' || entry.status === 'void') {
				void this.router.navigate(['/purchase-entries', id], { replaceUrl: true });
				return;
			}
			this.entry.set(entry);
			this.lines.set(countFrom(entry));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	/** "34 pieces", "1 piece" in the reader's words, for the side card and the button. */
	words(list: ReadonlyArray<{ quantity: number; soldBy: 'piece' | 'metre' }>): string {
		return linesQuantity(
			list,
			(key, n) => translateCount(this.transloco, key, n),
			(key, params) => this.transloco.translate(key, params),
			this.transloco.getActiveLang(),
		);
	}

	set(index: number, field: 'good' | 'damaged' | 'missing', value: number | string): void {
		this.lines.update((lines) =>
			lines.map((count, i) => (i === index ? adjust(count, field, Number(value)) : count)),
		);
	}

	step(index: number, field: 'good' | 'damaged', by: number): void {
		const count = this.lines()[index];
		if (count) this.set(index, field, count[field] + by);
	}

	setReason(index: number, reason: DamageReason): void {
		this.lines.update((lines) => lines.map((count, i) => (i === index ? { ...count, reason } : count)));
	}

	setNote(index: number, note: string): void {
		this.lines.update((lines) => lines.map((count, i) => (i === index ? { ...count, note } : count)));
	}

	async addPhotos(index: number): Promise<void> {
		const count = this.lines()[index];
		if (!count) return;
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'damage_photos_pick',
			accept: 'image',
			max: 6,
			already: count.photos.length,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (!picked?.length) return;
		this.lines.update((lines) =>
			lines.map((row, i) =>
				i === index
					? {
							...row,
							photos: [...row.photos, ...picked.map((p) => ({ assetId: p.assetId, name: p.name }))].slice(
								0,
								6,
							),
						}
					: row,
			),
		);
	}

	/** Scan a label (g01): jump to its line and lift it out. */
	async scan(): Promise<void> {
		const popup = this.modals.open(ScanPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'scan_popup_title',
		});
		const code = (await popup.result.catch(() => null)) as string | null;
		if (!code) return;
		const index = lineForCode(this.lines(), code);
		if (index < 0) {
			this.notifier.showError(this.transloco.translate('scan_not_on_this_bill', { code }));
			return;
		}
		const lineId = this.lines()[index]?.line.lineId ?? null;
		this.highlighted.set(lineId);
		this.document.getElementById(`count-${lineId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	/** Saves the count; resolves with the checked entry, or null when refused. */
	private async saveCount(): Promise<PurchaseEntry | null> {
		const entry = this.entry();
		if (!entry || this.problems().some((problem) => problem)) return null;
		this.lineErrors.set({});
		try {
			const checked = await firstValueFrom(
				this.gateway.checkGoods(entry.id, countBody(this.lines(), entry.version)),
			);
			this.entry.set(checked);
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.entries });
			return checked;
		} catch (error) {
			const errors: Record<string, string> = {};
			for (const issue of apiIssues(error)) errors[issue.target ?? '_'] = issue.message;
			this.lineErrors.set(errors);
			const message = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
			if (apiStatus(error) === 409) this.notifier.showError(message);
			else if (!Object.keys(errors).some((key) => key !== '_')) this.notifier.showError(message);
			return null;
		}
	}

	/** Without "Post to stock", the count is saved and the entry waits for someone who can post. */
	async saveOnly(): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		try {
			const checked = await this.saveCount();
			if (checked) {
				this.notifier.showSuccess(this.transloco.translate('count_saved_waiting_to_post'));
				void this.router.navigate(['/purchase-entries', checked.id]);
			}
		} finally {
			this.busy.set(false);
		}
	}

	/** Post N pieces to stock: save the count, show exactly what changes (p09), then post (x03). */
	async post(): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		try {
			const checked = await this.saveCount();
			if (!checked) return;
			const preview = await firstValueFrom(this.gateway.postPreview(checked.id));
			const popup = this.modals.open(PostConfirm, {
				centered: true,
				windowClass: 'theme-modal text-center',
				size: 'lg',
				ariaLabelledBy: 'post_confirm_title',
			});
			(popup.componentInstance as PostConfirm).start(checked, preview);
			const posted = (await popup.result.catch(() => null)) as PurchaseEntry | null;
			if (!posted) return;
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.entries });
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.stock });
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.orders });
			const into = posted.lines.map((line) => ({ quantity: line.accepted ?? 0, soldBy: line.soldBy }));
			const skus = new Set(posted.lines.filter((line) => (line.accepted ?? 0) > 0).map((line) => line.variantId))
				.size;
			this.notifier.showSuccess(
				translateCount(this.transloco, 'posted_toast', skus, {
					number: posted.number ?? '',
					what: this.words(into),
				}),
			);
			void this.router.navigate(['/purchase-entries', posted.id]);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	back(): void {
		const entry = this.entry();
		if (entry) void this.router.navigate(['/purchase-entries', entry.id, 'edit']);
	}
}
