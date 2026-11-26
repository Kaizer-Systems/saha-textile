import { Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';

import { RupeesPipe, StockQuantityPipe } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';

import type { PurchaseItemOption } from '@saha-textile/contracts';

/** Whether a result can be added at all (discontinued products and bundles cannot take stock). */
export const canTakeStock = (option: PurchaseItemOption): boolean => option.blocked === null;

/** A typed code a scanner sends ends with Enter; one exact SKU or code match is picked at once. */
export function exactMatch(options: readonly PurchaseItemOption[], typed: string): PurchaseItemOption | null {
	const code = typed.trim().toUpperCase();
	if (!code) return null;
	const hits = options.filter(
		(option) => option.sku.toUpperCase() === code || option.supplierItemCode?.toUpperCase() === code,
	);
	if (hits.length === 1 && hits[0] && canTakeStock(hits[0])) return hits[0];
	return options.length === 1 && options[0] && canTakeStock(options[0]) ? options[0] : null;
}

/**
 * The one box that finds a line (p03, po02, l01): SKU, name, barcode or the supplier's own item
 * code. A barcode scanner types into it and presses Enter. Each result shows the last price paid
 * and stock on hand; a product with colours or sizes goes to the variant grid; discontinued
 * products and bundles are greyed and cannot be picked.
 */
@Component({
	selector: 'app-line-search',
	templateUrl: './line-search.html',
	imports: [RupeesPipe, StockQuantityPipe, TranslocoModule],
})
export class LineSearch {
	private readonly gateway = inject(PurchasingGateway);
	private readonly destroyRef = inject(DestroyRef);

	readonly supplierId = input<string | null>(null);
	/** Orders search with the order's own rules (no draft products from here). */
	readonly forOrders = input(false);
	readonly allowDraftProduct = input(false);
	readonly placeholder = input('line_search_placeholder');
	readonly disabled = input(false);

	readonly picked = output<PurchaseItemOption>();
	/** A product with several variants: open the variant grid (p04). */
	readonly pickedProduct = output<PurchaseItemOption>();
	readonly makeDraft = output<string>();

	readonly text = signal('');
	readonly results = signal<readonly PurchaseItemOption[]>([]);
	readonly open = signal(false);
	readonly searching = signal(false);
	readonly active = signal(-1);
	private readonly box = viewChild<ElementRef<HTMLInputElement>>('lineSearchBox');
	private readonly typed = new Subject<string>();
	/** Enter pressed before the answer came back (a scanner): pick when it arrives. */
	private pendingEnter = false;

	constructor() {
		this.typed
			.pipe(
				debounceTime(200),
				distinctUntilChanged(),
				switchMap((q) => {
					if (q.trim().length < 2) return of([] as PurchaseItemOption[]);
					this.searching.set(true);
					return this.gateway
						.searchItems(q.trim(), this.supplierId(), this.forOrders())
						.pipe(catchError(() => of([] as PurchaseItemOption[])));
				}),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((options) => {
				this.searching.set(false);
				this.results.set(options);
				this.active.set(options.findIndex(canTakeStock));
				this.open.set(this.text().trim().length >= 2);
				if (this.pendingEnter) {
					this.pendingEnter = false;
					const hit = exactMatch(options, this.text());
					if (hit) this.choose(hit);
				}
			});
	}

	onInput(value: string): void {
		this.text.set(value);
		this.typed.next(value);
	}

	onKey(event: KeyboardEvent): void {
		const options = this.results();
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!options.length) return;
			this.open.set(true);
			const step = event.key === 'ArrowDown' ? 1 : -1;
			let next = this.active();
			for (let tries = 0; tries < options.length; tries += 1) {
				next = (next + step + options.length) % options.length;
				const option = options[next];
				if (option && canTakeStock(option)) break;
			}
			this.active.set(next);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const highlighted = options[this.active()];
			if (this.open() && highlighted && canTakeStock(highlighted)) {
				this.choose(highlighted);
				return;
			}
			const hit = exactMatch(options, this.text());
			if (hit) this.choose(hit);
			else this.pendingEnter = true;
		} else if (event.key === 'Escape') {
			this.open.set(false);
		}
	}

	choose(option: PurchaseItemOption): void {
		if (!canTakeStock(option)) return;
		if (option.variantCount > 1) this.pickedProduct.emit(option);
		else this.picked.emit(option);
		this.clear();
	}

	draft(): void {
		this.makeDraft.emit(this.text().trim());
		this.clear();
	}

	/** Closing on blur waits a moment so a click on a result still lands. */
	blur(): void {
		setTimeout(() => this.open.set(false), 150);
	}

	clear(): void {
		this.text.set('');
		this.results.set([]);
		this.open.set(false);
		this.active.set(-1);
		this.typed.next('');
		this.box()?.nativeElement.focus();
	}
}
