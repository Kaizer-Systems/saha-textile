import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Category, CategoryPlacement, Product, ProductBundle, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	buildShowcaseProducts,
	categoryIdsFor,
	finishShowcase,
	SHOWCASE_SIZE,
} from '../scripts/showcase-catalogue-build';
import { fabricFor, LEAVES, patternFor, workFor } from '../scripts/showcase-catalogue-data';
import { mapDemoCatalogue } from '../src/seed/map-demo-catalogue';

const now = new Date('2026-11-07T00:00:00.000Z');
/** Spelled the same in both languages, checked by hand. */
const rows = <T>(name: string): T[] =>
	(
		JSON.parse(readFileSync(resolve(__dirname, '../../../apps/storefront/public/assets/data', name), 'utf8')) as {
			data: T[];
		}
	).data;

const productIds = rows<{ id: number }>('product.json').map((row) => row.id);
const known = new Map(
	rows<{ id: number; canonical_path: string }>('category.json').map((row) => [row.canonical_path, row.id]),
);
const showcase = buildShowcaseProducts({ productIds, categoryIds: categoryIdsFor(known), now });
const catalogue = finishShowcase(mapDemoCatalogue({ products: showcase.products }), showcase, now);
const notes = [...showcase.notes.values()];
const count = (test: (note: (typeof notes)[number]) => boolean) => notes.filter(test).length;

describe('showcase catalogue', () => {
	it('holds exactly 1,000 products with unique names, addresses and SKUs', () => {
		expect(LEAVES.reduce((sum, leaf) => sum + leaf.count, 0)).toBe(SHOWCASE_SIZE);
		expect(catalogue.products).toHaveLength(SHOWCASE_SIZE);
		for (const key of ['slug', 'sku'] as const) {
			expect(new Set(catalogue.products.map((row) => row[key])).size).toBe(SHOWCASE_SIZE);
		}
		expect(new Set(catalogue.products.map((row) => row.title.en)).size).toBe(SHOWCASE_SIZE);
		expect(new Set(catalogue.variants.map((row) => row.sku)).size).toBe(catalogue.variants.length);
	});

	it('writes valid documents', () => {
		for (const row of catalogue.products) Product.parse(row);
		for (const row of catalogue.variants) ProductVariant.parse(row);
		for (const row of catalogue.categories) Category.parse(row);
		for (const row of catalogue.placements) CategoryPlacement.parse(row);
		for (const row of catalogue.bundles) ProductBundle.parse(row);
	});

	it('replaces the demo rows by id, so nothing is left behind', () => {
		const ids = new Set(catalogue.products.map((row) => row.id));
		expect(productIds.every((id) => ids.has(`prd_${id}`))).toBe(true);
	});

	it('gives every category real stock, and every language a name', () => {
		const inLeaf = (path: string) => notes.filter((note) => note.leaf.path === path).length;
		for (const leaf of LEAVES) expect(inLeaf(leaf.path)).toBeGreaterThanOrEqual(12);
		for (const row of catalogue.categories) expect(row.name['bn']?.trim()).toBeTruthy();
		for (const row of catalogue.products) {
			expect(row.title['bn']?.trim()).toBeTruthy();
			expect(row.shortDescription['bn']?.trim()).toBeTruthy();
		}
	});

	it('covers every shopping scenario more than once', () => {
		for (const scenario of [
			'simple',
			'colour',
			'size',
			'colour_size',
			'compound',
			'blouse_design',
			'suit_stitching',
			'bundle',
		]) {
			expect(
				count((note) => note.scenario === scenario),
				scenario,
			).toBeGreaterThan(3);
		}
		for (const stock of ['in_stock', 'low', 'out', 'back', 'made_to_order']) {
			expect(
				count((note) => note.stock === stock),
				stock,
			).toBeGreaterThan(3);
		}
		for (const lifecycle of ['live', 'draft', 'disabled', 'discontinued']) {
			expect(
				count((note) => note.lifecycle === lifecycle),
				lifecycle,
			).toBeGreaterThan(3);
		}
		expect(count((note) => note.saleOn)).toBeGreaterThan(100);
		expect(count((note) => note.isNew)).toBeGreaterThan(30);
		expect(count((note) => note.insight === 'bestseller')).toBeGreaterThan(10);
	});

	it('uses the three photos in many combinations', () => {
		const sets = new Set(catalogue.products.map((row) => row.media.gallery.join()));
		expect(sets.size).toBeGreaterThanOrEqual(15);
		const compound = catalogue.products.filter((row) => row.imageMode === 'compound');
		expect(compound.length).toBeGreaterThan(3);
		for (const row of compound) expect(row.media.compound.length).toBeGreaterThan(1);
	});

	it('is the same on a second run', () => {
		const again = buildShowcaseProducts({ productIds, categoryIds: categoryIdsFor(known), now });
		expect(again.products.map((row) => row.slug)).toEqual(showcase.products.map((row) => row.slug));
	});

	it('gives sarees a length, and suits a template with a size guide', () => {
		const lengths = catalogue.products.filter((row) => row.sareeLengthM !== null);
		expect(lengths.length).toBeGreaterThan(500);
		expect(lengths.every((row) => row.tags.includes('suits'))).toBe(false);
		const suits = catalogue.products.filter((row) => row.addonTemplateCode === 'suit-measurements');
		expect(suits.length).toBeGreaterThan(100);
		const guide = catalogue.addonTemplates.find((row) => row.code === 'suit-measurements')?.sizeGuide;
		expect(guide?.map((row) => row.size)).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
	});

	it('leaves no shopper word without Bengali', () => {
		const words = catalogue.products.flatMap((row) =>
			row.optionGroups.flatMap((group) => [group.label, ...group.terms.map((term) => term.label)]),
		);
		const untranslated = new Set(
			words
				.filter((label) => !/[\u0980-\u09FF]/.test(label['bn'] ?? '') && /[a-z]{5}/.test(label.en as string))
				.map((label) => label.en),
		);
		expect([...untranslated]).toEqual([]);
	});

	it('lists every value a product uses in its attribute, so filters and the admin agree', () => {
		const terms = new Map(
			catalogue.attributeDefinitions.map((row) => [row.code, new Set(row.terms.map((term) => term.code))]),
		);
		for (const product of catalogue.products) {
			for (const group of product.optionGroups) {
				for (const term of group.terms) expect(terms.get(group.attributeCode)?.has(term.code)).toBe(true);
			}
		}
		expect(terms.get('work')?.size).toBeGreaterThan(5);
	});

	it('never files a product under a Work its title contradicts', () => {
		for (const product of catalogue.products) {
			const work = product.optionGroups.find((group) => group.attributeCode === 'work')?.terms[0]?.label['en'];
			if (work) expect(workFor(product.title['en'] as string, work)).toBe(work);
		}
	});
});

