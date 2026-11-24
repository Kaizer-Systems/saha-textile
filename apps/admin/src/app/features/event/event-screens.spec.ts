import { PLATFORM_ID, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';
import { ShopEventService } from '@data-access/services/shop-event.service';

import { EditEvent } from './edit-event';
import { Events, istLabel } from './events';
import { FormEvent } from './form-event/form-event';

import type { SaleCategoryLine, ShopEvent, ShopEventProblem, ShopEventReview } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	categories: undefined as unknown,
	page: undefined as unknown,
	missing: null as string | null,
}));
vi.mock('@data-access/queries/category.queries', async () => {
	const { signal } = await import('@angular/core');
	return {
		injectCategoriesQuery: (params: () => unknown) => {
			params();
			return { data: signal(h.categories) };
		},
	};
});
vi.mock('@data-access/queries/shop-event.queries', async () => {
	const { signal } = await import('@angular/core');
	return {
		injectShopEventsQuery: (params: () => unknown) => {
			params();
			return { data: signal(h.page) };
		},
	};
});
vi.mock('@core/i18n/missing-language', () => ({ injectMissingLanguage: () => ({ code: () => h.missing }) }));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function shopEvent(over: Partial<ShopEvent> = {}): ShopEvent {
	return {
		id: 'evt_1',
		type: 'sale',
		name: 'Puja sale',
		status: 'draft',
		title: { en: 'Puja', bn: 'পুজো' },
		message: { en: '<p>Hi</p>', bn: '<p>নমস্কার</p>' },
		startsAt: '2026-12-01T04:30:00.000Z',
		endsAt: '2026-12-10T18:29:00.000Z',
		linkHref: '/offer',
		showCountdown: true,
		showPopup: true,
		popupImageSide: 'right',
		popupAssetIds: [],
		imageVersions: {},
		nowLiveDays: 3,
		launch: { categoryIds: [], productIds: [], heldProductIds: [] },
		sale: { categories: [], products: [], includeSets: false },
		...over,
	} as unknown as ShopEvent;
}

const review = (over: Partial<ShopEventReview> = {}): ShopEventReview =>
	({
		problems: [],
		items: [{ productId: 'p1', title: 'Silk', sku: 'S-1' }],
		prices: [{ productId: 'p2', productTitle: 'Cotton' }],
		recipients: 120,
		...over,
	}) as unknown as ShopEventReview;

function setup(params: Record<string, string> = { id: 'evt_1' }, start = shopEvent(), platform = 'browser') {
	const events = {
		get: vi.fn(() => of(start)),
		review: vi.fn(() => of(review())),
		create: vi.fn((_type: string, _body: unknown) => of(shopEvent({ id: 'evt_new' }))),
		save: vi.fn((_id: string, _body: unknown) => of(start)),
		publish: vi.fn(() => of({ published: true, event: start, problems: [] })),
		unpublish: vi.fn(() => of(start)),
		cancel: vi.fn(() => of(start)),
		endNow: vi.fn(() => of(start)),
		previewLink: vi.fn(() => of({ token: 'tok' })),
		sendTest: vi.fn(() => of({ sent: true })),
		categoryProducts: vi.fn(() => of({ categoryId: 'cat_1', products: [] })),
		remove: vi.fn(() => of({})),
	};
	const products = {
		getCatalogProducts: vi.fn(() =>
			of({
				items: [
					{ id: 'p1', title: 'Silk', sku: 'S-1', slug: 'silk', status: 'live' },
					{ id: 'p3', title: 'Linen', sku: 'L-1', slug: 'linen', status: 'draft' },
				],
			}),
		),
	};
	const media = {
		get: vi.fn((id: string) => (id === 'gone' ? throwError(() => new Error('gone')) : of({ id, name: id }))),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigateByUrl: vi.fn() };
	const modalResult = { result: Promise.reject(new Error('closed')) };
	modalResult.result.catch(() => undefined);
	const modal = { open: vi.fn(() => modalResult) };
	const route = new BehaviorSubject<Record<string, string>>(params);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: { params: route } },
			{ provide: Router, useValue: router },
			{ provide: ShopEventService, useValue: events },
			{ provide: ProductService, useValue: products },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: t, selectTranslation: () => of({}) } },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn(async () => undefined) } },
			{ provide: NgbModal, useValue: modal },
			{ provide: MediaGateway, useValue: media },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(FormEvent, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FormEvent);
	const c = fixture.componentInstance;
	const confirm = { openModal: vi.fn(async () => undefined) };
	const template = {};
	Object.defineProperty(c, 'confirm', { value: () => confirm });
	Object.defineProperty(c, 'exceptionsModal', { value: () => template });
	c.ngOnInit();
	return { c, fixture, events, products, media, notifier, router, modal, confirm, route, template };
}

