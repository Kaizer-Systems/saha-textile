import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { BundleBuilder } from './bundle-builder';

import type { ProductBundleWrite } from '@saha-textile/contracts';

const categories = signal<unknown>({
	data: [{ id: 'cat_1', name: 'Sarees', subcategories: [{ id: 'cat_2', name: 'Petticoats', subcategories: [] }] }],
});
vi.mock('@data-access/queries/category.queries', () => ({ injectCategoriesQuery: () => ({ data: categories }) }));
vi.mock('@data-access/queries/tag.queries', () => ({ injectTagsQuery: () => ({ data: signal({ data: [] }) }) }));

const draft = (): ProductBundleWrite =>
	({
		levels: [
			{
				code: 'l1',
				label: { en: 'Saree' },
				take: 1,
				source: { kind: 'items' },
				priceMode: 'difference',
				items: [
					{ productId: 'fabric', variantId: null, quantity: 25, priceInSetINR: null },
					{ productId: 'petti', variantId: null, quantity: 1, priceInSetINR: null },
				],
			},
		],
		extras: [],
		pricing: {
			methodId: 'bpm_fixed_price',
			params: {},
			rules: [],
			combine: 'all',
			capAtSeparately: false,
			roundTo: 'one',
		},
		saleWindow: null,
		styledPhoto: null,
		dearerReason: null,
	}) as ProductBundleWrite;

function render() {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: 'server' },
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'prd_1' }) } } },
			{ provide: BundleService, useValue: {} },
			{ provide: ProductService, useValue: {} },
			{ provide: NotificationService, useValue: {} },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(BundleBuilder, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(BundleBuilder).componentInstance;
	page.draft.set(draft());
	page.items.set(
		new Map([
			['fabric', { key: 'fabric', soldBy: 'metre', variants: [] } as never],
			['petti', { key: 'petti', soldBy: 'piece', variants: [{ id: 'v_m', label: 'M' }] } as never],
		]),
	);
	return page;
}

describe('the bundle builder’s item and level settings (brief S8, S10)', () => {
	it('keeps metres in tenths, pins a size or leaves it to the shopper', () => {
		const page = render();
		const [fabric, petti] = page.draft()!.levels[0]!.items;
		expect(page.quantityText(fabric!)).toBe('2.5');
		page.setQuantity('level', 0, 0, fabric!, '3.2');
		page.setQuantity('level', 0, 1, petti!, '2');
		page.setVariant('level', 0, 1, 'v_m');
		expect(page.draft()!.levels[0]!.items.map((row) => [row.quantity, row.variantId])).toEqual([
			[32, null],
			[2, 'v_m'],
		]);
		page.setVariant('level', 0, 1, '');
		expect(page.draft()!.levels[0]!.items[1]!.variantId).toBeNull();
		expect(page.dirty()).toBe(true);
	});

	it('fills a level from a category, listing every category with its path', () => {
		const page = render();
		expect(page.categoryChoices()).toEqual([
			{ id: 'cat_1', name: 'Sarees' },
			{ id: 'cat_2', name: 'Sarees › Petticoats' },
		]);
		page.setSource(0, 'category', 'cat_2', 8);
		expect(page.draft()!.levels[0]!.source).toEqual({ kind: 'category', categoryId: 'cat_2', limit: 8 });
		page.setSource(0, 'items');
		expect(page.draft()!.levels[0]!.source).toEqual({ kind: 'items' });
	});
});