describe('filter values from the title', () => {
	it.each([
		['Bottle Green Meenakari Jangla Katan Banarasi Saree', 'Zari', 'Meenakari'],
		['Burnt Orange Kadhua Buti Katan Banarasi Saree', 'Meenakari', 'Zari'],
		['Rust Kantha Pallu Bengal Handloom Cotton Saree', 'Woven', 'Embroidered'],
		['Rust Bandhani Print Jaipur Print Saree', 'Woven', 'Print'],
		['Rust Sequin Bel Organza Saree', 'Stone', 'Sequins'],
		['Teal Temple Border Kanchipuram Saree', 'Woven', 'Woven'],
	])('Work of %s', (title, fallback, expected) => {
		expect(workFor(title, fallback)).toBe(expected);
	});

	it('takes the pattern the title names', () => {
		expect(patternFor('Indigo Pasapali Checks Cotton Saree', 'Floral')).toBe('Checks');
		expect(patternFor('Mustard Stripe Linen Saree', 'Geometric')).toBe('Striped');
		expect(patternFor('Teal Tilfi Banarasi Saree', 'Geometric')).toBe('Geometric');
	});

	it('takes the one fabric the title names, never a "Semi" blend or a mix', () => {
		expect(fabricFor('Peach Tissue Banarasi Saree', 'Silk')).toBe('Tissue');
		expect(fabricFor('Mustard Yellow Booti Weave Semi Organza Saree', 'Blended Silk')).toBe('Blended Silk');
		expect(fabricFor('Ivory Cotton Silk Saree', 'Blended Silk')).toBe('Blended Silk');
		expect(fabricFor('Teal Tilfi Banarasi Saree', 'Silk')).toBe('Silk');
	});
});
