import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { BundleBuilder } from './bundle-builder';

import type { BundleItem, BundlePriceRule, ProductBundleWrite } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ categories: undefined as unknown, tags: undefined as unknown }));
vi.mock('@data-access/queries/category.queries', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		injectCategoriesQuery: (params: () => unknown) => {
			params();
			return { data: make(h.categories) };
		},
	};
});
vi.mock('@data-access/queries/tag.queries', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		injectTagsQuery: (params: () => unknown) => {
			params();
			return { data: make(h.tags) };
		},
	};
});

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const item = (productId: string, over: Partial<BundleItem> = {}): BundleItem => ({
	productId,
	variantId: null,
	quantity: 1,
	priceInSetINR: null,
	...over,
});

const product = {
	title: { en: 'Wedding set', bn: 'বিয়ের সেট' },
	shortDescription: { en: '' },
	description: { en: '<p>Set</p>' },
	categoryIds: ['c1'],
	tags: ['t1'],
	seo: { title: { en: '' }, description: { en: '' } },
	faqEnabled: false,
	faq: [],
	featured: false,
	showOnShop: true,
	lowStockThreshold: 2,
};
const bundle: ProductBundleWrite = {
	levels: [
		{
			code: 'l1',
			label: { en: 'Saree' },
			take: 2,
			source: { kind: 'items' },
			priceMode: 'difference',
			items: [item('silk'), item('cotton', { variantId: 'v_r' })],
		},
	],
	extras: [item('pin')],
	pricing: { methodId: 'bpm_fixed', params: {}, rules: [], combine: 'all', capAtSeparately: false, roundTo: 'one' },
	saleWindow: null,
	styledPhoto: null,
	dearerReason: null,
} as unknown as ProductBundleWrite;

const view = (over: Record<string, unknown> = {}) => ({
	product,
	bundle,
	methods: [
		{
			id: 'bpm_off',
			active: false,
			inputs: [
				{ code: 'percent', default: 10 },
				{ code: 'floor', default: null },
			],
		},
		{ id: 'bpm_fixed', active: true, inputs: [] },
	],
	items: [
		{ key: 'silk', title: 'Silk', soldBy: 'piece', saleINR: null, variants: [] },
		{ key: 'cotton:v_r', title: 'Cotton red', soldBy: 'metre', saleINR: 900, variants: [] },
	],
	checks: [
		{ severity: 'error', code: 'level_short', level: 'l1', key: null },
		{
			severity: 'warning',
			code: 'dearer',
			level: null,
			key: 'silk',
			input: 'x',
			totalINR: 900,
			separatelyINR: 800,
		},
	],
	page: { key: 'page' },
	photos: [{ key: null }],
	...over,
});

function setup(options: { platform?: string; start?: unknown; id?: string | null } = {}) {
	const bundles = {
		builder: vi.fn(() => of(options.start ?? view())),
		previewCode: vi.fn(() => of({ code: 'c 1' })),
		draft: vi.fn((_id: string, _draft: unknown) => of({ items: [], checks: [], page: { key: 'draft' } })),
		details: vi.fn((_id: string, _details: unknown) => of({})),
		build: vi.fn((_id: string, _draft: unknown) => of({ items: [], checks: [], page: { key: 'built' } })),
	};
	const products = {
		getCatalogProducts: vi.fn(() =>
			of({
				items: [
					{ id: 'p2', type: 'simple' },
					{ id: 'b9', type: 'bundle' },
					{ id: 'prd_1', type: 'simple' },
				],
			}),
		),
		goLive: vi.fn(() => of({ live: true, gaps: [] })),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: { paramMap: convertToParamMap(options.id === null ? {} : { id: options.id ?? 'prd_1' }) },
				},
			},
			{ provide: BundleService, useValue: bundles },
			{ provide: ProductService, useValue: products },
			{ provide: NotificationService, useValue: notifier },
			{ provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (url: string) => url } },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => '' } },
		],
	});
	TestBed.overrideComponent(BundleBuilder, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BundleBuilder);
	return { fixture, page: fixture.componentInstance, bundles, products, notifier };
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
	vi.useFakeTimers();
	h.categories = undefined;
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const twoOfEach = {
	...bundle,
	levels: [bundle.levels[0], { ...bundle.levels[0], code: 'l2', items: [item('linen'), item('khadi')] }],
	extras: [item('pin'), item('box')],
} as unknown as ProductBundleWrite;

const rule = {
	id: 'r1',
	name: null,
	enabled: true,
	when: { match: 'all', conditions: [] },
	then: [{ kind: 'percentOff', amount: 10, level: null, items: [] }],
	otherwise: [],
} as unknown as BundlePriceRule;

describe('the bundle builder: the last cases', () => {
	it('has no tags before they load, and words its rules with or without a method', async () => {
		const { page } = setup({
			start: view({ bundle: { ...bundle, pricing: { ...bundle.pricing, methodId: 'bpm_off', rules: [rule] } } }),
		});
		expect(page.ruleWords()).toEqual([]);
		await settle();
		expect(page.tags()).toEqual([]);
		expect(page.ruleWords()).toEqual(['bundle_rule_always: bundle_action_percentOff 10%']);
		const none = setup({
			start: view({ bundle: { ...bundle, pricing: { ...bundle.pricing, methodId: 'gone', rules: [rule] } } }),
		});
		await settle();
		expect(none.page.method()).toBeNull();
		expect(none.page.ruleWords()).toEqual(['bundle_rule_always: bundle_action_percentOff 10%']);
	});

	it('works nothing out before the bundle loads', async () => {
		const { page, bundles } = setup({ start: view({ bundle: null, methods: [] }) });
		await (page as unknown as { refresh(): Promise<void> }).refresh();
		expect(bundles.draft).not.toHaveBeenCalled();
	});

	it('changes one item’s price and settings, leaving the other levels and extras as they were', async () => {
		const { page } = setup({ start: view({ bundle: twoOfEach }) });
		await settle();
		const [firstLevel] = page.draft()?.levels ?? [];
		const [firstExtra] = page.draft()?.extras ?? [];
		page.setPrice('level', 1, 0, '500');
		page.setPrice('extra', 0, 1, '20');
		page.setItem('level', 1, 1, { quantity: 2 });
		page.setItem('extra', 0, 1, { quantity: 3 });
		const draft = page.draft();
		expect(draft?.levels[0]).toEqual(firstLevel);
		expect(draft?.levels[1]?.items[0]?.priceInSetINR).toBe(500);
		expect(draft?.levels[1]?.items[1]?.quantity).toBe(2);
		expect(draft?.extras[0]).toEqual(firstExtra);
		expect(draft?.extras[1]).toMatchObject({ priceInSetINR: 20, quantity: 3 });
		expect(page.quantityText(item('silk', { quantity: 2 }))).toBe('2');
	});
});
