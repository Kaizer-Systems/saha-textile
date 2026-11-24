import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ScanPopup } from '@features/purchasing/shared/scan-popup';
import { parseQuantity } from '@features/purchasing/shared/variant-grid';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PluralPipe } from '@shared/pipes/language.pipes';

import { countQuantity } from './count-quantity';

import type { StockCount, StockCountLine } from '@saha-textile/contracts';

/** A typed count as stock units (pieces, or tenths of a metre); null when empty or unreadable. */
export function countedUnits(text: string, soldBy: 'piece' | 'metre'): number | null {
	const parsed = parseQuantity(text, soldBy);
	return parsed && 'units' in parsed && parsed.units >= 0 ? parsed.units : null;
}

/** Lines with a typed count that differs from what is saved: what "Save counts" sends. */
export function changedEntries(
	lines: readonly StockCountLine[],
	typed: ReadonlyMap<string, { text: string; note: string }>,
): Array<{ variantId: string; counted: number; note: string | null }> {
	const out: Array<{ variantId: string; counted: number; note: string | null }> = [];
	for (const line of lines) {
		const entry = typed.get(line.variantId);
		if (!entry) continue;
		const units = countedUnits(entry.text, line.soldBy);
		if (units === null) continue;
		const note = entry.note.trim() || null;
		if (units !== line.counted || note !== (line.note ?? null))
			out.push({ variantId: line.variantId, counted: units, note });
	}
	return out;
}

/**
 * One stock count (c03, g02). While counting: a big number box per line on a phone, scan to jump,
 * what is not counted yet; blind counts hide the expected figure. In review: expected = at start −
 * sold during, differences valued at cost, recount sends lines back, posting writes count
 * corrections (or waits for someone with Approve write-offs).
 */
@Component({
	selector: 'app-count-page',
	templateUrl: './count-page.html',
	imports: [FormsModule, PageWrapper, PluralPipe, RouterModule, RupeesPipe, StockQuantityPipe, TranslocoModule],
})
export class CountPage {
	private readonly route = inject(ActivatedRoute);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);
	private readonly document = inject(DOCUMENT);

	readonly count = signal<StockCount | null>(null);
	readonly typed = signal<ReadonlyMap<string, { text: string; note: string }>>(new Map());
	readonly recount = signal<ReadonlySet<string>>(new Set());
	readonly busy = signal(false);
	readonly search = signal('');
	readonly highlighted = signal<string | null>(null);
	readonly canPost = computed(() => this.auth.permissions().includes('stock_count.post'));
	readonly canApprove = computed(() => this.auth.permissions().includes('stock.approve'));

	readonly pending = computed(() => changedEntries(this.count()?.lines ?? [], this.typed()));
	readonly notCounted = computed(() =>
		(this.count()?.lines ?? []).filter((line) => line.counted === null || line.recount),
	);
	readonly differing = computed(() => (this.count()?.lines ?? []).filter((line) => (line.difference ?? 0) !== 0));
	readonly shown = computed(() => {
		const q = this.search().trim().toLowerCase();
		const lines = this.count()?.lines ?? [];
		return q
			? lines.filter((line) => line.sku.toLowerCase().includes(q) || line.title.toLowerCase().includes(q))
			: lines;
	});
	readonly progress = computed(() => {
		const count = this.count();
		return count && count.totals.skus ? Math.round((count.totals.counted / count.totals.skus) * 100) : 0;
	});

	constructor() {
		const id = this.route.snapshot.paramMap.get('id');
		if (id) void this.load(id);
	}

	private async load(id: string): Promise<void> {
		try {
			this.set(await firstValueFrom(this.gateway.count(id)));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	private set(count: StockCount): void {
		this.count.set(count);
		this.typed.set(
			new Map(
				count.lines.map((line) => [
					line.variantId,
					{
						text:
							line.counted === null
								? ''
								: line.soldBy === 'metre'
									? (line.counted / 10).toFixed(1)
									: String(line.counted),
						note: line.note ?? '',
					},
				]),
			),
		);
		this.recount.set(new Set());
	}

	/** Short, over or net with pieces and metres kept apart. */
	qty(pieces: number, tenths: number): string {
		return countQuantity(this.transloco, pieces, tenths);
	}

	typedOf(line: StockCountLine): { text: string; note: string } {
		return this.typed().get(line.variantId) ?? { text: '', note: '' };
	}

	type(line: StockCountLine, field: 'text' | 'note', value: string): void {
		this.typed.update((map) => new Map(map).set(line.variantId, { ...this.typedOf(line), [field]: value }));
	}

	step(line: StockCountLine, by: number): void {
		const units = countedUnits(this.typedOf(line).text, line.soldBy) ?? 0;
		const next = Math.max(0, units + by * (line.soldBy === 'metre' ? 10 : 1));
		this.type(line, 'text', line.soldBy === 'metre' ? (next / 10).toFixed(1) : String(next));
	}

	async scan(): Promise<void> {
		const popup = this.modals.open(ScanPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'scan_popup_title',
		});
		const code = ((await popup.result.catch(() => null)) as string | null)?.trim().toUpperCase();
		if (!code) return;
		const line = (this.count()?.lines ?? []).find((row) => row.sku.toUpperCase() === code);
		if (!line) {
			this.notifier.showError(this.transloco.translate('scan_not_in_count', { code }));
			return;
		}
		this.highlighted.set(line.variantId);
		this.search.set('');
		setTimeout(() =>
			this.document
				.getElementById(`count-line-${line.variantId}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
		);
	}

	private async act(run: () => Promise<StockCount>, done: string): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		try {
			this.set(await run());
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.counts });
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.approvals });
			this.notifier.showSuccess(this.transloco.translate(done));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	saveCounts(): Promise<void> {
		const count = this.count();
		const lines = this.pending();
		if (!count || !lines.length) return Promise.resolve();
		return this.act(() => firstValueFrom(this.gateway.enterCounts(count.id, { lines })), 'counts_saved');
	}

	async finish(): Promise<void> {
		const count = this.count();
		if (!count) return;
		if (this.pending().length) await this.saveCounts();
		await this.act(() => firstValueFrom(this.gateway.finishCount(count.id)), 'count_sent_to_review');
	}

	/** The count sheet on its document format; a blind count prints no expected figures for a counter. */
	async printSheet(id: string): Promise<void> {
		const blob = await firstValueFrom(this.gateway.countSheetPdf(id)).catch(() => null);
		if (blob) openPdf(blob);
		else this.notifier.showError(this.transloco.translate('print_failed'));
	}

	toggleRecount(variantId: string): void {
		this.recount.update((set) => {
			const next = new Set(set);
			if (next.has(variantId)) next.delete(variantId);
			else next.add(variantId);
			return next;
		});
	}

	sendBack(): Promise<void> {
		const count = this.count();
		const ids = this.recount().size ? [...this.recount()] : this.differing().map((line) => line.variantId);
		if (!count || !ids.length) return Promise.resolve();
		return this.act(() => firstValueFrom(this.gateway.recount(count.id, ids)), 'count_sent_back');
	}

	post(): Promise<void> {
		const count = this.count();
		if (!count) return Promise.resolve();
		return this.act(
			() => firstValueFrom(this.gateway.postCount(count.id)),
			this.canApprove() ? 'count_posted' : 'count_waiting_approval',
		);
	}
}
