import { BadRequestException } from '@nestjs/common';
import { Product, ProductMerchandisingWrite, ProductVariant, type SeoRedirect } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { CatalogService } from '../src/catalog/catalog.service';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

type Variant = z.output<typeof ProductVariant>;
type ProductRow = z.output<typeof Product>;

function product(overrides: Partial<z.input<typeof Product>> = {}): ProductRow {
	return Product.parse({
		id: 'prd_kurti',
		type: 'variable',
		sku: 'KPS',
		title: { en: 'Kurti Palazzo Set' },
		slug: 'kurti-palazzo-set',
		basePriceINR: 2400,
		status: 'live',
		lifecycle: { liveAt: '2026-10-01T00:00:00.000Z' },
		...overrides,
	});
}

function variant(id: string, sku: string): Variant {
	return ProductVariant.parse({
		id,
		productId: 'prd_kurti',
		sku,
		status: 'live',
		optionSelections: [{ attributeCode: 'size', termCode: id }],
		optionSelectionHash: `size:${id}`,
		priceINR: 2400,
		stock: { quantity: 3 },
	});
}

function harness(start: ProductRow = product()) {
	let saved = start;
	const variants = new Map([
		['var_s', variant('var_s', 'KPS-1')],
		['var_m', variant('var_m', 'KPS-2')],
	]);
	const redirects: SeoRedirect[] = [];
	const products = {
		findById: async (id: string) => (id === saved.id ? saved : null),
		findBySlug: async (slug: string, audience?: string) => {
			if (slug === saved.slug) return saved;
			if (slug === 'live-saree') return product({ id: 'prd_live', slug: 'live-saree' });
			if (slug === 'draft-saree' && audience !== 'public')
				return product({ id: 'prd_draft', slug, status: 'draft' });
			return null;
		},
		save: async (row: ProductRow) => (saved = row),
	};
	const variantRepo = {
		listForProduct: async () => [...variants.values()],
		save: async (row: Variant) => {
			variants.set(row.id, row);
			return row;
		},
	};
	const redirectRepo = {
		save: async (row: SeoRedirect) => (redirects.push(row), row),
		findBySource: async () => null,
		list: async () => redirects,
	};
	const catalog = new CatalogService(products as never, {} as never, variantRepo as never, redirectRepo as never);
	return { catalog, variants, redirects, current: () => saved };
}

function form(overrides: Partial<ProductMerchandisingWrite> = {}): ProductMerchandisingWrite {
	return ProductMerchandisingWrite.parse({
		sku: 'KPS',
		status: 'live',
		featured: false,
		madeToOrder: false,
		estimatedDeliveryText: null,
		lowStockThreshold: null,
		pinnedBadges: [],
		hiddenBadges: [],
		addonPriceINR: null,
		shipping: { weightGrams: 450, lengthCm: null, widthCm: null, heightCm: null },
		hsnCode: '5007',
		variants: [
			{ ...row('var_s', 'KPS-1'), mrpINR: 2400, sellingINR: 2000 },
			{ ...row('var_m', 'KPS-2'), mrpINR: null, sellingINR: 2600 },
		],
		...overrides,
	});
}

function row(id: string, sku: string) {
	return {
		id,
		sku,
		quantity: 5,
		available: true,
		weightGrams: null,
		lengthCm: null,
		widthCm: null,
		heightCm: null,
		barcode: null,
		hsnCode: null,
	};
}

