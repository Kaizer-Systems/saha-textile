import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { BundleBuilder } from './bundle-builder';

import type { BundleItem, ProductBundleWrite } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ categories: undefined as unknown }));
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
			return { data: make({ data: [{ id: 't1' }] }) };
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

describe('the bundle builder: opening (A05, A08)', () => {
	it('loads the bundle, its details and the preview address', async () => {
		const { page, fixture } = setup();
		await settle();
		expect(page.draft()?.levels).toHaveLength(1);
		expect(page.details()?.categoryIds).toEqual(['c1']);
		expect(page.startTags()).toEqual(['t1']);
		expect(page.previewUrl()).toBe(`${runtimeConfig.siteUrl.replace(/\/$/, '')}/en/__preview/bundle?code=c%201`);
		expect(page.method()?.id).toBe('bpm_fixed');
		expect(page.anySale()).toBe(true);
		expect(page.errors()).toHaveLength(1);
		expect(page.photos()).toEqual([{ key: null }]);
		expect(page.categories()).toEqual([]);
		expect(page.tags()).toEqual([{ id: 't1' }]);
		expect(page.ruleWords()).toEqual([]);
		fixture.destroy();
	});

	it('starts a new bundle on the first active method, or none', async () => {
		const fresh = setup({ start: view({ bundle: null }) });
		await settle();
		expect(fresh.page.draft()?.pricing.methodId).toBe('bpm_fixed');
		const bare = setup({ start: view({ bundle: null, methods: [{ id: 'x', active: false, inputs: [] }] }) });
		await settle();
		expect(bare.page.draft()?.pricing.methodId).toBe('');
		expect(bare.page.method()).toBeNull();
	});

	it('only reads on the server, and has no product without an id', async () => {
		const server = setup({ platform: 'server' });
		await settle();
		expect(server.bundles.builder).not.toHaveBeenCalled();
		expect(server.page.editor).toBeNull();
		expect(server.page.methods()).toEqual([]);
		expect(server.page.windowDay('from')).toBe('');
		server.page.change((draft) => draft);
		expect(server.page.dirty()).toBe(false);
		await server.page.save();
		expect(server.bundles.details).not.toHaveBeenCalled();
		server.page.setDetail('featured', true);
		expect(server.page.dirty()).toBe(true);
		server.page.setFaq({ enabled: true, rows: [] });
		expect(server.page.faqValue()).toEqual({ enabled: false, rows: [] });
		server.page.setText('title', 'x');
		server.page.setText('title', '');
		server.page.setSeo('title', 'x');
		server.page.setLevelName(0, 'x');
		expect(setup({ platform: 'server', id: null }).page.productId).toBe('');
	});

	it('sends the set to the shop’s frame once the frame says it is ready, and only from the shop', async () => {
		const { page } = setup();
		await settle();
		const posted: unknown[] = [];
		const frameWindow = { postMessage: (message: unknown) => posted.push(message) };
		Object.defineProperty(page, 'frame', { value: () => ({ nativeElement: { contentWindow: frameWindow } }) });
		const origin = new URL(runtimeConfig.siteUrl).origin;
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'st-bundle-preview-ready' },
				origin: 'https://elsewhere.test',
			}),
		);
		window.dispatchEvent(new MessageEvent('message', { data: null, origin }));
		expect(posted).toEqual([]);
		window.dispatchEvent(new MessageEvent('message', { data: { type: 'st-bundle-preview-ready' }, origin }));
		expect(posted).toEqual([{ type: 'st-bundle-preview', name: 'Wedding set', bundle: { key: 'page' } }]);
		page.details.set(null);
		page.setLevel(0, { take: 1 });
		await vi.advanceTimersByTimeAsync(300);
		expect(posted.at(-1)).toEqual({ type: 'st-bundle-preview', name: '', bundle: { key: 'draft' } });
		Object.defineProperty(page, 'frame', { value: () => undefined });
		page.setLevel(0, { take: 2 });
		await vi.advanceTimersByTimeAsync(300);
		expect(posted).toHaveLength(2);
	});
});

