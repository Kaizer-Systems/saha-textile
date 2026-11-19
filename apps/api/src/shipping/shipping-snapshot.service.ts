import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
	type Category,
	type ShippingCartSnapshot,
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
			return categoryCache.get(id) ?? null;
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
			const priced = priceCartLine(read.page, { variationId: input.variationId, addons: [] });
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
			const variant = input.variationId ? await this.variants.findById(input.variationId, 'admin') : null;

			const mainId = mainCategoryId(product.categoryIds);
			const main = mainId ? await category(mainId) : null;
			// `ancestors` runs from the root down; the nearest parent comes first here.
			const parents = main
				? (await Promise.all([...main.ancestors].reverse().map(category))).filter(
						(c): c is Category => c !== null,
					)
				: [];
			const chain = main ? [main, ...parents] : [];

			const { charges } = resolveShippingCharges(
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
			});
		}
		return { snapshot: { lines: built, delivery, shopper }, views };
	}
}
