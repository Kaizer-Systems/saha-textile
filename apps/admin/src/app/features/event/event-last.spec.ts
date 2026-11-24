import { PLATFORM_ID } from '@angular/core';
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

import { FormEvent } from './form-event/form-event';

import type { ShopEvent, ShopEventProblem, ShopEventReview } from '@saha-textile/contracts';

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

describe('the event form: the last cases', () => {
	it('loads an event with no dates and no set rule, then one whose popup pictures were all removed', async () => {
		const { c, events, route, media } = setup(
			{ id: 'evt_1' },
			shopEvent({
				startsAt: null,
				endsAt: null,
				popupAssetIds: ['img_1'],
				sale: { categories: [], products: [] } as never,
			}),
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(c.categoryOptions()).toEqual([]);
		expect(c.form.controls.starts_at.value).toBe('');
		expect(c.form.controls.ends_at.value).toBe('');
		expect(c.saleIncludeSets()).toBe(false);
		expect(media.get).toHaveBeenCalledWith('img_1');
		expect(c.popupImages()).toHaveLength(1);
		events.get.mockReturnValue(of(shopEvent({ popupAssetIds: [] })));
		route.next({ id: 'evt_1' });
		await vi.advanceTimersByTimeAsync(0);
		expect(c.popupImages()).toEqual([]);
	});

	it('asks for no review of an event that has no id yet', () => {
		const { c, events } = setup({});
		events.review.mockClear();
		(c as unknown as { load(event: ShopEvent): void }).load(shopEvent({ id: '' }));
		expect(events.review).not.toHaveBeenCalled();
	});

	it('words a product that is not ready with each gap', () => {
		const { c } = setup();
		const text = c.problemText({
			code: 'not_ready',
			target: '',
			locale: null,
			detail: 'Silk',
			gaps: [{ field: 'title', locale: null }],
		} as unknown as ShopEventProblem);
		expect(text.startsWith('Silk: ')).toBe(true);
		expect(text.length).toBeGreaterThan('Silk: '.length);
	});
});
