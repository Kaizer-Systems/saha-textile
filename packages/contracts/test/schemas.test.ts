import { describe, expect, it } from 'vitest';

import { Category, Currency, Customer, I18nString, Product, ProductStatus, Promotion, Slug } from '../src/index';

describe('common', () => {
	it('I18nString requires en and allows other locales', () => {
		expect(I18nString.parse({ en: 'Saree', bn: 'শাড়ি' })).toEqual({ en: 'Saree', bn: 'শাড়ি' });
		expect(I18nString.safeParse({ bn: 'শাড়ি' }).success).toBe(false);
	});

	it('Slug rejects invalid slugs', () => {
		expect(Slug.safeParse('pure-silk').success).toBe(true);
		expect(Slug.safeParse('Pure Silk').success).toBe(false);
		expect(Slug.safeParse('-leading').success).toBe(false);
	});
});

describe('Currency', () => {
	it('parses INR canonical with defaults', () => {
		const inr = Currency.parse({ code: 'INR', symbol: '₹', enabled: true, rateFromINR: 1 });
		expect(inr.paypalActive).toBe(false);
		expect(inr.paypalPct).toBe(0);
	});

	it('rejects non-positive rate', () => {
		expect(Currency.safeParse({ code: 'USD', symbol: '$', enabled: true, rateFromINR: 0 }).success).toBe(false);
	});
});

describe('Category', () => {
	it('applies taxonomy defaults', () => {
		const cat = Category.parse({
			id: 'cat_pure_silk',
			name: { en: 'Pure Silk' },
			slug: 'pure-silk',
		});
		expect(cat.parentId).toBeNull();
		expect(cat.path).toEqual([]);
		expect(cat.depth).toBe(0);
	});
});

describe('Product — variable "No Stitching → Design + Color" pattern', () => {
	const salwaar = {
		id: 'prod_5557',
		type: 'variable' as const,
		sku: 'SKU75789-1',
		title: { en: 'Salwaar 002' },
		slug: 'salwaar-002',
		basePriceINR: 1200,
		categoryIds: ['cat_dress_materials'],
		attributes: [
			{
				code: 'design',
				label: { en: 'Salwaar Designs' },
				usedForVariations: true,
				terms: [
					{ code: 'no-stitching', label: { en: 'No Stitching' }, isBase: true },
					{ code: 'design-1', label: { en: 'Salwaar Design 1' }, swatch: 'spaces://s1.webp' },
				],
			},
			{
				code: 'color',
				label: { en: 'Color' },
				usedForVariations: true,
				terms: [{ code: 'black', label: { en: 'Black' }, hex: '#000000' }],
			},
		],
		variations: [
			{
				id: 'var_1',
				attributes: { design: 'no-stitching', color: 'black' },
				priceINR: 1200,
				sku: 'SKU75789-1-NS-BLK',
				stock: 5,
			},
			{
				id: 'var_2',
				attributes: { design: 'design-1', color: 'black' },
				priceINR: 2100,
				sku: 'SKU75789-1-D1-BLK',
				stock: 3,
			},
		],
		addons: [{ code: 'shoulder', label: { en: 'Shoulder' }, type: 'number' as const, unit: 'in' }],
	};

	it('parses a full variable product', () => {
		const parsed = Product.parse(salwaar);
		expect(parsed.type).toBe('variable');
		expect(parsed.variations).toHaveLength(2);
		const base = parsed.attributes[0]?.terms.find((t) => t.isBase);
		expect(base?.code).toBe('no-stitching');
		// defaults applied
		expect(parsed.status).toBe('draft');
		expect(parsed.variations[0]?.salePriceINR).toBeNull();
	});

	it('rejects a negative base price', () => {
		expect(Product.safeParse({ ...salwaar, basePriceINR: -1 }).success).toBe(false);
	});

	it('rejects an invalid hex colour', () => {
		const bad = structuredClone(salwaar);
		bad.attributes[1]!.terms[0]!.hex = 'black';
		expect(Product.safeParse(bad).success).toBe(false);
	});

	describe('lifecycle status (owner lock)', () => {
		it('accepts exactly draft/live/disabled/discontinued', () => {
			expect(ProductStatus.options).toEqual(['draft', 'live', 'disabled', 'discontinued']);
		});

		it('rejects the superseded WooCommerce-era statuses', () => {
			for (const status of ['published', 'archived', 'hidden']) {
				expect(ProductStatus.safeParse(status).success).toBe(false);
				expect(Product.safeParse({ ...salwaar, status }).success).toBe(false);
			}
		});

		it('defaults every lifecycle timestamp to null', () => {
			expect(Product.parse(salwaar).lifecycle).toEqual({
				liveAt: null,
				disabledAt: null,
				discontinuedAt: null,
				richDataPurgedAt: null,
				statusReason: null,
			});
		});

		it('carries the discontinuation stamps a retention job needs', () => {
			const parsed = Product.parse({
				...salwaar,
				status: 'discontinued',
				lifecycle: { discontinuedAt: '2026-07-01T00:00:00.000Z', statusReason: 'supplier ended the line' },
			});
			expect(parsed.lifecycle.discontinuedAt).toBe('2026-07-01T00:00:00.000Z');
			expect(parsed.lifecycle.richDataPurgedAt).toBeNull();
		});

		it('rejects an over-long status reason', () => {
			expect(Product.safeParse({ ...salwaar, lifecycle: { statusReason: 'x'.repeat(501) } }).success).toBe(false);
		});
	});
});

describe('Promotion', () => {
	it('supports color-scoped automatic promotions', () => {
		const promo = Promotion.parse({
			id: 'promo_flash1',
			name: 'Valentine Flash',
			type: 'percentage',
			value: 25,
			scope: 'color',
			targetIds: ['red'],
			kind: 'flash_sale',
		});
		expect(promo.couponCode).toBeNull();
		expect(promo.conditions.minCartINR).toBe(0);
	});

	it('rejects an unknown scope', () => {
		expect(
			Promotion.safeParse({
				id: 'p',
				name: 'x',
				type: 'percentage',
				value: 1,
				scope: 'brand',
				kind: 'offer',
			}).success,
		).toBe(false);
	});
});

describe('Customer', () => {
	it('validates email identities and has no role', () => {
		const customer = Customer.parse({
			id: 'cus_1',
			email: 'a@example.com',
			identities: [{ provider: 'password', email: 'a@example.com' }],
		});
		expect(customer.status).toBe('active');
		expect(customer.contacts).toEqual([]);
		expect(customer.savedSizes).toEqual([]);
		expect(customer.measurementProfiles).toEqual([]);
		expect('role' in customer).toBe(false);
	});

	it('rejects malformed email and non-cus_ ids', () => {
		expect(Customer.safeParse({ id: 'cus_1', email: 'not-an-email' }).success).toBe(false);
		expect(Customer.safeParse({ id: 'user_1', email: 'a@example.com' }).success).toBe(false);
	});
});
