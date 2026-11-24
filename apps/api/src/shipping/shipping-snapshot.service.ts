import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
	type Category,
	type CatalogProductPage,
	type ShippingCartSnapshot,
	type ShippingChargeKind,
	type ShippingChargeSourceView,
	type ShippingCharges,
	type ShippingSnapshotDelivery,
	type ShippingSnapshotLine,
	type ShippingSnapshotShopper,
	type ShippingTryLine,
	type ShippingTryLineView,
	mainCategoryId,
} from '@saha-textile/contracts';
import {
	type CategoryRepository,
	type ProductRepository,
	type ProductVariantRepository,
	cartLineTotalINR,
	chargeableGrams,
	isDiscounted,
	priceCartLine,
	resolveShippingBox,
	resolveShippingCharges,
} from '@saha-textile/core-domain';

import { CatalogPublicService } from '../catalog/catalog-public.service';
import { CATEGORY_REPOSITORY, PRODUCT_REPOSITORY, PRODUCT_VARIANT_REPOSITORY } from '../infra/tokens';

export interface BuiltSnapshot {
	snapshot: ShippingCartSnapshot;
	views: ShippingTryLineView[];
}

/**
 * Turns cart lines (real products and quantities) into what the shipping engine prices: the live
 * price after any sale event, MRP, the price before add-ons, the categories, the resolved charges
 * (product → main category → parents → shop default), and the chargeable weight. Try it, test
 * carts and, later, checkout all build their snapshot here, so they agree.
 */
@Injectable()
export class ShippingSnapshotService {
	constructor(
		private readonly catalog: CatalogPublicService,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
	) {}

	async build(
		lines: readonly ShippingTryLine[],
		delivery: ShippingSnapshotDelivery,
		shopper: ShippingSnapshotShopper,
		defaults: ShippingCharges,
	): Promise<BuiltSnapshot> {
		const categoryCache = new Map<string, Category | null>();
		const category = async (id: string): Promise<Category | null> => {
			if (!categoryCache.has(id)) categoryCache.set(id, await this.categories.findById(id));
			// Set just above for this id, as the category or null.
			return categoryCache.get(id) as Category | null;
		};

		const built: ShippingSnapshotLine[] = [];
		const views: ShippingTryLineView[] = [];
		for (const [index, input] of lines.entries()) {
			const lineId = `line-${index + 1}`;
			const read = await this.catalog.cartRead(input.productId);
			const product = await this.products.findById(input.productId, 'admin');
			if (!read?.page || !product)
				throw new BadRequestException({
					issues: [
						{ path: `lines.${index}`, message: 'That product is not on sale', code: 'unknown_product' },
					],
				});
			// A product with options and none chosen is priced with its first buyable option, as its card shows.
			const variationId = input.variationId ?? defaultVariationId(read.page) ?? null;
			const priced = priceCartLine(read.page, { variationId, addons: [] });
			if (!priced.ok)
				throw new BadRequestException({
					issues: [
						{
							path: `lines.${index}`,
							message: 'That product needs choices Try it cannot make',
							code: priced.reason,
						},
					],
				});
			const row = priced.line;
			const variant = variationId ? await this.variants.findById(variationId, 'admin') : null;

			const mainId = mainCategoryId(product.categoryIds);
			const main = mainId ? await category(mainId) : null;
			// `ancestors` runs from the root down; the nearest parent comes first here.
			const parents = main
				? (await Promise.all([...main.ancestors].reverse().map(category))).filter(
						(c): c is Category => c !== null,
					)
				: [];
			const chain = main ? [main, ...parents] : [];

			const { charges, sources } = resolveShippingCharges(
				product.shippingCharges ?? null,
				chain.map((c) => ({ id: c.id, shipping: c.shipping ?? null })),
				defaults,
			);
			const metre = row.soldBy === 'metre';
			const box = resolveShippingBox([
				variant?.shippingProfile,
				product.shippingDefaults,
				...chain.map((c) => c.shipping),
			]);
			const grams = metre
				? product.weightPerMetreGrams
					? (product.weightPerMetreGrams * input.quantity) / 10
					: chargeableGrams(box)
				: chargeableGrams(box);

			const line: ShippingSnapshotLine = {
				lineId,
				productId: product.id,
				categoryIds: product.categoryIds,
				mainCategoryId: mainId,
				mainCategoryAncestorIds: parents.map((c) => c.id),
				freeShipping: product.freeShipping ?? false,
				// A length of fabric is one unit, priced as the whole cut.
				units: metre ? 1 : input.quantity,
				sellingPriceINR: metre ? cartLineTotalINR(row, input.quantity) : row.unitPriceINR,
				mrpINR: row.mrpINR,
				basePriceINR: row.basePriceINR,
				onSaleEvent: read.page.saleEndsAt !== null,
				soldBy: row.soldBy,
				madeToOrder: read.page.madeToOrder,
				chargeableWeightGrams: grams,
				charges,
			};
			built.push(line);
			views.push({
				lineId,
				productId: product.id,
				title: read.title,
				units: line.units,
				sellingPriceINR: line.sellingPriceINR,
				mrpINR: line.mrpINR,
				discounted: isDiscounted(line),
				charges,
				chargeableWeightGrams: grams,
				variantLabel: row.variantLabel ?? null,
				imageUrl: thumbnailOf(read.page),
				chargeSources: sourceViews(sources, chain),
				box: metre ? null : box,
			});
		}
		return { snapshot: { lines: built, delivery, shopper }, views };
	}
}

/** The first option a shopper can buy, else the first one; undefined for a product without options. */
export function defaultVariationId(page: CatalogProductPage): string | undefined {
	if (page.variants.length === 0) return undefined;
	return (page.variants.find((v) => v.buyable) ?? page.variants[0])?.id;
}

function thumbnailOf(page: CatalogProductPage): string | null {
	const first = page.gallery[0];
	if (!first) return null;
	return first.roles['card']?.[0]?.url ?? first.roles['gallery']?.[0]?.url ?? null;
}

function sourceViews(
	sources: Record<ShippingChargeKind, { from: string; categoryId: string | null }>,
	chain: readonly Category[],
): Record<ShippingChargeKind, ShippingChargeSourceView> {
	const view = (source: { from: string; categoryId: string | null }): ShippingChargeSourceView => {
		if (source.from === 'product') return { from: 'product', name: null };
		if (source.categoryId === null) return { from: 'shopDefault', name: null };
		// A category source is always one of the chain's own categories.
		const category = chain.find((c) => c.id === source.categoryId) as Category;
		return { from: 'category', name: category.name['en'] ?? Object.values(category.name)[0] ?? null };
	};
	return {
		domestic: view(sources.domestic),
		internationalFirst: view(sources.internationalFirst),
		internationalFurther: view(sources.internationalFurther),
	};
}
