import { Component, OnInit, computed, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IFreeItem, IFreePick, IFreeWith } from '@data-access/interfaces/product-detail.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

/** The items a "given" rule hands over without asking: every one in stock. */
export function givenFreePicks(rule: IFreeWith): IFreePick[] {
	return rule.items
		.filter((item) => item.in_stock)
		.map((item) => ({ productId: item.product_id, variantId: item.variant_id }));
}

/** Whether these picks satisfy the rule: the count, stock, and a size for an item that has sizes. */
export function freePicksValid(rule: IFreeWith, picks: readonly IFreePick[]): boolean {
	for (const pick of picks) {
		const item = rule.items.find((row) => row.product_id === pick.productId);
		if (!item || !item.in_stock) return false;
		if (item.variant_id === null && item.variants.length > 0 && !pick.variantId) return false;
	}
	if (rule.given) return true;
	if (rule.none_or_exactly) return picks.length === 0 || picks.length === rule.max;
	return picks.length >= rule.min && picks.length <= rule.max;
}

/** What the free block reports: the picks (given items included) and whether Add to cart may go ahead. */
export interface FreeItemsState {
	picks: IFreePick[];
	valid: boolean;
}

/**
 * Free with this product (brief P8.1–P8.8, D5; approved 22 Nov 2026). Given items are ticked rows; a choice uses the
 * set's picture tiles with a counter. A free item with sizes shows them in the Size V2 look and waits for one. The
 * same part sits on the product page above the buttons and inside a set piece's free-item pop-up.
 */
@Component({
	selector: 'app-free-items',
	templateUrl: './free-items.html',
	providers: [CurrencySymbolPipe],
	imports: [CurrencySymbolPipe, TranslocoModule],
})
export class FreeItems implements OnInit {
	readonly freeWith = input.required<IFreeWith>();
	/** The main product's kind word for the heading ("saree"), or empty for "this product". */
	readonly forName = input('');
	/** Picks to start from (a cart edit, or a pop-up reopened). */
	readonly initial = input<IFreePick[] | null>(null);
	readonly stateChange = output<FreeItemsState>();

	private readonly chosen = signal<string[]>([]);
	private readonly sizes = signal<Record<string, string>>({});

	readonly items = computed(() => this.freeWith().items);
	readonly given = computed(() => this.freeWith().given);
	/** One item the shopper may take or leave ("May take it"). */
	readonly single = computed(() => !this.given() && this.items().length === 1);

	isOn(item: IFreeItem): boolean {
		return this.given() ? item.in_stock : this.chosen().includes(item.product_id);
	}

	sizeOf(item: IFreeItem): string | null {
		return item.variant_id ?? this.sizes()[item.product_id] ?? null;
	}

	needsSize(item: IFreeItem): boolean {
		return item.variant_id === null && item.variants.length > 0;
	}

	/** What is still needed, for the counter line. */
	readonly needed = computed(() => {
		const rule = this.freeWith();
		const count = this.chosen().length;
		if (rule.given || rule.none_or_exactly) return 0;
		return Math.max(0, rule.min - count);
	});

	readonly valid = computed(() => {
		const rule = this.freeWith();
		const on = this.items().filter((item) => this.isOn(item));
		if (on.some((item) => this.needsSize(item) && !this.sizeOf(item))) return false;
		if (rule.given) return true;
		const count = this.chosen().length;
		if (rule.none_or_exactly) return count === 0 || count === rule.max;
		return count >= rule.min && count <= rule.max;
	});

	ngOnInit(): void {
		const seed = this.initial();
		if (seed?.length) {
			this.chosen.set(seed.map((pick) => pick.productId));
			this.sizes.set(
				Object.fromEntries(
					seed.filter((pick) => pick.variantId).map((pick) => [pick.productId, pick.variantId as string]),
				),
			);
		} else if (!this.given()) {
			// A required choice starts with the first item(s) in stock, as the brief draws ("cream picked to start").
			const rule = this.freeWith();
			const start = rule.none_or_exactly ? 0 : rule.min;
			this.chosen.set(
				this.items()
					.filter((item) => item.in_stock)
					.slice(0, start)
					.map((item) => item.product_id),
			);
		}
		this.emit();
	}

	toggle(item: IFreeItem): void {
		if (this.given() || !item.in_stock) return;
		const max = this.freeWith().max;
		this.chosen.update((now) => {
			if (now.includes(item.product_id)) return now.filter((id) => id !== item.product_id);
			// One at a time: a new pick replaces the old one; otherwise it joins while there is room.
			if (max === 1) return [item.product_id];
			return now.length < max ? [...now, item.product_id] : now;
		});
		this.emit();
	}

	setSize(item: IFreeItem, variantId: string): void {
		this.sizes.update((now) => ({ ...now, [item.product_id]: variantId }));
		this.emit();
	}

	private emit(): void {
		const picks = this.items()
			.filter((item) => this.isOn(item))
			.map((item) => ({ productId: item.product_id, variantId: this.sizeOf(item) }));
		this.stateChange.emit({ picks, valid: this.valid() });
	}
}
