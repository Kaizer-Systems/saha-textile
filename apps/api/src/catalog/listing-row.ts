import type { Product, ProductVariant } from '@saha-textile/contracts';
import type { ListingRow } from '@saha-textile/core-domain';

import { productReadModel } from './catalog-read-model';
import { localized } from './catalog-locale';

/**
 * A facet exists where some product states the fact outright. A product that sells the same
 * fact as a choice, such as colour, then counts toward it too. Add-ons and bundle choices
 * describe an order, not a product.
 */
export const FACET_ROLES = new Set(['filter_only', 'variation_axis']);

/** The facet codes some product in the listing states outright. */
export function filterableCodes(products: readonly Product[]): Set<string> {
	return new Set(
		products.flatMap((product) =>
			product.optionGroups.flatMap((group) => (group.semanticRole === 'filter_only' ? group.attributeCode : [])),
		),
	);
}

/** What a listing needs from a product's price. */
export function listingPrice(product: Product, variants: readonly ProductVariant[]) {
	const { price } = productReadModel(product, variants);
	return {
		minINR: price.kind === 'range' ? price.minINR : price.sellingINR,
		maxINR: price.kind === 'range' ? price.maxINR : price.sellingINR,
		percentOff: price.kind === 'single' ? (price.percentOff ?? 0) : 0,
	};
}

export function listingRow(
	product: Product,
	variants: readonly ProductVariant[],
	filterable: ReadonlySet<string>,
): ListingRow {
	return {
		id: product.id,
		title: localized(product.title),
		...listingPrice(product, variants),
		rating: product.ratingsSummary.avg,
		categoryIds: product.categoryIds,
		facets: product.optionGroups
			.filter((group) => FACET_ROLES.has(group.semanticRole) && filterable.has(group.attributeCode))
			.map((group) => ({
				code: group.attributeCode,
				label: localized(group.label),
				terms: group.terms.map((term) => ({ code: term.code, label: localized(term.label) })),
			})),
	};
}