describe('the bundle builder: levels, items and prices (S8–S10, C01–C06)', () => {
	async function ready() {
		const made = setup();
		await settle();
		return made;
	}

	it('works the set out again a moment after each change, waiting for a chosen category', async () => {
		const { page, bundles } = await ready();
		page.setPricing({ roundTo: 'ten' } as never);
		page.setPricing({ combine: 'best' } as never);
		await vi.advanceTimersByTimeAsync(300);
		expect(bundles.draft).toHaveBeenCalledTimes(1);
		page.setSource(0, 'category');
		await vi.advanceTimersByTimeAsync(300);
		expect(bundles.draft).toHaveBeenCalledTimes(1);
		expect(page.draft()?.levels[0]?.source).toEqual({ kind: 'category', categoryId: '', limit: 12 });
		bundles.draft.mockReturnValueOnce(throwError(() => new Error('half made')));
		page.setSource(0, 'items');
		await vi.advanceTimersByTimeAsync(300);
		expect(bundles.draft).toHaveBeenCalledTimes(2);
		page.change(page.draftCap(true));
		page.change(page.draftReason('  Handpicked  '));
		expect(page.draft()?.pricing.capAtSeparately).toBe(true);
		expect(page.draft()?.dearerReason).toBe('Handpicked');
		page.change(page.draftReason('  '));
		expect(page.draft()?.dearerReason).toBeNull();
	});

	it('changes the method with its defaults, and its numbers', async () => {
		const { page } = await ready();
		page.setMethod('bpm_off');
		expect(page.draft()?.pricing).toMatchObject({ methodId: 'bpm_off', params: { percent: 10 } });
		page.setParam('percent', '15');
		page.setParam('percent', '');
		page.setParam('floor', 'abc');
		expect(page.draft()?.pricing.params).toEqual({ percent: 15 });
		page.setMethod('gone');
		expect(page.draft()?.pricing.params).toEqual({});
	});

	it('adds, names and removes levels, and prices, sizes and removes items', async () => {
		const { page } = await ready();
		page.addLevel();
		expect(page.draft()?.levels[1]?.label).toEqual({ en: 'Level 2', bn: 'ধাপ 2' });
		page.lang.set('bn');
		page.setLevelName(0, 'শাড়ি');
		expect(page.draft()?.levels[0]?.label).toEqual({ en: 'Saree', bn: 'শাড়ি' });
		page.setLevelName(9, 'x');
		page.removeLevel(1);
		page.setPrice('level', 0, 0, '1200.6');
		page.setPrice('level', 0, 1, ' ');
		page.setPrice('extra', 0, 0, '-5');
		expect(page.draft()?.levels[0]?.items.map((row) => row.priceInSetINR)).toEqual([1201, null]);
		expect(page.draft()?.extras[0]?.priceInSetINR).toBe(0);
		page.setItem('extra', 0, 0, { quantity: 2 });
		expect(page.draft()?.extras[0]?.quantity).toBe(2);
		const cotton = page.draft()?.levels[0]?.items[1] as BundleItem;
		expect(page.keyOf(cotton)).toBe('cotton:v_r');
		expect(page.quantityText(cotton)).toBe('0.1');
		page.setQuantity('extra', 0, 0, item('pin'), '0');
		page.setQuantity('extra', 0, 0, item('pin'), 'x');
		page.setQuantity('extra', 0, 0, item('pin'), '3');
		expect(page.draft()?.extras[0]?.quantity).toBe(3);
		page.setVariant('extra', 0, 0, 'v_b');
		expect(page.draft()?.extras[0]?.variantId).toBe('v_b');
		page.removeItem('level', 0, 1);
		expect(page.draft()?.levels[0]).toMatchObject({ take: 1 });
		page.removeItem('extra', 0, 0);
		expect(page.draft()?.extras).toEqual([]);
		page.addLevel();
		page.setLevel(1, { take: 3 });
		page.removeItem('level', 1, 0);
		expect(page.draft()?.levels[1]?.take).toBe(1);
	});

	it('finds products to add, never bundles or itself, and adds each once', async () => {
		h.categories = { data: [{ id: 'c1', name: 'Sarees', subcategories: [{ id: 'c2', name: 'Silk' }] }] };
		const { page } = await ready();
		expect(page.categoryChoices()).toEqual([
			{ id: 'c1', name: 'Sarees' },
			{ id: 'c2', name: 'Sarees › Silk' },
		]);
		await page.find(' s ');
		expect(page.results()).toEqual([]);
		await page.find('silk');
		expect(page.results().map((row) => row.id)).toEqual(['p2']);
		page.addingTo.set('extras');
		page.add({ id: 'p2' } as never);
		page.addingTo.set('extras');
		page.add({ id: 'p2' } as never);
		expect(page.draft()?.extras.map((row) => row.productId)).toEqual(['pin', 'p2']);
		page.addingTo.set('l1');
		page.add({ id: 'p2' } as never);
		page.addingTo.set('l1');
		page.add({ id: 'p2' } as never);
		page.addingTo.set('l1');
		page.add({ id: 'silk' } as never);
		expect(page.draft()?.levels[0]?.items.map((row) => row.productId)).toEqual(['silk', 'cotton', 'p2']);
		expect(page.addingTo()).toBeNull();
	});
});

