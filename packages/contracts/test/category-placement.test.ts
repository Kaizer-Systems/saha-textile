import { describe, expect, it } from 'vitest';

import {
	CatalogStatus,
	CategoryFacetConfig,
	CategoryPlacement,
	CategoryPlacementSet,
	ProductStatus,
	isPubliclyVisibleStatus,
} from '../src/index';

describe('CatalogStatus', () => {
	it('mirrors the owner-locked product lifecycle exactly (drift guard)', () => {
		expect(CatalogStatus.options).toEqual(ProductStatus.options);
	});

	it('treats only `live` as publicly visible', () => {
		expect(isPubliclyVisibleStatus('live')).toBe(true);
		for (const status of ['draft', 'disabled', 'discontinued'] as const) {
			expect(isPubliclyVisibleStatus(status)).toBe(false);
		}
	});
});

const placement = (overrides: Record<string, unknown> = {}) => ({
	id: 'plc_pure_silk_under_sarees',
	categoryId: 'cat_pure_silk',
	parentCategoryId: 'cat_sarees',
	pathCategoryIds: ['cat_sarees', 'cat_pure_silk'],
	pathSlugs: ['sarees', 'pure-silk'],
	pathLabel: 'Sarees / Pure Silk',
	depth: 1,
	isCanonical: true,
	...overrides,
});

describe('CategoryPlacement', () => {
	it('parses a placement with lifecycle defaults', () => {
		const parsed = CategoryPlacement.parse(placement());
		expect(parsed.status).toBe('draft');
		expect(parsed.displayOrder).toBe(0);
	});

	it('accepts a root placement', () => {
		const parsed = CategoryPlacement.parse({
			id: 'plc_sarees',
			categoryId: 'cat_sarees',
			parentCategoryId: null,
			pathCategoryIds: ['cat_sarees'],
			pathSlugs: ['sarees'],
			pathLabel: 'Sarees',
			depth: 0,
		});
		expect(parsed.parentCategoryId).toBeNull();
		expect(parsed.isCanonical).toBe(false);
	});

	it('rejects a non-slug path segment and an empty path', () => {
		expect(CategoryPlacement.safeParse(placement({ pathSlugs: ['Sarees', 'pure-silk'] })).success).toBe(false);
		expect(CategoryPlacement.safeParse(placement({ pathCategoryIds: [] })).success).toBe(false);
	});
});

describe('CategoryPlacementSet — the DAG invariants a single row cannot see', () => {
	it('accepts the same category placed under two different parents', () => {
		const result = CategoryPlacementSet.safeParse([
			placement(),
			placement({
				id: 'plc_pure_silk_under_wedding',
				parentCategoryId: 'cat_wedding',
				pathCategoryIds: ['cat_wedding', 'cat_pure_silk'],
				pathSlugs: ['wedding', 'pure-silk'],
				pathLabel: 'Wedding / Pure Silk',
				isCanonical: false,
			}),
		]);
		expect(result.success).toBe(true);
	});

	it('rejects two canonical placements for one category', () => {
		const result = CategoryPlacementSet.safeParse([
			placement(),
			placement({
				id: 'plc_pure_silk_under_wedding',
				parentCategoryId: 'cat_wedding',
				pathCategoryIds: ['cat_wedding', 'cat_pure_silk'],
				pathSlugs: ['wedding', 'pure-silk'],
				pathLabel: 'Wedding / Pure Silk',
			}),
		]);
		expect(result.success).toBe(false);
		expect(result.error?.issues.some((issue) => issue.message.includes('canonical'))).toBe(true);
	});

	it('rejects mismatched path/slug lengths, wrong depth, and a wrong tail', () => {
		expect(CategoryPlacementSet.safeParse([placement({ pathSlugs: ['sarees'] })]).success).toBe(false);
		expect(CategoryPlacementSet.safeParse([placement({ depth: 4 })]).success).toBe(false);
		expect(
			CategoryPlacementSet.safeParse([placement({ pathCategoryIds: ['cat_sarees', 'cat_other'] })]).success,
		).toBe(false);
	});

	it('rejects a parent that disagrees with the path', () => {
		expect(CategoryPlacementSet.safeParse([placement({ parentCategoryId: 'cat_wedding' })]).success).toBe(false);
	});

	it('rejects a cycle in the placement path', () => {
		const result = CategoryPlacementSet.safeParse([
			placement({
				pathCategoryIds: ['cat_pure_silk', 'cat_sarees', 'cat_pure_silk'],
				pathSlugs: ['pure-silk', 'sarees', 'pure-silk'],
				depth: 2,
			}),
		]);
		expect(result.success).toBe(false);
	});

	it('rejects placements of different categories in one set', () => {
		expect(
			CategoryPlacementSet.safeParse([
				placement(),
				placement({
					id: 'plc_other',
					categoryId: 'cat_cotton',
					pathCategoryIds: ['cat_sarees', 'cat_cotton'],
					pathSlugs: ['sarees', 'cotton'],
					isCanonical: false,
				}),
			]).success,
		).toBe(false);
	});
});

