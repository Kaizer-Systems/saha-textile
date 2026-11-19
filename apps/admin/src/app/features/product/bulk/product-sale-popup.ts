import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject, debounceTime, firstValueFrom, of, switchMap, catchError } from 'rxjs';

import { ProductService } from '@data-access/services/product.service';
import { ShopEventService } from '@data-access/services/shop-event.service';
import { PluralPipe } from '@shared/pipes/language.pipes';

import type {
	ProductSaleLineWrite,
	ProductSalePrice,
	ProductSaleResult,
	ProductSaleRow,
	SaleRuleKind,
	ShopEvent,
} from '@saha-textile/contracts';

/** A sale that can still take products: not ended, not cancelled. */
const OPEN: readonly ShopEvent['status'][] = ['live', 'scheduled', 'draft'];
const NEW_SALE = 'new';
/** Over this much off, the sale form's own warning shows. */
const WARN_PERCENT = 60;

/** What the popup closes with: the sale's answer, and whether a new draft sale was made. */
export interface SaleClosed {
	result: ProductSaleResult;
	created: boolean;
}

/** One picked product as the popup starts with it. */
export interface SalePick {
	id: string;
	title: string;
	thumbnailUrl: string | null;
}

/** One product's row in the preview: its prices now, and its boxes for a fixed price. */
interface SaleRow {
	pick: SalePick;
	/** Every SKU with its price now (from the first dry run). */
	skus: ProductSalePrice[];
	/** The last dry run's answer for this product. */
	result: ProductSaleRow | null;
}

const whole = (value: string): number | null => {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const number = Number(trimmed.replace(/,/g, ''));
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};

/**
 * Put on sale (brief § 4): the picked products join a sale from Events. % off and ₹ off take one
 * number for every product; a fixed sale price is typed for each product, or for each colour.
 * Every price shown comes from the sale engine through a dry run, so the preview is what the
 * shop will charge; products the sale can't take are left out with why.
 */
@Component({
	selector: 'app-product-sale-popup',
	templateUrl: './product-sale-popup.html',
	imports: [TranslocoModule, DatePipe, PluralPipe],
})
export class ProductSalePopup {
	readonly modal = inject(NgbActiveModal);
	private readonly products = inject(ProductService);
	private readonly events = inject(ShopEventService);
	private readonly destroyRef = inject(DestroyRef);

	readonly picks = signal<SalePick[]>([]);
	readonly sales = signal<ShopEvent[]>([]);
	readonly eventId = signal<string>(NEW_SALE);
	readonly kind = signal<SaleRuleKind>('percent');
	readonly value = signal('');
	/** Fixed price: one box per product, and per colour where asked. */
	readonly productPrice = signal<Record<string, string>>({});
	readonly skuPrice = signal<Record<string, string>>({});
	readonly perColour = signal<ReadonlySet<string>>(new Set());
	readonly fillAll = signal('');
	readonly rows = signal<SaleRow[]>([]);
	readonly loading = signal(true);
	readonly checking = signal(false);
	readonly busy = signal(false);
	readonly failed = signal(false);

	private readonly changes = new Subject<void>();

	readonly NEW_SALE = NEW_SALE;

	readonly chosenSale = computed(() => this.sales().find((sale) => sale.id === this.eventId()) ?? null);

	/** Products that will join, from the last dry run. */
	readonly joining = computed(() => this.rows().filter((row) => row.result?.outcome === 'done').length);

	/** Fixed price only: boxes still empty, and prices above today's. */
	readonly toFix = computed(() => {
		if (this.kind() !== 'fixed') return 0;
		return this.rows().filter((row) => this.usable(row) && this.problem(row) !== null).length;
	});

