import { Inject, Injectable } from '@nestjs/common';
import type {
	Product,
	ShopEvent,
	ShopEventCategoryProducts,
	ShopEventItemRow,
	ShopEventPriceRow,
	ShopEventProblem,
} from '@saha-textile/contracts';
import {
	type CategoryPlacementRepository,
	type CategoryRepository,
	type ProductRepository,
	type ProductVariantRepository,
	type ShopEventRepository,
	resolveSaleRule,
	salePriceINR,
	saleWarning,
	sellingPriceINR,
	windowsOverlap,
} from '@saha-textile/core-domain';

import { ProductBuilderService } from '../catalog/product-builder.service';
import {
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	SHOP_EVENT_REPOSITORY,
} from '../infra/tokens';
import { descendants } from './sale-price-book';

const PAGE = 500;
const title = (product: Product) => product.title['en'] || product.sku;

/** One product an event touches, and the category it came through (null when picked alone). */
interface Target {
	product: Product;
	categoryId: string | null;
	held: boolean;
}

/**
 * What an event touches in the catalogue: its products, their readiness, and their sale prices.
 * Reads only. The admin screens, Publish and the clock all go through here, so what Review
 * shows is exactly what runs.
 */
@Injectable()
export class EventCatalog {
	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(CATEGORY_PLACEMENT_REPOSITORY) private readonly placements: CategoryPlacementRepository,
		@Inject(SHOP_EVENT_REPOSITORY) private readonly events: ShopEventRepository,
		private readonly builder: ProductBuilderService,
	) {}

	/** Every product in these categories or the categories under them. */
	async inCategories(categoryIds: readonly string[]): Promise<Product[]> {
		if (!categoryIds.length) return [];
		const below = descendants(await this.categories.tree());
		const ids = [...new Set(categoryIds.flatMap((id) => [...(below.get(id) ?? [id])]))];
		const found: Product[] = [];
		for (let page = 1; ; page += 1) {
			const { items, total } = await this.products.list({ audience: 'admin', categoryIds: ids, page, pageSize: PAGE });
			found.push(...items);
			if (!items.length || page * PAGE >= total) return found;
		}
	}

	private async byIds(ids: readonly string[]): Promise<Product[]> {
		const found = await Promise.all([...new Set(ids)].map((id) => this.products.findById(id, 'admin')));
		return found.filter((product): product is Product => !!product);
	}

	/** The products of one category with their SKUs, for the item list and the exceptions modal. */
	async categoryProducts(categoryId: string): Promise<ShopEventCategoryProducts> {
		const products = await this.inCategories([categoryId]);
		const rows = await this.variants.listForProducts(
			products.map((product) => product.id),
			'admin',
		);
		return {
			categoryId,
			products: products.map((product) => ({
				productId: product.id,
				sku: product.sku,
				title: title(product),
				status: product.status,
				skus: rows
					.filter((row) => row.productId === product.id)
					.map((row) => ({ sku: row.sku, normalINR: sellingPriceINR(row.priceINR, row.salePriceINR) })),
			})),
		};
	}

	/** A launch's products: the draft ones in its categories, then the ones picked alone. */
	async launchTargets(event: ShopEvent): Promise<Target[]> {
		const held = new Set(event.launch.heldProductIds);
		const targets = new Map<string, Target>();
		for (const categoryId of event.launch.categoryIds) {
			for (const product of await this.inCategories([categoryId])) {
				if (product.status === 'live' || product.status === 'discontinued' || targets.has(product.id)) continue;
				targets.set(product.id, { product, categoryId, held: held.has(product.id) });
			}
		}
		for (const product of await this.byIds(event.launch.productIds)) {
			if (!targets.has(product.id)) targets.set(product.id, { product, categoryId: null, held: false });
		}
		return [...targets.values()];
	}

	/** The launch Items tab: each product with its Go Live gaps. */
	async launchItems(event: ShopEvent): Promise<ShopEventItemRow[]> {
		const targets = await this.launchTargets(event);
		return Promise.all(
			targets.map(async ({ product, categoryId, held }) => ({
				productId: product.id,
				sku: product.sku,
				title: title(product),
				status: product.status,
				categoryId,
				held,
				gaps: held || product.status === 'live' ? [] : await this.builder.gapsFor(product),
			})),
		);
	}

	/** A sale's products, each with where its rule came from. */
	async saleTargets(event: ShopEvent): Promise<Target[]> {
		const inLines = await this.inCategories(event.sale.categories.map((line) => line.categoryId));
		const picked = await this.byIds(event.sale.products.map((line) => line.productId));
		const all = new Map([...inLines, ...picked].map((product) => [product.id, product]));
		const below = descendants(await this.categories.tree());
		return [...all.values()].map((product) => {
			const own = new Set(product.categoryIds);
			const resolution = resolveSaleRule(event.sale, product.id, (categoryId) =>
				[...(below.get(categoryId) ?? [])].some((id) => own.has(id)),
			);
			return {
				product,
				categoryId: resolution?.candidates[0]?.categoryId ?? null,
				held: resolution?.source === 'held',
			};
		});
	}

	/** The Review tab of a sale: every SKU's final price and the rule it came from. */
	async salePrices(event: ShopEvent): Promise<ShopEventPriceRow[]> {
		const targets = (await this.saleTargets(event)).filter(({ product }) => product.status !== 'discontinued');
		const rows = await this.variants.listForProducts(
			targets.map(({ product }) => product.id),
			'admin',
		);
		const below = descendants(await this.categories.tree());
		return targets.flatMap(({ product }) => {
			const own = new Set(product.categoryIds);
			const resolution = resolveSaleRule(event.sale, product.id, (categoryId) =>
				[...(below.get(categoryId) ?? [])].some((id) => own.has(id)),
			);
			return rows
				.filter((row) => row.productId === product.id)
				.map((row) => {
					const normal = sellingPriceINR(row.priceINR, row.salePriceINR);
					const candidates = resolution?.candidates ?? [];
					const sale = candidates.length ? salePriceINR(candidates, normal, row.sku) : null;
					const winner =
						candidates.find((candidate) => salePriceINR([candidate], normal, row.sku) === sale) ??
						candidates[0];
					return {
						productId: product.id,
						productTitle: title(product),
						sku: row.sku,
						normalINR: normal,
						saleINR: sale,
						source: resolution?.source ?? 'held',
						categoryId: winner?.categoryId ?? null,
						warning: saleWarning(normal, sale),
						refused: candidates.length > 0 && sale === null,
					};
				});
		});
	}

	/** Products in another published or draft-overlapping sale over the same time. */
	async overlaps(event: ShopEvent, productIds: readonly string[]): Promise<ShopEventProblem[]> {
		if (event.type !== 'sale' || !event.startsAt || !event.endsAt) return [];
		const window = { startsAt: event.startsAt, endsAt: event.endsAt };
		const mine = new Set(productIds);
		const problems: ShopEventProblem[] = [];
		for (const other of await this.events.listPublished()) {
			if (other.id === event.id || other.type !== 'sale' || !other.startsAt || !other.endsAt) continue;
			if (!windowsOverlap(window, { startsAt: other.startsAt, endsAt: other.endsAt })) continue;
			const theirs = (await this.saleTargets(other)).filter((target) => !target.held);
			for (const { product } of theirs) {
				if (mine.has(product.id)) {
					problems.push({
						code: 'overlap',
						target: product.id,
						locale: null,
						gaps: [],
						detail: `${title(product)} · ${other.name}`,
					});
				}
			}
		}
		return problems;
	}

	/** Puts a launch's draft categories live: their canonical place on the shop menu. */
	async liveCategories(categoryIds: readonly string[]): Promise<string[]> {
		const changed: string[] = [];
		for (const categoryId of categoryIds) {
			for (const placement of await this.placements.listForCategory(categoryId)) {
				if (placement.status === 'live') continue;
				await this.placements.save({ ...placement, status: 'live' });
				if (!changed.includes(categoryId)) changed.push(categoryId);
			}
		}
		return changed;
	}

	/** Unknown ids on the form: a category or product deleted since it was picked. */
	async unknownItems(event: ShopEvent): Promise<ShopEventProblem[]> {
		const categoryIds =
			event.type === 'sale' ? event.sale.categories.map((line) => line.categoryId) : event.launch.categoryIds;
		const productIds =
			event.type === 'sale' ? event.sale.products.map((line) => line.productId) : event.launch.productIds;
		const known = new Set((await this.categories.tree()).map((row) => row.id));
		const found = new Set((await this.byIds(productIds)).map((product) => product.id));
		return [
			...categoryIds.filter((id) => !known.has(id)),
			...productIds.filter((id) => !found.has(id)),
		].map((id) => ({ code: 'unknown_item' as const, target: id, locale: null, gaps: [], detail: '' }));
	}
}
