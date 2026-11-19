import { describe, expect, it } from 'vitest';

import { categoryChain, inheritedCharge, productExceptions } from './shipping-tab';

import type { CategoryDefaults } from './inventory-fields';
import type { ShippingException } from '@saha-textile/contracts';

const charges = (domesticINR: number | null, internationalFirstINR: number | null = null) => ({
	domesticINR,
	internationalFirstINR,
	internationalFurtherINR: null,
});

const rows = new Map<string, CategoryDefaults>([
	[
		'sarees',
		{ id: 'sarees', name: 'Sarees', hsnCode: null, returnable: true, parentId: null, shipping: charges(100, 2000) },
	],
	[
		'semi-silk',
		{ id: 'semi-silk', name: 'Semi Silk', hsnCode: null, returnable: true, parentId: 'sarees', shipping: null },
	],
	[
		'semi-crepe',
		{
			id: 'semi-crepe',
			name: 'Semi Crepe',
			hsnCode: null,
			returnable: true,
			parentId: 'semi-silk',
			shipping: charges(150),
		},
	],
]);
const shop = { domestic: 80, internationalFirst: 1500, internationalFurther: 700 };
const settings = {
	domestic: { kind: 'ruleSet' as const, ruleSetId: 'rs-dom' },
	international: { kind: 'ruleSet' as const, ruleSetId: 'rs-int' },
	abroadPolicy: 'indiaOnly' as const,
};

describe('Product › Shipping & tax (prd01)', () => {
	it('walks from the main category up through its parents', () => {
		expect(categoryChain('semi-crepe', rows)).toEqual(['semi-crepe', 'semi-silk', 'sarees']);
		expect(categoryChain(null, rows)).toEqual([]);
	});

	it('stops on a loop in the category tree', () => {
		const loop = new Map<string, CategoryDefaults>([
			['a', { id: 'a', name: 'A', hsnCode: null, returnable: true, parentId: 'b' }],
			['b', { id: 'b', name: 'B', hsnCode: null, returnable: true, parentId: 'a' }],
		]);
		expect(categoryChain('a', loop)).toEqual(['a', 'b']);
	});

	it('names the nearest category that sets a charge, else the shop default', () => {
		const chain = categoryChain('semi-crepe', rows);
		expect(inheritedCharge('domestic', chain, rows, shop)).toEqual({ amountINR: 150, fromCategory: 'Semi Crepe' });
		expect(inheritedCharge('internationalFirst', chain, rows, shop)).toEqual({
			amountINR: 2000,
			fromCategory: 'Sarees',
		});
		expect(inheritedCharge('internationalFurther', chain, rows, shop)).toEqual({
			amountINR: 700,
			fromCategory: null,
		});
	});

	it('shows no amount while the shop default is not loaded yet', () => {
		expect(inheritedCharge('internationalFurther', ['sarees'], rows, null)).toEqual({
			amountINR: null,
			fromCategory: null,
		});
	});

	it('lists the exception that decides each zone, ignoring "India only"', () => {
		const exceptions: ShippingException[] = [
			{
				id: 'ex-sarees',
				target: { kind: 'category', categoryId: 'sarees', includeSubcategories: true },
				domestic: { kind: 'siteWide' },
				international: { kind: 'cantShip' },
				note: '',
				updatedBy: null,
			},
		];
		expect(productExceptions('prd-1', categoryChain('semi-crepe', rows), settings, exceptions)).toEqual([
			{ zone: 'international', choice: { kind: 'cantShip' } },
		]);
	});

	it('lets the product’s own exception win over its category’s', () => {
		const exceptions: ShippingException[] = [
			{
				id: 'ex-cat',
				target: { kind: 'category', categoryId: 'semi-crepe', includeSubcategories: true },
				domestic: { kind: 'free' },
				international: { kind: 'siteWide' },
				note: '',
				updatedBy: null,
			},
			{
				id: 'ex-prd',
				target: { kind: 'product', productId: 'prd-1' },
				domestic: { kind: 'ruleSet', ruleSetId: 'rs-other' },
				international: { kind: 'siteWide' },
				note: '',
				updatedBy: null,
			},
		];
		expect(productExceptions('prd-1', ['semi-crepe'], settings, exceptions)).toEqual([
			{ zone: 'domestic', choice: { kind: 'ruleSet', ruleSetId: 'rs-other' } },
		]);
	});

	it('skips a parent’s exception that leaves out sub-categories', () => {
		const exceptions: ShippingException[] = [
			{
				id: 'ex-parent',
				target: { kind: 'category', categoryId: 'sarees', includeSubcategories: false },
				domestic: { kind: 'free' },
				international: { kind: 'free' },
				note: '',
				updatedBy: null,
			},
		];
		expect(productExceptions('prd-1', categoryChain('semi-crepe', rows), settings, exceptions)).toEqual([]);
		expect(productExceptions('prd-1', ['sarees'], null, exceptions)).toEqual([]);
	});
});
