import type { Product, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { goLiveGaps, productGallery } from '../src/catalog/go-live';
import { selectionHash, variantMatrix } from '../src/catalog/variant-matrix';

const both = { en: 'Text', fr: 'Texte' };
const complete = (over: Record<string, unknown> = {}) =>
	({
		title: both,
		shortDescription: both,
		description: both,
		seo: { title: both, description: both },
		optionGroups: [
			{
				attributeCode: 'color',
				label: both,
				terms: [{ code: 'red', label: both }],
			},
		],
		categoryIds: ['c'],
		imageMode: 'simple',
		media: { gallery: ['a'], compound: [], altOverrides: {} },
		...over,
	}) as unknown as Product;

const run = (product: Product, priced = true, alt: Record<string, string> | null = both) =>
	goLiveGaps({
		product,
		variants: [{ priceINR: priced ? 100 : 0 } as ProductVariant],
		locales: ['en', 'fr'],
		assetAlt: () => alt,
	});

describe('goLiveGaps', () => {
	it('finds nothing on a finished product', () => {
		expect(run(complete())).toEqual([]);
	});

	it('names every language gap, and treats blanks as missing', () => {
		const gaps = run(
			complete({
				title: { en: 'x', fr: '  ' },
				shortDescription: { en: 'x' },
				description: undefined,
				seo: undefined,
				optionGroups: [
					{ attributeCode: 'color', label: { en: 'x' }, terms: [{ code: 'red', label: { en: 'x' } }] },
				],
			}),
		);
		expect(gaps).toEqual(
			expect.arrayContaining([
				{ field: 'title', locale: 'fr' },
				{ field: 'short_description', locale: 'fr' },
				{ field: 'description', locale: 'en' },
				{ field: 'meta_title', locale: 'fr' },
				{ field: 'meta_description', locale: 'en' },
				{ field: 'option:color', locale: 'fr' },
				{ field: 'value:color:red', locale: 'fr' },
			]),
		);
	});

	it('needs a category, a price and a primary image', () => {
		const gaps = run(complete({ categoryIds: [], media: { gallery: [], compound: [], altOverrides: {} } }), false);
		expect(gaps).toEqual([
			{ field: 'category', locale: null },
			{ field: 'price', locale: null },
			{ field: 'primary_image', locale: null },
		]);
	});

	it('reads alt text from the override, then the library', () => {
		expect(run(complete(), true, { en: 'x' })).toEqual([{ field: 'image_alt', locale: 'fr' }]);
		const overridden = complete({ media: { gallery: ['a'], compound: [], altOverrides: { a: { fr: 'y' } } } });
		expect(run(overridden, true, { en: 'x' })).toEqual([]);
		expect(run(complete(), true, null)).toHaveLength(2);
	});
});

describe('productGallery', () => {
	it('uses the gallery, or every combination once in compound mode', () => {
		const media = {
			gallery: ['a'],
			compound: [
				{ selectionHash: 'x', gallery: ['b', 'c'] },
				{ selectionHash: 'y', gallery: ['c', 'd'] },
			],
			altOverrides: {},
		};
		expect(productGallery({ imageMode: 'simple', media })).toEqual(['a']);
		expect(productGallery({ imageMode: 'compound', media })).toEqual(['b', 'c', 'd']);
	});
});

describe('variantMatrix', () => {
	const group = (attributeCode: string, role: string, ...codes: string[]) =>
		({ attributeCode, semanticRole: role, terms: codes.map((code) => ({ code })) }) as never;

	it('crosses the axes only, with the first row as the base', () => {
		const rows = variantMatrix([
			group('color', 'variation_axis', 'red', 'blue'),
			group('size', 'variation_axis', 's', 'm'),
			group('blouse', 'named_add_on', 'none'),
		]);
		expect(rows).toHaveLength(4);
		expect(rows[0]).toMatchObject({ hash: 'color:red|size:s', isBase: true });
		expect(rows[3]?.isBase).toBe(false);
	});

	it('makes no rows without an axis, and hashes in any order', () => {
		expect(variantMatrix([group('fabric', 'filter_only', 'silk')])).toEqual([]);
		const a = { attributeCode: 'a', termCode: '1' };
		const b = { attributeCode: 'b', termCode: '2' };
		expect(selectionHash([b, a])).toBe(selectionHash([a, b]));
	});
});