	start(picks: SalePick[]): void {
		this.picks.set(picks);
		this.events
			.list({ type: 'sale', paginate: 100 })
			.pipe(takeUntilDestroyed(this.destroyRef))
			.subscribe({
				next: ({ data }) => {
					const open = data
						.filter((sale) => OPEN.includes(sale.status))
						.sort((a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status));
					this.sales.set(open);
					this.eventId.set(open[0]?.id ?? NEW_SALE);
					void this.probe();
				},
				error: () => void this.probe(),
			});
		this.changes
			.pipe(
				debounceTime(300),
				switchMap(() => {
					const lines = this.lines();
					if (!lines.length) return of(null);
					this.checking.set(true);
					return this.products
						.addToSale({ eventId: this.saleId(), lines, dryRun: true })
						.pipe(catchError(() => of(null)));
				}),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((result) => {
				this.checking.set(false);
				this.apply(result, false);
			});
	}

	/** The first dry run: each product's SKUs and prices now, and what the sale can't take. */
	private async probe(): Promise<void> {
		this.loading.set(true);
		const lines = this.picks().map((pick) => ({
			productId: pick.id,
			rule: { kind: 'percent' as const, value: 1, skuPrices: {} },
		}));
		try {
			const result = await firstValueFrom(
				this.products.addToSale({ eventId: this.saleId(), lines, dryRun: true }),
			);
			this.apply(result, true);
		} catch {
			this.failed.set(true);
		} finally {
			this.loading.set(false);
			this.changed();
		}
	}

	private apply(result: ProductSaleResult | null, probe: boolean): void {
		const answers = new Map((result?.rows ?? []).map((row) => [row.productId, row]));
		this.rows.update((rows) =>
			(rows.length ? rows : this.picks().map((pick) => ({ pick, skus: [], result: null }))).map((row) => {
				const answer = answers.get(row.pick.id);
				if (probe)
					return {
						...row,
						skus: answer?.prices ?? [],
						result: answer?.outcome === 'refused' ? answer : null,
					};
				// A product left out of this dry run (an empty box) keeps its standing refusal only.
				return {
					...row,
					result:
						answer ??
						(row.result?.outcome === 'refused' && row.result.reason !== 'bad_rule' ? row.result : null),
				};
			}),
		);
	}

	saleId(): string | null {
		return this.eventId() === NEW_SALE ? null : this.eventId();
	}

	changed(): void {
		this.changes.next();
	}

	pickSale(id: string): void {
		this.eventId.set(id);
		this.rows.set([]);
		void this.probe();
	}

	setKind(kind: string): void {
		this.kind.set(kind === 'amount' || kind === 'fixed' ? kind : 'percent');
		this.changed();
	}

	setValue(value: string): void {
		this.value.set(value);
		this.changed();
	}

	setProductPrice(id: string, value: string): void {
		this.productPrice.update((prices) => ({ ...prices, [id]: value }));
		this.changed();
	}

	setSkuPrice(sku: string, value: string): void {
		this.skuPrice.update((prices) => ({ ...prices, [sku]: value }));
		this.changed();
	}

	togglePerColour(id: string): void {
		this.perColour.update((set) => {
			const next = new Set(set);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
		this.changed();
	}

	/** "Same price for all": fills only the boxes still empty. */
	fillEmpty(): void {
		const price = this.fillAll().trim();
		if (whole(price) === null) return;
		this.productPrice.update((prices) => {
			const next = { ...prices };
			for (const row of this.rows()) if (!next[row.pick.id]?.trim()) next[row.pick.id] = price;
			return next;
		});
		this.skuPrice.update((prices) => {
			const next = { ...prices };
			for (const row of this.rows())
				for (const sku of row.skus) if (!next[sku.sku]?.trim()) next[sku.sku] = price;
			return next;
		});
		this.changed();
	}

	/** A product the sale can take at all: found, not discontinued, in no clashing sale. */
	usable(row: SaleRow): boolean {
		const reason = row.result?.reason;
		return reason !== 'overlap' && reason !== 'discontinued' && reason !== 'not_found';
	}

	hasColours(row: SaleRow): boolean {
		return row.skus.length > 1;
	}

	/** The lowest price now, for a product's "Now" column. */
	nowINR(row: SaleRow): number | null {
		return row.skus.length ? Math.min(...row.skus.map((sku) => sku.normalINR)) : null;
	}

	/** Rupees as the admin reads them: ₹2,500 (English digits in every language). */
	inr(value: number | null): string {
		return value === null ? '—' : `₹${value.toLocaleString('en-IN')}`;
	}

	/** The lowest sale price the last dry run gave this product. */
	saleFrom(row: SaleRow): number | null {
		const prices = (row.result?.prices ?? []).map((price) => price.saleINR).filter((price) => price !== null);
		return prices.length ? Math.min(...(prices as number[])) : null;
	}

	/** Fixed price: what is wrong with this product's boxes, or null. */
	problem(row: SaleRow): 'empty' | 'above' | null {
		const boxes = this.perColour().has(row.pick.id)
			? row.skus.map((sku) => ({ price: whole(this.skuPrice()[sku.sku] ?? ''), normal: sku.normalINR }))
			: [{ price: whole(this.productPrice()[row.pick.id] ?? ''), normal: this.nowINR(row) ?? 0 }];
		if (boxes.some((box) => box.price === null || box.price <= 0)) return 'empty';
		if (boxes.some((box) => (box.price ?? 0) > box.normal)) return 'above';
		return null;
	}

	priceAbove(normal: number, typed: string): boolean {
		const price = whole(typed);
		return price !== null && price > normal;
	}

	/** "20%" off for a typed fixed price. */
	offPercent(normal: number | null, typed: string): number | null {
		const price = whole(typed);
		if (normal === null || price === null || normal <= 0 || price > normal) return null;
		return Math.round(((normal - price) / normal) * 100);
	}

	overWarning(percent: number | null): boolean {
		return percent !== null && percent > WARN_PERCENT;
	}

	/** Each product's line as the sale stores it. Products with empty or wrong boxes are left out. */
	lines(): ProductSaleLineWrite[] {
		const kind = this.kind();
		const usable = this.rows().filter((row) => this.usable(row));
		if (kind !== 'fixed') {
			const value = Number(this.value());
			if (!this.value().trim() || !Number.isFinite(value) || value <= 0) return [];
			return usable.map((row) => ({ productId: row.pick.id, rule: { kind, value, skuPrices: {} } }));
		}
		return usable
			.filter((row) => this.problem(row) === null)
			.map((row) => {
				if (!this.perColour().has(row.pick.id)) {
					return {
						productId: row.pick.id,
						rule: { kind, value: whole(this.productPrice()[row.pick.id] ?? '') ?? 0, skuPrices: {} },
					};
				}
				const skuPrices = Object.fromEntries(
					row.skus.map((sku) => [sku.sku, whole(this.skuPrice()[sku.sku] ?? '') ?? 0]),
				);
				return {
					productId: row.pick.id,
					rule: { kind, value: Math.min(...Object.values(skuPrices)), skuPrices },
				};
			});
	}

	canConfirm(): boolean {
		return !this.busy() && !this.loading() && !this.checking() && this.toFix() === 0 && this.joining() > 0;
	}

	async confirm(): Promise<void> {
		if (!this.canConfirm()) return;
		this.busy.set(true);
		this.failed.set(false);
		try {
			const result = await firstValueFrom(
				this.products.addToSale({ eventId: this.saleId(), lines: this.lines(), dryRun: false }),
			);
			this.modal.close({ result, created: this.saleId() === null } satisfies SaleClosed);
		} catch {
			this.failed.set(true);
		} finally {
			this.busy.set(false);
		}
	}
}
