import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2, Select2Data, Select2UpdateEvent } from 'ng-select2-component';

import { goLiveLabels } from '@core/catalog/go-live-report';
import { ProductBulkAction } from '@data-access/services/product.service';

import type { ProductBulkResult, ProductBulkRow } from '@saha-textile/contracts';

/** What the question shows: the dry run's answer, and how to run the action for real. */
export interface ProductBulkAsk {
	action: ProductBulkAction;
	plan: ProductBulkResult;
	/** Live products and collections, for Discontinue's "Send to one page". */
	targets?: Select2Data;
	act: (replacementPath: string | null) => Promise<ProductBulkResult>;
}

/** One pill of the counts line: a translation key, its count and its colour. */
interface CountPill {
	key: string;
	count: number;
	pill: string;
}

/** The pill each outcome wears (the admin's own status-* pills). */
const PILL: Readonly<Record<ProductBulkRow['outcome'], string>> = {
	done: 'status-success',
	skipped: 'status-awaiting_for_approval',
	refused: 'status-pending',
};

/**
 * The question every bulk action asks first (brief § 3): how many it will change, which it skips
 * and why, the products that need work by name. Discontinue also asks where old links go.
 * Nothing changes until the button; the button names the count it will act on.
 */
@Component({
	selector: 'app-product-bulk-popup',
	templateUrl: './product-bulk-popup.html',
	imports: [TranslocoModule, Select2],
})
export class ProductBulkPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);

	readonly ask = signal<ProductBulkAsk | null>(null);
	readonly busy = signal(false);
	readonly failed = signal(false);
	/** Discontinue: old links show "gone" (null) or go to one live page. */
	readonly linkChoice = signal<'gone' | 'page'>('gone');
	readonly replacement = signal<string | null>(null);

	readonly rows = computed(() => this.ask()?.plan.rows ?? []);
	readonly doneCount = computed(() => this.rows().filter((row) => row.outcome === 'done').length);

	/** "3 will go live", "1 already live · skipped", "1 needs work". */
	readonly pills = computed<CountPill[]>(() => {
		const ask = this.ask();
		if (!ask) return [];
		const groups = new Map<string, CountPill>();
		for (const row of this.rows()) {
			const key = row.outcome === 'done' ? this.word('bulk_done_') : `bulk_reason_${row.reason ?? 'failed'}`;
			const group = groups.get(key) ?? { key, count: 0, pill: PILL[row.outcome] };
			group.count += 1;
			groups.set(key, group);
		}
		return [...groups.values()];
	});

	/** The products it can't do, by name, with what stops each. */
	readonly refused = computed(() =>
		this.rows()
			.filter((row) => row.outcome === 'refused')
			.map((row) => ({
				title: row.title,
				why: row.gaps.length
					? goLiveLabels(row.gaps, (key) => this.transloco.translate(key)).join(', ')
					: this.transloco.translate(`bulk_why_${row.reason ?? 'failed'}`),
			})),
	);

	/** The action's own words: `bulk_title_go_live`, `bulk_confirm_take_off`… */
	word(prefix: string): string {
		return `${prefix}${(this.ask()?.action ?? '').replace(/-/g, '_')}`;
	}

	start(ask: ProductBulkAsk): void {
		this.ask.set(ask);
	}

	pickReplacement(event: Select2UpdateEvent): void {
		const value = event.value;
		this.replacement.set(typeof value === 'string' && value ? value : null);
	}

	canConfirm(): boolean {
		if (this.busy() || !this.doneCount()) return false;
		return !(this.ask()?.action === 'discontinue' && this.linkChoice() === 'page' && !this.replacement());
	}

	async confirm(): Promise<void> {
		const ask = this.ask();
		if (!ask || !this.canConfirm()) return;
		this.busy.set(true);
		this.failed.set(false);
		try {
			const path = ask.action === 'discontinue' && this.linkChoice() === 'page' ? this.replacement() : null;
			this.modal.close(await ask.act(path));
		} catch {
			this.failed.set(true);
		} finally {
			this.busy.set(false);
		}
	}
}
