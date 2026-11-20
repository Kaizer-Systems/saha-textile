import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Category,
	Product,
	ProductVariant,
	ZoneRule,
	ZoneTryRequest,
	ZoneTryResult,
} from '@saha-textile/contracts';
import {
	sellingPriceINR,
	zonePriceFor,
	type CategoryRepository,
	type InventoryCostLayerRepository,
	type ProductRepository,
	type ProductVariantRepository,
	type ZoneForPricing,
	type ZoneLineFacts,
	type ZonePricingResult,
} from '@saha-textile/core-domain';

import type { SalePriceBook } from '../events/sale-price-book';
import { codedRefusal } from '../common/coded-refusal';
import {
	CATEGORY_REPOSITORY,
	INVENTORY_COST_LAYER_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	SALE_PRICE_BOOK,
} from '../infra/tokens';

/** One product line to price: pieces, or metres for fabric sold by the metre. */
export interface ZoneItem {
	productId: string;
	variantId: string | null;
	quantity: number;
}

export interface ZoneItemFacts {
	product: Product;
	variant: ProductVariant;
	facts: ZoneLineFacts;
}

/** The shop's price for a SKU now: the live sale price, else its regular selling price. */
export function retailUnitINR(facts: Pick<ZoneLineFacts, 'currentSaleINR' | 'regularSellingINR'>): number {
	return facts.currentSaleINR ?? facts.regularSellingINR;
}

/**
 * The facts zone rules read, from the stored product and the running sales (owner's data rule,
 * 2026-11-20): the regular selling price comes from the stored row and is never touched by a sale;
 * the current sale price comes from the sale book and is empty when no sale runs; MRP is the stored
 * MRP; purchase cost is the average unit cost of the open cost layers, per piece or per metre (no
 * open layer: not known). Variant
 * rows are read with the admin audience, so no sale price is laid over them.
 */
@Injectable()
export class ZonePricingService {
	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(SALE_PRICE_BOOK) private readonly book: SalePriceBook,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY) private readonly costLayers: InventoryCostLayerRepository,
	) {}

	/** The facts for each item; the order's goods value is the shop price of every line together. */
	async factsFor(items: readonly ZoneItem[], now = new Date()): Promise<ZoneItemFacts[]> {
		const tree = await this.categories.tree();
		const byId = new Map(tree.map((node) => [node.id, node]));
		const rows: Array<{ product: Product; variant: ProductVariant; item: ZoneItem; cost: number | null }> = [];
		for (const item of items) {
			const product = await this.products.findById(item.productId, 'admin');
			if (!product) {
				throw new NotFoundException(
					codedRefusal('product_missing', 'That product does not exist', 'productId'),
				);
			}
			const variant = await this.variantFor(product, item.variantId);
			rows.push({ product, variant, item, cost: await this.averageCost(variant.id, product.soldBy) });
		}
		const lines = rows.map(({ product, variant, item, cost }) => {
			const regularSellingINR = sellingPriceINR(variant.priceINR, variant.salePriceINR);
			const sale = this.book.priceFor(variant, now);
			const metre = product.soldBy === 'metre';
			const facts: ZoneLineFacts = {
				productId: product.id,
				sku: variant.sku,
				categoryPaths: product.categoryIds.map((id) => categoryPath(byId, id)),
				regularSellingINR,
				currentSaleINR: sale && sale.saleINR < regularSellingINR ? sale.saleINR : null,
				mrpINR: variant.compareAtPriceINR ?? (variant.salePriceINR !== null ? variant.priceINR : null),
				purchaseCostINR: cost,
				quantity: item.quantity,
				metres: metre ? item.quantity : null,
				orderGoodsINR: 0,
			};
			return { product, variant, facts };
		});
		const goods = lines.reduce((sum, line) => sum + retailUnitINR(line.facts) * line.facts.quantity, 0);
		for (const line of lines) line.facts.orderGoodsINR = Math.round(goods * 100) / 100;
		return lines;
	}

	price(zone: ZoneForPricing, facts: ZoneLineFacts, now = new Date()): ZonePricingResult {
		return zonePriceFor(zone, facts, now);
	}

	/** Try it: unsaved rules on real products, line by line, as if the zone were live. */
	async tryRules(request: ZoneTryRequest, now = new Date()): Promise<ZoneTryResult> {
		const lines = await this.factsFor(request.items, now);
		const zone: ZoneForPricing = { retail: false, live: true, rules: request.rules as ZoneRule[] };
		return {
			lines: lines.map(({ product, variant, facts }) => {
				const result = zonePriceFor(zone, facts, now);
				return {
					productId: product.id,
					variantId: variant.id,
					title: product.title.en,
					sku: variant.sku,
					price: result.price,
					trace: result.trace,
				};
			}),
		};
	}

	private async variantFor(product: Product, variantId: string | null): Promise<ProductVariant> {
		const rows = await this.variants.listForProduct(product.id, 'admin');
		const row = variantId
			? rows.find((candidate) => candidate.id === variantId)
			: (rows.find((candidate) => candidate.isBaseVariant) ?? rows[0]);
		if (!row) {
			throw new NotFoundException(
				codedRefusal('variant_missing', 'That product has no such variant', 'variantId'),
			);
		}
		return row;
	}

	/** Per piece, or per metre (cost layers keep fabric by the tenth of a metre). */
	private async averageCost(variantId: string, soldBy: Product['soldBy']): Promise<number | null> {
		const layers = await this.costLayers.listOpenLayers(variantId);
		const units = layers.reduce((sum, layer) => sum + layer.quantityRemaining, 0);
		if (!units) return null;
		const value = layers.reduce((sum, layer) => sum + layer.unitCostINR * layer.quantityRemaining, 0);
		return Math.round((value / units) * (soldBy === 'metre' ? 10 : 1) * 100) / 100;
	}
}

/** A category with its parents, nearest first (the product's own category is index 0). */
function categoryPath(byId: ReadonlyMap<string, Category>, id: string): string[] {
	const node = byId.get(id);
	if (!node) return [id];
	const path = node.path.length ? node.path : [...node.ancestors, node.id];
	return [...path].reverse();
}