describe('CategoryFacetConfig', () => {
	const config = (overrides: Record<string, unknown> = {}) => ({
		id: 'facets_sarees',
		scope: 'category',
		categoryId: 'cat_sarees',
		facets: [
			{
				code: 'colour',
				source: 'attribute',
				attributeCode: 'color',
				label: { en: 'Colour' },
				displayStyle: 'swatch',
			},
		],
		...overrides,
	});

	it('applies merchandising defaults, including per-breakpoint visibility', () => {
		const parsed = CategoryFacetConfig.parse(config());
		const facet = parsed.facets[0]!;
		expect(facet.enabled).toBe(true);
		expect(facet.showCounts).toBe(true);
		expect(facet.desktopVisible).toBe(true);
		expect(facet.mobileVisible).toBe(true);
		expect(facet.valueLimit).toBeNull();
	});

	it('defaults facet URLs to never being indexed (owner lock)', () => {
		expect(CategoryFacetConfig.parse(config()).facets[0]!.seoPolicy).toBe('never_index');
		expect(
			CategoryFacetConfig.safeParse(
				config({
					facets: [
						{
							code: 'colour',
							source: 'attribute',
							attributeCode: 'color',
							label: { en: 'Colour' },
							displayStyle: 'swatch',
							seoPolicy: 'always_index',
						},
					],
				}),
			).success,
		).toBe(false);
	});

	it('requires the id matching its scope', () => {
		expect(CategoryFacetConfig.safeParse(config({ categoryId: undefined })).success).toBe(false);
		expect(CategoryFacetConfig.safeParse(config({ scope: 'global', categoryId: undefined })).success).toBe(true);
		expect(
			CategoryFacetConfig.safeParse(config({ scope: 'category_placement', categoryId: undefined })).success,
		).toBe(false);
	});

	it('requires an attributeCode for attribute-backed facets', () => {
		expect(
			CategoryFacetConfig.safeParse(
				config({
					facets: [{ code: 'colour', source: 'attribute', label: { en: 'Colour' }, displayStyle: 'swatch' }],
				}),
			).success,
		).toBe(false);
		expect(
			CategoryFacetConfig.safeParse(
				config({ facets: [{ code: 'price', source: 'price', label: { en: 'Price' }, displayStyle: 'range' }] }),
			).success,
		).toBe(true);
	});

	it('rejects duplicate facet codes and an enabled facet hidden on every breakpoint', () => {
		const duplicate = config().facets[0]!;
		expect(CategoryFacetConfig.safeParse(config({ facets: [duplicate, duplicate] })).success).toBe(false);
		expect(
			CategoryFacetConfig.safeParse(
				config({ facets: [{ ...duplicate, desktopVisible: false, mobileVisible: false }] }),
			).success,
		).toBe(false);
	});
});
