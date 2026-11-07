import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Product, ProductBundle, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { catalogPhotoFrames, mapDemoCatalogue } from '../src/seed/map-demo-catalogue';

const dataDir = resolve(__dirname, '../../../apps/storefront/public/assets/data');
const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')) as { data: unknown[] };

describe('mapDemoCatalogue', () => {
	const mapped = mapDemoCatalogue({
		products: read('product.json').data as never,
		attributes: read('attribute.json').data as never,
	});

	it('imports every textile row, both bundles, and the measurement products', () => {
		expect(mapped.products).toHaveLength(390);
		expect(mapped.products.filter((product) => product.title.en.includes('Saha Textile'))).not.toHaveLength(390);
		expect(mapped.bundles).toHaveLength(2);
		// Six products with blouse add-ons plus the two bundles collect measurements.
		expect(mapped.products.filter((product) => product.addonTemplateCode === 'blouse-measurements')).toHaveLength(
			8,
		);
		expect(mapped.addonTemplates[0]?.fields.every((field) => field.validation?.step === 0.5)).toBe(true);
		for (const product of mapped.products) expect(() => Product.parse(product)).not.toThrow();
		for (const variant of mapped.variants) expect(() => ProductVariant.parse(variant)).not.toThrow();
		for (const bundle of mapped.bundles) expect(() => ProductBundle.parse(bundle)).not.toThrow();
	});

	it('rotates the three Spaces photos so neighbours do not share a primary', () => {
		expect(catalogPhotoFrames(0)[0]).not.toBe(catalogPhotoFrames(1)[0]);
		expect(catalogPhotoFrames(1)[0]).not.toBe(catalogPhotoFrames(2)[0]);
		expect(new Set(catalogPhotoFrames(0)).size).toBe(3);
		mapped.products.forEach((product, index) => {
			expect(product.media.gallery[0]).toBe(catalogPhotoFrames(index)[0]);
			expect(product.media.gallery).toEqual([...catalogPhotoFrames(index)]);
		});
		const styles = new Set(mapped.attributeDefinitions.map((definition) => definition.defaultDisplayStyle));
		for (const style of ['color_swatch', 'image_swatch', 'rectangle', 'circle', 'radio', 'dropdown']) {
			expect(styles.has(style as never)).toBe(true);
		}
	});

	it('stores the pickers, add-ons, filter facts, and bundle options as option groups', () => {
		const groups = mapped.products.flatMap((product) => product.optionGroups);
		const axisStyles = new Set(
			groups.filter((group) => group.semanticRole === 'variation_axis').map((group) => group.displayStyle),
		);
		for (const style of ['color_swatch', 'image_swatch', 'rectangle', 'circle', 'radio', 'dropdown']) {
			expect(axisStyles.has(style as never)).toBe(true);
		}
		const addons = mapped.products.filter((product) =>
			product.optionGroups.some((group) => group.semanticRole === 'named_add_on'),
		);
		expect(addons).toHaveLength(6);
		const katan = mapped.products.find((product) => product.slug === 'katan-banarasi-saree')!;
		const blouse = katan.optionGroups.find((group) => group.attributeCode === 'blouse-design')!;
		expect(blouse.defaultTermCode).toBe('no-design');
		expect(blouse.terms.find((term) => term.code === 'design-1')?.priceDeltaINR).toBe(750);
		expect(blouse.terms.find((term) => term.code === 'design-1')?.requiresMeasurements).toBe(true);
		const bundle = mapped.products.find((product) => product.slug === 'wedding-saree-complete-set')!;
		expect(bundle.optionGroups.map((group) => group.semanticRole)).toContain('bundle_component_option');
		const variable = mapped.products.filter((product) => product.type === 'variable');
		expect(
			variable.every((product) => product.optionGroups.some((group) => group.semanticRole === 'variation_axis')),
		).toBe(true);
		const codes = new Set(mapped.attributeDefinitions.map((definition) => definition.code));
		expect(groups.every((group) => codes.has(group.attributeCode))).toBe(true);
	});

	it('keeps slugs and SKUs unique', () => {
		expect(new Set(mapped.products.map((product) => product.slug)).size).toBe(mapped.products.length);
		expect(new Set(mapped.products.map((product) => product.sku)).size).toBe(mapped.products.length);
		expect(new Set(mapped.variants.map((variant) => variant.sku)).size).toBe(mapped.variants.length);
		expect(mapped.products.every((product) => Number.isInteger(product.basePriceINR))).toBe(true);
		expect(mapped.products.some((product) => product.insightBadges.length > 0)).toBe(false);
	});

	it('marks a sale wherever the demo sells below its MRP, with no separate sale switch', () => {
		const demo = read('product.json').data as Array<{ id: number; price?: number; sale_price?: number }>;
		const discounted = demo.filter((row) => row.sale_price && row.price && row.sale_price < row.price);
		expect(discounted.length).toBeGreaterThan(1);
		for (const row of discounted) {
			expect(mapped.products.find((product) => product.id === `prd_${row.id}`)?.onSale).toBe(true);
		}
		for (const variant of mapped.variants.filter((row) => row.salePriceINR !== null)) {
			expect(variant.compareAtPriceINR).toBe(variant.priceINR);
			expect(variant.salePriceINR).toBeLessThan(variant.priceINR);
		}
	});
});
