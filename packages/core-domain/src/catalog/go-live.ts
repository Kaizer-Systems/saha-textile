import type { GoLiveGap, Product, ProductVariant } from '@saha-textile/contracts';

/** The asset's own alt text per language, or null when the asset is not in the library. */
export type AssetAlt = (assetId: string) => Readonly<Record<string, string>> | null;

export interface GoLiveInput {
	product: Product;
	variants: readonly ProductVariant[];
	/** The shop's active languages. */
	locales: readonly string[];
	assetAlt: AssetAlt;
}

/** The images a product shows: its gallery, or every combination's in order in compound mode. */
export function productGallery(product: Pick<Product, 'imageMode' | 'media'>): string[] {
	if (product.imageMode !== 'compound') return product.media.gallery;
	return [...new Set(product.media.compound.flatMap((row) => row.gallery))];
}

const filled = (value: string | undefined): boolean => !!value && value.trim().length > 0;

function text(field: string, values: Readonly<Record<string, string>> | undefined, locales: readonly string[]) {
	return locales.filter((locale) => !filled(values?.[locale])).map((locale) => ({ field, locale }));
}

/**
 * Everything that stops a product going live. One rule for the form and the list: every
 * language-bound field in every active language, plus a category, a price and a primary image.
 */
export function goLiveGaps({ product, variants, locales, assetAlt }: GoLiveInput): GoLiveGap[] {
	const gaps: GoLiveGap[] = [
		...text('title', product.title, locales),
		...text('short_description', product.shortDescription, locales),
		...text('description', product.description, locales),
		...text('meta_title', product.seo?.title, locales),
		...text('meta_description', product.seo?.description, locales),
	];
	for (const group of product.optionGroups) {
		gaps.push(...text(`option:${group.attributeCode}`, group.label, locales));
		for (const term of group.terms) {
			gaps.push(...text(`value:${group.attributeCode}:${term.code}`, term.label, locales));
		}
	}
	const leadTime = product.estimatedDeliveryText;
	if (leadTime && filled(leadTime['en'])) gaps.push(...text('lead_time', leadTime, locales));
	const measures = product.optionGroups.some((group) => group.terms.some((term) => term.requiresMeasurements));
	if (measures && !product.addonTemplateCode) gaps.push({ field: 'addon_template', locale: null });
	if (!product.categoryIds.length) gaps.push({ field: 'category', locale: null });
	const priced = variants.some((row) => row.priceINR > 0);
	if (!priced) gaps.push({ field: 'price', locale: null });
	const primary = productGallery(product)[0];
	if (!primary) gaps.push({ field: 'primary_image', locale: null });
	else {
		const inherited = assetAlt(primary) ?? {};
		const override = product.media.altOverrides[primary] ?? {};
		const resolved = Object.fromEntries(
			locales.map((locale) => [locale, override[locale] || inherited[locale] || '']),
		);
		gaps.push(...text('image_alt', resolved, locales));
	}
	return gaps;
}