describe('the bundle builder: details, sale window, checks and saving (A05, A07)', () => {
	async function ready() {
		const made = setup();
		await settle();
		return made;
	}

	it('changes the words, SEO, FAQ, categories and tags, marking only real changes', async () => {
		const { page } = await ready();
		page.setText('title', 'Wedding set');
		expect(page.dirty()).toBe(false);
		page.setText('title', 'Bridal set');
		expect(page.details()?.title).toEqual({ en: 'Bridal set', bn: 'বিয়ের সেট' });
		page.lang.set('bn');
		page.setText('shortDescription', 'ছোট');
		expect(page.details()?.shortDescription).toEqual({ en: '', bn: 'ছোট' });
		page.setSeo('description', 'বিবরণ');
		expect(page.details()?.seo.description).toEqual({ en: '', bn: 'বিবরণ' });
		page.setFaq({ enabled: true, rows: [{ question: { en: 'Q' }, answer: { en: 'A' } }] as never });
		expect(page.faqValue().enabled).toBe(true);
		page.setCategories('c1');
		page.setCategories(['c1']);
		page.setCategories(['c2', 3]);
		page.setTags(null);
		page.setTags(['t1']);
		page.setTags(['t2']);
		await settle();
		expect(page.details()?.categoryIds).toEqual(['c2', '3']);
		expect(page.details()?.tags).toEqual(['t2']);
		page.details.set(null);
		page.setCategories(['c9']);
		page.setTags(['t9']);
		await settle();
		expect(page.details()).toBeNull();
	});

	it('keeps a sale window in India time, and drops it when both days are cleared', async () => {
		const { page } = await ready();
		page.setWindow('from', '2026-12-01');
		expect(page.windowDay('from')).toBe('2026-11-30');
		expect(page.draft()?.saleWindow?.from).toBe('2026-11-30T18:30:00.000Z');
		page.setWindow('to', '2026-12-10');
		expect(page.draft()?.saleWindow?.to).toBe('2026-12-10T18:29:59.000Z');
		page.setWindow('from', '');
		expect(page.windowDay('from')).toBe('');
		page.setWindow('to', '');
		expect(page.draft()?.saleWindow).toBeNull();
	});

	it('names where a photo comes from, and words each check', async () => {
		const { page } = await ready();
		expect(page.photoFrom(null)).toBe('bundle_styled_photo');
		expect(page.photoFrom('silk')).toBe('Silk');
		expect(page.photoFrom('gone')).toBe('gone');
		expect(page.checkText({ code: 'level_short', level: 'l1', key: null } as never)).toBe(
			'bundle_check_level_short(Saree||||)',
		);
		expect(
			page.checkText({
				code: 'dearer',
				level: null,
				key: 'silk',
				input: 'x',
				totalINR: 900,
				separatelyINR: 800,
			} as never),
		).toBe('bundle_check_dearer(|Silk|x|900|800)');
		expect(page.checkText({ code: 'x', level: 'gone', key: 'nobody' } as never)).toBe(
			'bundle_check_x(gone|nobody|||)',
		);
		page.lang.set('bn');
		expect(page.checkText({ code: 'x', level: 'l1' } as never)).toContain('Saree');
		page.pickStyled(null);
		expect(page.draft()?.styledPhoto).toBeNull();
		page.pickStyled({ id: 'med_1' } as never);
		expect(page.draft()?.styledPhoto).toEqual({ assetId: 'med_1', versionId: null });
	});

	it('saves the details and the set, says when it could not, and goes live or lists the gaps', async () => {
		const { page, bundles, products, notifier } = await ready();
		await page.save();
		expect(bundles.details).toHaveBeenCalled();
		expect(bundles.build).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('bundle_saved');
		expect(page.dirty()).toBe(false);
		bundles.build.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.save();
		expect(notifier.showError).toHaveBeenCalledWith('bundle_not_saved');
		await page.goLive();
		expect(notifier.showSuccess).toHaveBeenCalledWith('bundle_live');
		await settle();
		expect(bundles.builder).toHaveBeenCalledTimes(2);
		products.goLive.mockReturnValueOnce(of({ live: false, gaps: [{}, {}] }));
		await page.goLive();
		expect(notifier.showError).toHaveBeenCalledWith('bundle_go_live_gaps(2)');
		page.details.set(null);
		await page.save();
		expect(bundles.details).toHaveBeenCalledTimes(4);
	});
});