const line = (over: Partial<SaleCategoryLine> = {}): SaleCategoryLine => ({
	categoryId: 'cat_1',
	rule: { kind: 'percent', value: 10, skuPrices: {} },
	exceptions: [],
	...over,
});

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	h.categories = undefined;
	h.page = undefined;
	h.missing = null;
});

describe('the event form: loading (owner brief 2026-11-08)', () => {
	it('loads a saved sale with its pictures, link and review, and names its items', async () => {
		h.categories = {
			data: [{ id: 1, name: 'Sarees', slug: 'sarees', subcategories: [{ id: 2, name: 'Silk', slug: 'silk' }] }],
		};
		const { c, media, events } = setup(
			{ id: 'evt_1' },
			shopEvent({
				linkHref: '/product/silk-saree',
				popupAssetIds: ['a1', 'gone', 'a2'],
				imageVersions: { a2: 'v2' },
				sale: { categories: [line()], products: [], includeSets: true } as never,
			}),
		);
		await vi.advanceTimersByTimeAsync(350);
		expect(media.get).toHaveBeenCalledTimes(3);
		expect(c.popupImages()).toEqual([
			{ id: 'a1', name: 'a1' },
			{ id: 'a2', name: 'a2', versionId: 'v2' },
		]);
		expect(c.linkKind()).toBe('product');
		expect(c.productLinks()[0]).toEqual({ value: '/product/silk-saree', label: '/product/silk-saree' });
		expect(c.saleIncludeSets()).toBe(true);
		expect(events.review).toHaveBeenCalledWith('evt_1');
		expect(c.productName('p1')).toBe('Silk · S-1');
		expect(c.productName('p2')).toBe('Cotton');
		expect(c.productName('p9')).toBe('p9');
		expect(c.categoryName('2')).toBe('Silk');
		expect(c.categoryName('9')).toBe('9');
		expect(c.categoryLinks()).toEqual([
			{ value: '/collections/sarees', label: 'Sarees' },
			{ value: '/collections/sarees/silk', label: 'Sarees › Silk' },
		]);
		expect(c.pageLinks()).toHaveLength(7);
		expect(c.linkKindOptions()).toHaveLength(4);
		expect(c.status()).toBe('draft');
		expect(c.editable()).toBe(true);
		expect(c.readOnly()).toBe(false);
		c.ngOnDestroy();
	});

	it('starts a new launch, and keeps the link listed when a search does not find it', async () => {
		const { c, events } = setup({ type: 'launch' });
		await vi.advanceTimersByTimeAsync(350);
		expect(events.get).not.toHaveBeenCalled();
		expect(c.type()).toBe('launch');
		expect(c.event()).toBeNull();
		// A launch offers only products not yet live.
		expect(c.productOptions().map((row) => (row as { value: string }).value)).toEqual(['p3']);
		c.form.controls.link_href.setValue('/product/old-one');
		c.searchProduct({ search: 'si' } as never);
		await vi.advanceTimersByTimeAsync(350);
		expect(c.productLinks()[0]).toEqual({ value: '/product/old-one', label: '/product/old-one' });
		c.form.controls.link_href.setValue('/product/silk');
		c.searchProduct({ search: 'silk' } as never);
		await vi.advanceTimersByTimeAsync(350);
		expect(c.productLinks().map((row) => (row as { value: string }).value)).toEqual([
			'/product/silk',
			'/product/linen',
		]);
		const typed = setup({ type: 'other' }, shopEvent(), 'server');
		expect(typed.c.type()).toBe('sale');
		expect(typed.c.editor).toBeNull();
		typed.c.ngOnDestroy();
	});

	it('reads every kind of saved link, and keeps a product link already listed', () => {
		const kinds = [
			[null, 'page'],
			['/faq', 'page'],
			['/collections/sarees', 'category'],
			['https://example.test/x', 'path'],
		] as const;
		for (const [href, kind] of kinds) {
			const { c } = setup({ id: 'evt_1' }, shopEvent({ linkHref: href }));
			expect(c.linkKind()).toBe(kind);
		}
		const { c, route } = setup({ id: 'evt_1' }, shopEvent({ linkHref: '/product/silk' }));
		c.productLinks.set([{ value: '/product/silk', label: 'Silk' }]);
		route.next({ id: 'evt_1' });
		expect(c.productLinks()).toEqual([{ value: '/product/silk', label: 'Silk' }]);
	});

	it('locks an event that has ended, and leaves a running sale’s end and rules open', () => {
		const ended = setup({ id: 'evt_1' }, shopEvent({ status: 'ended' } as never));
		expect(ended.c.readOnly()).toBe(true);
		expect(ended.c.form.disabled).toBe(true);
		ended.c.submit();
		expect(ended.events.save).not.toHaveBeenCalled();
		const running = setup({ id: 'evt_1' }, shopEvent({ status: 'live' } as never));
		expect(running.c.runningSale()).toBe(true);
		expect(running.c.readOnly()).toBe(false);
	});
});

