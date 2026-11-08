import { Logger } from '@nestjs/common';
import type { Category, ProductVariant, ShopEvent } from '@saha-textile/contracts';
import {
	type CategoryRepository,
	type ProductRepository,
	type SaleCandidate,
	type ShopEventRepository,
	resolveSaleRule,
	salePriceINR,
	sellingPriceINR,
} from '@saha-textile/core-domain';

/** How often every server re-reads the published sales, so an edit elsewhere lands within it. */
export const SALE_BOOK_REFRESH_MS = 60_000;
const PAGE = 500;

interface BookEntry {
	eventId: string;
	startsAt: number;
	endsAt: number;
	candidates: SaleCandidate[];
}

/** The categories under each category, itself included, from one read of the tree. */
export function descendants(tree: readonly Category[]): Map<string, Set<string>> {
	const below = new Map<string, Set<string>>();
	for (const node of tree) {
		for (const id of node.path.length ? node.path : [node.id]) {
			const set = below.get(id) ?? new Set<string>();
			set.add(node.id);
			below.set(id, set);
		}
	}
	return below;
}

/**
 * Every published sale's rules, per product, held in memory so pricing never waits on a read.
 *
 * Prices follow the clock: an entry applies from its start to its end whatever the event's
 * stored status says, so the price changes on the exact second even before the clock writes
 * the new state. Nothing here is ever saved back to a product.
 */
export class SalePriceBook {
	private readonly logger = new Logger('SalePriceBook');
	private byProduct = new Map<string, BookEntry[]>();
	private timer: NodeJS.Timeout | null = null;

	constructor(
		private readonly events: ShopEventRepository,
		private readonly products: ProductRepository,
		private readonly categories: CategoryRepository,
	) {}

	start(): void {
		if (this.timer) return;
		void this.refresh();
		this.timer = setInterval(() => void this.refresh(), SALE_BOOK_REFRESH_MS);
		this.timer.unref();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** Re-reads every published sale. A failed read keeps the last good book. */
	async refresh(): Promise<void> {
		try {
			const sales = (await this.events.listPublished()).filter(
				(event) => event.type === 'sale' && event.startsAt && event.endsAt,
			);
			const next = new Map<string, BookEntry[]>();
			if (sales.length) {
				const below = descendants(await this.categories.tree());
				for (const event of sales) await this.add(next, event, below);
			}
			this.byProduct = next;
		} catch (error) {
			this.logger.warn(`Sale prices could not be re-read: ${error instanceof Error ? error.message : 'unknown'}`);
		}
	}

	private async add(into: Map<string, BookEntry[]>, event: ShopEvent, below: Map<string, Set<string>>) {
		const categoryIds = [...new Set(event.sale.categories.flatMap((line) => [...(below.get(line.categoryId) ?? [])]))];
		const memberOf = new Map<string, Set<string>>();
		if (categoryIds.length) {
			for (let page = 1; ; page += 1) {
				const { items, total } = await this.products.list({ audience: 'admin', categoryIds, page, pageSize: PAGE });
				for (const product of items) memberOf.set(product.id, new Set(product.categoryIds));
				if (!items.length || page * PAGE >= total) break;
			}
		}
		const productIds = new Set([...memberOf.keys(), ...event.sale.products.map((line) => line.productId)]);
		for (const productId of productIds) {
			const own = memberOf.get(productId) ?? new Set<string>();
			const resolution = resolveSaleRule(event.sale, productId, (categoryId) =>
				[...(below.get(categoryId) ?? [])].some((id) => own.has(id)),
			);
			if (!resolution?.candidates.length) continue;
			const entry: BookEntry = {
				eventId: event.id,
				startsAt: Date.parse(event.startsAt as string),
				endsAt: Date.parse(event.endsAt as string),
				candidates: resolution.candidates,
			};
			into.set(productId, [...(into.get(productId) ?? []), entry]);
		}
	}

	private running(productId: string, at: number): BookEntry[] {
		return (this.byProduct.get(productId) ?? []).filter((entry) => entry.startsAt <= at && at < entry.endsAt);
	}

	/** The sale price this SKU sells at now, or null when no sale lowers it. */
	priceFor(row: Pick<ProductVariant, 'productId' | 'sku' | 'priceINR' | 'salePriceINR'>, now = new Date()) {
		const normal = sellingPriceINR(row.priceINR, row.salePriceINR);
		let best: { saleINR: number; eventId: string; endsAt: string } | null = null;
		for (const entry of this.running(row.productId, now.getTime())) {
			const price = salePriceINR(entry.candidates, normal, row.sku);
			if (price !== null && (best === null || price < best.saleINR)) {
				best = { saleINR: price, eventId: entry.eventId, endsAt: new Date(entry.endsAt).toISOString() };
			}
		}
		return best;
	}

	/** The row as the shop sees it now: the sale price in `salePriceINR` while a sale lowers it. */
	overlay(row: ProductVariant, now = new Date()): ProductVariant {
		const sale = this.priceFor(row, now);
		return sale ? { ...row, salePriceINR: sale.saleINR } : row;
	}

	/** When the soonest-ending running sale on this product ends, for the product page timer. */
	endsAtFor(productId: string, now = new Date()): string | null {
		const ends = this.running(productId, now.getTime()).map((entry) => entry.endsAt);
		return ends.length ? new Date(Math.min(...ends)).toISOString() : null;
	}

	/** Every product a sale touches, for re-indexing at its start and end. */
	productsIn(eventId: string): string[] {
		return [...this.byProduct].flatMap(([productId, entries]) =>
			entries.some((entry) => entry.eventId === eventId) ? [productId] : [],
		);
	}
}