describe('admin product save', () => {
	it('writes every variant, with the MRP and the selling price it was given', async () => {
		const { catalog, variants, current } = harness();
		await catalog.updateMerchandising('prd_kurti', form());
		expect(variants.get('var_s')).toMatchObject({ priceINR: 2400, compareAtPriceINR: 2400, salePriceINR: 2000 });
		expect(variants.get('var_m')).toMatchObject({ priceINR: 2600, compareAtPriceINR: null, salePriceINR: null });
		expect(current()).toMatchObject({ basePriceINR: 2000, onSale: true, hsnCode: '5007' });
		expect(current().shippingDefaults.weightGrams).toBe(450);
	});

	it('saves the language-bound content with the form, and rows for new option values', async () => {
		const { catalog, variants, current } = harness();
		const axis = {
			attributeCode: 'color',
			label: { en: 'Colour', fr: 'Couleur' },
			semanticRole: 'variation_axis',
			displayStyle: 'rectangle',
			requiredSelection: false,
			defaultTermCode: null,
			terms: [{ code: 'red', label: { en: 'Red', fr: 'Rouge' }, isBase: false, addonTemplateIds: [], requiresMeasurements: false, sortOrder: 0 }],
		};
		await catalog.updateMerchandising('prd_kurti', {
			...form(),
			content: {
				title: { en: 'Kurti', fr: 'Kurti' },
				shortDescription: { fr: 'Court' },
				description: {},
				metaTitle: {},
				metaDescription: {},
				estimatedDeliveryText: {},
				categoryIds: ['c'],
				optionGroups: [axis],
				addonTemplateCode: null,
				imageMode: 'simple',
				gallery: [],
				compound: [],
				altOverrides: {},
			},
		} as never);
		expect(current().shortDescription).toEqual({ fr: 'Court' });
		expect([...variants.values()].some((row) => row.optionSelectionHash === 'color:red')).toBe(true);
	});

	it('rejects a selling price above the MRP before it reaches the service', () => {
		const pipe = new ZodValidationPipe(ProductMerchandisingWrite);
		const body = { ...form(), variants: [{ ...row('var_s', 'KPS-1'), mrpINR: 2000, sellingINR: 2400 }] };
		expect(() => pipe.transform(body)).toThrow(BadRequestException);
	});

	it('requires a live product and a lead time for made to order', () => {
		const pipe = new ZodValidationPipe(ProductMerchandisingWrite);
		expect(() => pipe.transform({ ...form(), madeToOrder: true })).toThrow(BadRequestException);
		expect(() =>
			pipe.transform({ ...form(), status: 'disabled', madeToOrder: true, estimatedDeliveryText: '3 weeks' }),
		).toThrow(BadRequestException);
		expect(pipe.transform({ ...form(), madeToOrder: true, estimatedDeliveryText: '3 weeks' })).toMatchObject({
			madeToOrder: true,
		});
	});

	it('keeps a published SKU and a published variant SKU', async () => {
		const { catalog } = harness();
		await expect(catalog.updateMerchandising('prd_kurti', form({ sku: 'KPS-NEW' }))).rejects.toThrow(
			'keeps its SKU',
		);
		const renamed = form();
		renamed.variants[0] = { ...renamed.variants[0]!, sku: 'KPS-9' };
		await expect(catalog.updateMerchandising('prd_kurti', renamed)).rejects.toThrow('keeps its SKU');
	});

	it('lets a never-published draft change its SKU and stamps the first publish', async () => {
		const { catalog, current } = harness(product({ status: 'draft', lifecycle: { liveAt: null } }));
		await catalog.updateMerchandising('prd_kurti', form({ sku: 'KPS-RENAMED', status: 'disabled' }));
		expect(current().sku).toBe('KPS-RENAMED');
		await expect(catalog.updateMerchandising('prd_kurti', form({ sku: 'KPS-RENAMED' }))).rejects.toThrow('Use Go Live');
	});

	it('disables without discontinuing, and refuses a variant that is not the product’s', async () => {
		const { catalog, current } = harness();
		await catalog.updateMerchandising('prd_kurti', form({ status: 'disabled' }));
		expect(current().status).toBe('disabled');
		expect(current().lifecycle.disabledAt).not.toBeNull();
		const stranger = form();
		stranger.variants[1] = { ...stranger.variants[1]!, id: 'var_other' };
		await expect(catalog.updateMerchandising('prd_kurti', stranger)).rejects.toBeInstanceOf(BadRequestException);
	});

	it('discontinues to a live replacement only', async () => {
		const { catalog, redirects, current } = harness();
		await expect(catalog.discontinue('prd_kurti', '/product/draft-saree')).rejects.toThrow('live product');
		await expect(catalog.discontinue('prd_kurti', '/product/kurti-palazzo-set')).rejects.toThrow('live product');
		await catalog.discontinue('prd_kurti', '/product/live-saree');
		expect(redirects[0]).toMatchObject({ statusCode: 301, targetPath: '/product/live-saree' });
		expect(current().replacementTarget).toEqual({ kind: 'product', path: '/product/live-saree' });
		await expect(catalog.updateMerchandising('prd_kurti', form())).rejects.toThrow('discontinued');
	});
});