describe('the event form: pickers, rules and exceptions', () => {
	it('picks the link, popup pictures and launch items', () => {
		const { c } = setup({ type: 'launch' });
		c.pickLinkKind({ value: 'nope' } as never);
		c.pickLinkKind({ value: null } as never);
		c.pickLinkKind({ value: 'page' } as never);
		expect(c.linkKind()).toBe('page');
		c.form.controls.link_href.setValue('/typed');
		c.pickLinkKind({ value: 'path' } as never);
		expect(c.form.controls.link_href.value).toBe('/typed');
		c.pickLinkKind({ value: 'category' } as never);
		expect(c.form.controls.link_href.value).toBe('');
		c.pickLink({ value: '/collections/sarees' } as never);
		expect(c.form.controls.link_href.value).toBe('/collections/sarees');
		c.pickLink({ value: ['x'] } as never);
		expect(c.form.controls.link_href.value).toBe('');
		const pictures = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}` }));
		c.selectPopupImages(pictures as never);
		expect(c.popupImages()).toHaveLength(5);
		c.selectPopupImages({ id: 'one' } as never);
		expect(c.popupImages()).toEqual([{ id: 'one' }]);
		c.selectPopupImages(null);
		expect(c.popupImages()).toEqual([]);
		c.pickLaunchCategories(['1', '2']);
		c.pickLaunchCategories(['2', '1']);
		c.pickLaunchCategories('x' as never);
		expect(c.launchCategoryIds()).toEqual(['1', '2']);
		c.pickLaunchProducts({ value: ['p1', 3] } as never);
		expect(c.launchProductIds()).toEqual(['p1', '3']);
		c.pickLaunchProducts({ value: 'p1' } as never);
		expect(c.launchProductIds()).toEqual([]);
		c.toggleHeld('p1', true);
		expect(c.isHeld('p1')).toBe(true);
		c.toggleHeld('p1', false);
		expect(c.isHeld('p1')).toBe(false);
		expect(c.istText('')).toBe('');
		expect(c.istText('2026-12-01T10:00')).toBe('1 Dec 2026, 10:00 IST');
	});

	it('adds and removes sale lines, and edits their rules and colour prices', () => {
		const { c } = setup({ type: 'sale' });
		c.pickSaleCategories(['cat_1', 'cat_2']);
		expect(c.saleCategoryIds()).toEqual(['cat_1', 'cat_2']);
		c.pickSaleCategories(['cat_2', 'cat_1']);
		c.pickSaleCategories('x' as never);
		c.pickSaleCategories(['cat_2', 'cat_3']);
		expect(c.saleCategoryIds()).toEqual(['cat_2', 'cat_3']);
		c.setCategoryRule('cat_2', { kind: 'amount', value: 500 });
		expect(c.saleCategories()[0]?.rule).toMatchObject({ kind: 'amount', value: 500 });
		c.removeCategoryLine('cat_3');
		expect(c.saleCategoryIds()).toEqual(['cat_2']);
		expect(c.exceptionCount(line({ exceptions: [{ productId: 'p', mode: 'held', rule: null }] }))).toBe(1);
		c.pickSaleProducts({ value: ['p1', 'p2'] } as never);
		c.pickSaleProducts({ value: ['p2', 'p3'] } as never);
		expect(c.saleProductIds()).toEqual(['p2', 'p3']);
		c.pickSaleProducts({ value: null } as never);
		expect(c.saleProductIds()).toEqual([]);
		c.pickSaleProducts({ value: ['p1', 'p2'] } as never);
		c.setProductRule('p1', { kind: 'fixed', value: 900, skuPrices: { 'S-RED': 800 } });
		expect(c.skuPrices(c.saleProducts()[0] as never)).toEqual([{ sku: 'S-RED', price: 800 }]);
		c.setProductSkuPrice('p1', 'S-BLUE', 850);
		expect(c.saleProducts()[0]?.rule.skuPrices).toEqual({ 'S-RED': 800, 'S-BLUE': 850 });
		c.setProductRule('p1', { kind: 'percent' });
		expect(c.saleProducts()[0]?.rule.skuPrices).toEqual({});
		expect(c.skuPrices(c.saleProducts()[0] as never)).toEqual([]);
		c.removeProductLine('p2');
		expect(c.saleProductIds()).toEqual(['p1']);
		expect(c.ruleKind('amount')).toBe('amount');
		expect(c.ruleKind('fixed')).toBe('fixed');
		expect(c.ruleKind('other')).toBe('percent');
	});

	it('edits a category’s exceptions in the popup and keeps them on Save', () => {
		const { c, modal, template } = setup({ type: 'sale' });
		c.saveExceptions();
		c.toggleInSale('p1', false);
		expect(c.exceptionsFor()).toBeNull();
		c.saleCategories.set([line(), line({ categoryId: 'cat_2' })]);
		c.openExceptions(line());
		expect(modal.open).toHaveBeenCalledWith(template, expect.objectContaining({ size: 'lg' }));
		expect(c.exception('p1')).toBeNull();
		c.toggleInSale('p1', false);
		expect(c.exception('p1')).toEqual({ productId: 'p1', mode: 'held', rule: null });
		c.setExceptionRule('p1', { value: 5 });
		c.setSkuPrice('p1', 'S', '100');
		c.toggleInSale('p1', true);
		expect(c.exception('p1')).toBeNull();
		c.setExceptionMode('p2', 'category');
		expect(c.exception('p2')).toBeNull();
		c.pickExceptionRule('p2', 'fixed');
		expect(c.exception('p2')?.rule).toMatchObject({ kind: 'fixed', value: 10 });
		c.setExceptionMode('p2', 'own');
		expect(c.exception('p2')?.rule?.kind).toBe('fixed');
		c.setSkuPrice('p2', 'S-RED', '750.9');
		c.setSkuPrice('p2', 'S-BLUE', '700');
		c.setSkuPrice('p2', 'S-BLUE', '');
		c.setSkuPrice('p2', 'S-GREEN', 'abc');
		expect(c.exception('p2')?.rule?.skuPrices).toEqual({ 'S-RED': 750 });
		c.pickExceptionRule('p2', 'category');
		expect(c.exception('p2')).toBeNull();
		c.pickExceptionRule('p3', 'amount');
		c.saveExceptions();
		expect(c.saleCategories()[0]?.exceptions).toEqual([
			{ productId: 'p3', mode: 'own', rule: { kind: 'amount', value: 10, skuPrices: {} } },
		]);
		expect(c.saleCategories()[1]?.exceptions).toEqual([]);
		c.exceptionsFor.update((state) =>
			state
				? { ...state, line: { ...state.line, exceptions: [{ productId: 'p4', mode: 'own', rule: null }] } }
				: state,
		);
		c.setExceptionRule('p4', { value: 1 });
		c.setSkuPrice('p4', 'S', '1');
		expect(c.exception('p4')).toEqual({ productId: 'p4', mode: 'own', rule: null });
	});
});

describe('the event form: languages, saving and publishing', () => {
	it('switches the language, lists the gaps and opens a missing field', () => {
		const { c } = setup({ type: 'sale' });
		expect(Object.keys(c.gaps())).toEqual(expect.arrayContaining(['en', 'bn']));
		c.switchLanguage('bn');
		expect(c.fields.locale()).toBe('bn');
		c.openLanguageGap({ key: 'title', locale: 'en' });
		expect(c.fields.locale()).toBe('en');
	});

	it('asks for a name, creates a new event and saves a known one', () => {
		const created = setup({ type: 'launch' });
		created.c.submit();
		expect(created.c.form.controls.name.errors).toEqual({ required: true });
		expect(created.c.active).toBe('general');
		created.c.form.patchValue({
			name: '  Diwali launch  ',
			starts_at: '2026-12-01T10:00',
			ends_at: '2026-12-02T10:00',
			link_href: '  ',
		});
		created.c.form.controls.now_live_days.setValue('' as never);
		created.c.popupImages.set([{ id: 'a1', versionId: 'v1' }, { id: 'a2' }] as never);
		created.c.submit();
		const body = created.events.create.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(created.events.create.mock.calls[0]?.[0]).toBe('launch');
		expect(body).toMatchObject({
			name: 'Diwali launch',
			endsAt: null,
			linkHref: null,
			nowLiveDays: 0,
			popupAssetIds: ['a1', 'a2'],
			imageVersions: { a1: 'v1' },
		});
		expect(body['startsAt']).toBe('2026-12-01T04:30:00.000Z');
		expect(created.router.navigateByUrl).toHaveBeenCalledWith('/event/edit/evt_new');
		const saved = setup();
		saved.c.form.patchValue({ starts_at: '', ends_at: '2026-12-02T10:00' });
		saved.c.submit();
		expect(saved.events.save.mock.calls[0]?.[1]).toMatchObject({
			startsAt: null,
			endsAt: '2026-12-02T04:30:00.000Z',
		});
		expect(saved.notifier.showSuccess).toHaveBeenCalledWith('saved');
	});

	it('lists the refusal’s problems on Review, in words', () => {
		const { c, events, notifier } = setup();
		events.save.mockReturnValueOnce(
			throwError(() => ({ error: { issues: [{ code: 'overlap', path: ['sale', 'p1'] }, {}] } })),
		);
		c.submit();
		expect(c.problems().map((p) => [p.code, p.target])).toEqual([
			['overlap', 'p1'],
			['bad_rule', ''],
		]);
		expect(c.active).toBe('review');
		events.save.mockReturnValueOnce(throwError(() => new Error('down')));
		c.active = 'general';
		c.submit();
		expect(c.active).toBe('general');
		expect(notifier.showError).toHaveBeenCalledWith('event_rejected');
		h.categories = { data: [{ id: 'cat_1', name: 'Sarees', slug: 'sarees' }] };
		const named = setup();
		const words = (problem: Partial<ShopEventProblem>) =>
			named.c.problemText({
				code: 'bad_rule',
				target: '',
				locale: null,
				gaps: [],
				detail: '',
				...problem,
			} as ShopEventProblem);
		expect(words({ code: 'missing_text', target: 'title:bn' })).toBe(
			'event_problem_missing_text(event_shop_title|language_bn)',
		);
		expect(words({ code: 'missing_text', target: 'message' })).toBe(
			'event_problem_missing_text(event_message|language_en)',
		);
		expect(words({ code: 'not_ready', detail: 'Silk', gaps: [] })).toBe('Silk: ');
		expect(words({ code: 'overlap', detail: 'Puja sale' })).toBe('event_problem_overlap(Puja sale)');
		expect(words({ code: 'bad_rule', target: 'cat_1' })).toBe('event_problem_bad_rule(Sarees)');
		expect(words({ code: 'unknown_item', target: 'p1' })).toBe('event_problem_unknown_item(Silk · S-1)');
		expect(words({ code: 'no_items' } as never)).toBe('event_problem_no_items');
	});

	it('saves, reviews and asks before publishing, and stops on problems', () => {
		const fresh = setup({ type: 'sale' });
		fresh.c.askPublish();
		expect(fresh.events.save).not.toHaveBeenCalled();
		const { c, events, confirm, notifier } = setup();
		c.askPublish();
		expect(confirm.openModal).toHaveBeenCalledWith('publish', { id: 'evt_1' }, 120);
		// Loading the saved event reads the review too, so every read answers with the problem here.
		events.review.mockReturnValue(of(review({ problems: [{ code: 'overlap' } as never] })));
		c.askPublish();
		expect(c.active).toBe('review');
		expect(notifier.showError).toHaveBeenCalledWith('event_publish_blocked');
		events.review.mockReturnValue(of(review()));
		events.save.mockReturnValueOnce(throwError(() => new Error('down')));
		c.askPublish();
		expect(notifier.showError).toHaveBeenCalledWith('event_rejected');
	});

	it('publishes, unpublishes, cancels and ends an event once confirmed', () => {
		const fresh = setup({ type: 'sale' });
		fresh.c.ask('cancel');
		fresh.c.confirmed({ actionToPerform: 'publish' } as never);
		expect(fresh.confirm.openModal).not.toHaveBeenCalled();
		expect(fresh.events.publish).not.toHaveBeenCalled();
		const { c, events, confirm, notifier } = setup();
		c.ask('end_now');
		expect(confirm.openModal).toHaveBeenCalledWith('end_now', { id: 'evt_1' });
		c.confirmed({ actionToPerform: 'publish' } as never);
		expect(notifier.showSuccess).toHaveBeenCalledWith('event_published');
		events.publish.mockReturnValueOnce(
			of({ published: false, event: null, problems: [{ code: 'overlap' }] } as never),
		);
		c.confirmed({ actionToPerform: 'publish' } as never);
		expect(c.problems()).toHaveLength(1);
		events.publish.mockReturnValueOnce(of({ published: true, event: null, problems: [] } as never));
		c.confirmed({ actionToPerform: 'publish' } as never);
		events.publish.mockReturnValueOnce(throwError(() => new Error('down')));
		c.confirmed({ actionToPerform: 'publish' } as never);
		c.confirmed({ actionToPerform: 'unpublish' } as never);
		c.confirmed({ actionToPerform: 'cancel' } as never);
		c.confirmed({ actionToPerform: 'end_now' } as never);
		c.confirmed({ actionToPerform: 'other' } as never);
		expect(notifier.showSuccess).toHaveBeenCalledWith('event_unpublished');
		expect(notifier.showSuccess).toHaveBeenCalledWith('event_cancelled');
		expect(notifier.showSuccess).toHaveBeenCalledWith('event_ended');
		events.unpublish.mockReturnValueOnce(throwError(() => new Error('down')));
		events.cancel.mockReturnValueOnce(throwError(() => new Error('down')));
		events.endNow.mockReturnValueOnce(throwError(() => new Error('down')));
		c.confirmed({ actionToPerform: 'unpublish' } as never);
		c.confirmed({ actionToPerform: 'cancel' } as never);
		c.confirmed({ actionToPerform: 'end_now' } as never);
		expect(notifier.showError).toHaveBeenCalledTimes(5);
	});

	it('previews the popup in a new tab or a phone window, saving first when changed', () => {
		const win = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		const open = vi.spyOn(window, 'open').mockReturnValue(win as never);
		const fresh = setup({ type: 'sale' });
		fresh.c.preview('desktop');
		expect(open).not.toHaveBeenCalled();
		const { c, events, notifier } = setup();
		c.preview('desktop');
		expect(open).toHaveBeenLastCalledWith('', '_blank');
		expect(win.opener).toBeNull();
		expect(win.location.href).toContain('/en?event_preview=tok');
		c.switchLanguage('bn');
		c.form.markAsDirty();
		c.preview('phone');
		expect(open).toHaveBeenLastCalledWith('', 'event_preview_phone', 'popup,width=390,height=844');
		expect(events.save).toHaveBeenCalledTimes(1);
		expect(win.location.href).toContain('/bn?event_preview=tok');
		expect(c.form.dirty).toBe(false);
		events.previewLink.mockReturnValueOnce(throwError(() => new Error('down')));
		c.preview('desktop');
		expect(win.close).toHaveBeenCalledTimes(1);
		c.form.markAsDirty();
		events.save.mockReturnValueOnce(throwError(() => new Error('down')));
		c.preview('desktop');
		expect(win.close).toHaveBeenCalledTimes(2);
		open.mockReturnValueOnce(null);
		c.preview('desktop');
		expect(notifier.showError).toHaveBeenCalledWith('event_preview_blocked');
	});

	it('sends a test message', () => {
		const fresh = setup({ type: 'sale' });
		fresh.c.sendTest();
		expect(fresh.events.sendTest).not.toHaveBeenCalled();
		const { c, events, notifier } = setup();
		c.sendTest();
		expect(notifier.showSuccess).toHaveBeenCalledWith('event_test_sent');
		events.sendTest.mockReturnValueOnce(throwError(() => new Error('down')));
		c.sendTest();
		expect(notifier.showError).toHaveBeenCalledWith('event_test_failed');
	});
});

describe('the events list and its page title', () => {
	function list() {
		const events = { remove: vi.fn(() => of({})) };
		const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
		const router = { navigateByUrl: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: Router, useValue: router },
				{ provide: ShopEventService, useValue: events },
				{ provide: NotificationService, useValue: notifier },
				{ provide: TranslocoService, useValue: { translate: t } },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn(async () => undefined) } },
			],
		});
		TestBed.overrideComponent(Events, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Events);
		fixture.detectChanges();
		return { c: fixture.componentInstance, events, notifier, router };
	}

	it('reads India time', () => {
		expect(istLabel(null)).toBe('—');
		expect(istLabel('2027-09-27T18:29:00.000Z')).toBe('27 Sep 2027, 23:59 IST');
	});

	it('draws each event’s row, and marks a draft whose start has passed', () => {
		expect(list().c.tableConfig().total).toBe(0);
		vi.setSystemTime(new Date('2026-12-05T00:00:00.000Z'));
		h.page = {
			data: [
				shopEvent(),
				shopEvent({ id: 'e2', type: 'launch', status: 'live', startsAt: null } as never),
				shopEvent({ id: 'e3', startsAt: '2027-01-01T00:00:00.000Z' }),
			],
			total: 3,
		};
		const { c } = list();
		const rows = c.tableConfig().data;
		expect(c.tableConfig().total).toBe(3);
		expect(rows[0]?.status_pill).toContain('event_start_passed');
		expect(rows[1]).toMatchObject({ type_label: 'launch', ends_at: '—', starts_at: '—' });
		expect(rows[2]?.status_pill).toContain('event_status_draft');
		h.page = { data: [] };
		expect(list().c.tableConfig().total).toBe(0);
	});

	it('edits, deletes drafts only, and pages the table', () => {
		const { c, events, notifier, router } = list();
		c.onTableChange({ page: 2 });
		c.onActionClicked({ actionToPerform: 'edit', data: { id: 'e1' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/event/edit/e1');
		c.onActionClicked({ actionToPerform: 'delete', data: { id: 'e1', status: 'live' } } as never);
		expect(notifier.showError).toHaveBeenCalledWith('event_delete_drafts_only');
		c.onActionClicked({ actionToPerform: 'delete', data: { id: 'e1', status: 'draft' } } as never);
		expect(notifier.showSuccess).toHaveBeenCalledWith('event_deleted');
		events.remove.mockReturnValueOnce(throwError(() => new Error('down')));
		c.onActionClicked({ actionToPerform: 'delete', data: { id: 'e1', status: 'draft' } } as never);
		expect(notifier.showError).toHaveBeenCalledWith('event_rejected');
		c.onActionClicked({ actionToPerform: 'other' } as never);
	});

	it('titles the page for a new sale, a new launch or an edit', () => {
		const title = (params: Record<string, string>) => {
			TestBed.resetTestingModule();
			TestBed.configureTestingModule({
				providers: [{ provide: ActivatedRoute, useValue: { params: of(params) } }],
			});
			TestBed.overrideComponent(EditEvent as Type<unknown>, { set: { imports: [], template: '' } });
			return (TestBed.createComponent(EditEvent).componentInstance as EditEvent).title();
		};
		expect(title({ id: 'e1' })).toBe('edit_event');
		expect(title({ type: 'launch' })).toBe('new_launch');
		expect(title({ type: 'sale' })).toBe('new_sale');
	});
});
