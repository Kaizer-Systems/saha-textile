import { BadRequestException } from '@nestjs/common';
import type { Product, ProductContentWrite, ProductVariant } from '@saha-textile/contracts';
import { variantMatrix } from '@saha-textile/core-domain';

/** The language-bound text, categories, options and images, applied to a product. */
export function applyProductContent(product: Product, content: ProductContentWrite): Partial<Product> {
	const english = content.title['en']?.trim();
	if (!english) throw new BadRequestException('A product needs an English name');
	return {
		title: { ...content.title, en: english },
		shortDescription: content.shortDescription,
		description: { en: '', ...content.description },
		seo: { title: content.metaTitle, description: content.metaDescription },
		categoryIds: content.categoryIds,
		optionGroups: content.optionGroups,
		imageMode: content.imageMode,
		media: { gallery: content.gallery, compound: content.compound, altOverrides: content.altOverrides },
	};
}

const skuPart = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

/**
 * Rows the option groups call for: existing ones keep their price and stock, a new combination
 * starts from the base row, and a combination no longer offered is disabled, never deleted,
 * because an order may point at it.
 */
export function syncVariantRows(product: Product, rows: readonly ProductVariant[]): ProductVariant[] {
	const combinations = variantMatrix(product.optionGroups);
	if (!combinations.length) return [];
	const byHash = new Map(rows.map((row) => [row.optionSelectionHash, row]));
	const wanted = new Set(combinations.map((combination) => combination.hash));
	const template = rows.find((row) => row.isBaseVariant) ?? (rows[0] as ProductVariant);
	const added = combinations
		.filter((combination) => !byHash.has(combination.hash))
		.map((combination) => ({
			...template,
			id: `var_${product.id}_${combination.hash.replace(/[^a-z0-9]+/gi, '_')}`,
			sku: [product.sku, ...combination.selections.map((selection) => skuPart(selection.termCode))].join('-'),
			optionSelections: combination.selections,
			optionSelectionHash: combination.hash,
			isBaseVariant: combination.isBase,
			status: 'live' as const,
			stock: { ...template.stock, quantity: 0 },
		}));
	const dropped = rows
		.filter((row) => !wanted.has(row.optionSelectionHash) && row.status !== 'disabled')
		.map((row) => ({ ...row, status: 'disabled' as const, isBaseVariant: false }));
	return [...added, ...dropped];
}
