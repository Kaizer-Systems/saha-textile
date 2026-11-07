import type { Product } from '@saha-textile/contracts';
import { searchDocument, type SearchEntry } from '@saha-textile/core-domain';

import { FACET_ROLES, listingPrice } from '../catalog/listing-row';

/** One filter value as the index stores it: everything needed to show it, in every language. */
export interface FacetValue {
	code: string;
	term: string;
	group: Record<string, string>;
	label: Record<string, string>;
}

/** Numbers in an id sort as numbers, as they do in Mongo listings. */
export const idOrder = (id: string): string => id.replace(/\d+/g, (digits) => digits.padStart(12, '0'));

/** A title with no translation sorts by its English, as the shop shows it. */
function lowerTitles(product: Product, locales: readonly string[]): Record<string, string> {
	return Object.fromEntries(
		locales.map((locale) => [locale, (product.title[locale] || product.title.en).toLowerCase()]),
	);
}

export function listingDocument({ product, variants }: SearchEntry, locales: readonly string[]) {
	const groups = product.optionGroups.filter((group) => FACET_ROLES.has(group.semanticRole));
	return {
		...searchDocument(product),
		...listingPrice(product, variants),
		idOrder: idOrder(product.id),
		createdOrder: product.createdAt ?? '',
		titleOrder: lowerTitles(product, locales),
		rating: product.ratingsSummary.avg,
		terms: groups.flatMap((group) => group.terms.map((term) => `${group.attributeCode}:${term.code}`)),
		filterCodes: product.optionGroups.flatMap((group) =>
			group.semanticRole === 'filter_only' ? group.attributeCode : [],
		),
		facetValues: groups.flatMap((group) =>
			group.terms.map((term) =>
				JSON.stringify({
					code: group.attributeCode,
					term: term.code,
					group: group.label,
					label: term.label,
				} satisfies FacetValue),
			),
		),
	};
}
