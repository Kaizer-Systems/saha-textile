import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttributeService } from '@data-access/services/attribute.service';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { CountryService } from '@data-access/services/country.service';
import { CouponService } from '@data-access/services/coupon.service';
import { CurrencyService } from '@data-access/services/currency.service';
import { NotificationService } from '@data-access/services/notification.service';
import { OrderStatusService } from '@data-access/services/order-status.service';
import { OrderService } from '@data-access/services/order.service';
import { PageService } from '@data-access/services/page.service';
import { PaymentDetailsService } from '@data-access/services/payment-details.service';
import { PointService } from '@data-access/services/point.service';
import { ProductService } from '@data-access/services/product.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { RefundService } from '@data-access/services/refund.service';
import { ReviewService } from '@data-access/services/review.service';
import { StateService } from '@data-access/services/state.service';
import { TagService } from '@data-access/services/tag.service';
import { WalletService } from '@data-access/services/wallet.service';

import { injectAttributesQuery } from './attribute.queries';
import { bannerSrc, bannerSrcset, injectBannersQuery } from './banner.queries';
import { injectBlogBySlugQuery, injectBlogsQuery, injectRecentBlogsQuery } from './blog.queries';
import { injectBlogCategoriesQuery, injectCategoriesQuery } from './category.queries';
import { injectCountriesQuery } from './country.queries';
import { injectCouponsQuery } from './coupon.queries';
import { injectCurrenciesQuery } from './currency.queries';
import { injectNotificationsQuery } from './notification.queries';
import { injectOrderStatusQuery } from './order-status.queries';
import { injectOrderByNumberQuery, injectOrdersQuery } from './order.queries';
import { injectFaqsQuery, injectStaticPageQuery } from './page.queries';
import { injectPaymentDetailsQuery } from './payment-details.queries';
import { injectPointTransactionsQuery } from './point.queries';
import {
	RELATED_PRODUCTS_KEY,
	injectCatalogQuery,
	injectProductBySlugQuery,
	injectProductRelationsQuery,
	injectRecentPurchasesQuery,
	injectRelatedProductsData,
} from './product.queries';
import { injectQuestionAnswersQuery } from './questions-answers.queries';
import { injectRefundsQuery } from './refund.queries';
import { injectReviewQuery } from './review.queries';
import { injectStatesQuery } from './state.queries';
import { injectTagsQuery } from './tag.queries';
import { injectWalletTransactionsQuery } from './wallet.queries';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	select?: (value: never) => unknown;
	enabled?: boolean;
	placeholderData?: (previous?: unknown, query?: { queryKey: unknown[] }) => unknown;
	refetchInterval?: number;
}

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (options: () => Options) => options,
}));
vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const answer = vi.fn(() => of({ ok: true }));
const service = (...methods: string[]) => Object.fromEntries(methods.map((name) => [name, answer]));
const http = { get: vi.fn() };

beforeEach(() => {
	answer.mockClear();
	http.get.mockReset();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AttributeService, useValue: service('getAttributes') },
			{ provide: BlogService, useValue: service('getBlogs') },
			{ provide: CategoryService, useValue: service('getCategories', 'getBlogCategories') },
			{ provide: CountryService, useValue: service('getCountries') },
			{ provide: CouponService, useValue: service('getCoupons') },
			{ provide: CurrencyService, useValue: service('getCurrencies') },
			{ provide: NotificationService, useValue: service('getNotifications') },
			{ provide: OrderStatusService, useValue: service('getOrderStatus') },
			{ provide: OrderService, useValue: service('getOrders') },
			{ provide: PageService, useValue: service('getFaqs', 'getPage') },
			{ provide: PaymentDetailsService, useValue: service('getPaymentAccount') },
			{ provide: PointService, useValue: service('getUserTransaction') },
			{
				provide: ProductService,
				useValue: service('getCatalog', 'getProductPage', 'recentPurchases', 'getRelations'),
			},
			{ provide: QuestionsAnswersService, useValue: service('getQuestionAnswers') },
			{ provide: RefundService, useValue: service('getRefunds') },
			{ provide: ReviewService, useValue: service('getReview') },
			{ provide: StateService, useValue: service('getStates') },
			{ provide: TagService, useValue: service('getTags') },
			{ provide: WalletService, useValue: service('getUserTransaction') },
			{ provide: HttpClient, useValue: http },
			{ provide: TranslocoService, useValue: { getActiveLang: () => 'fr' } },
		],
	});
});

const options = (build: () => unknown): Options => (TestBed.runInInjectionContext(build) as unknown as () => Options)();
const params = () => ({ status: 1 });

describe('list queries', () => {
	it.each<[string, () => unknown, unknown[]]>([
		['attributes', () => injectAttributesQuery(params), ['attributes', { status: 1 }]],
		['blogs', () => injectBlogsQuery(params), ['blogs', { status: 1 }]],
		['blog categories', () => injectBlogCategoriesQuery(params), ['blog-categories', { status: 1 }]],
		['categories', () => injectCategoriesQuery(), ['categories', 'en']],
		['countries', () => injectCountriesQuery(), ['countries']],
		['coupons', () => injectCouponsQuery(params), ['coupons', { status: 1 }]],
		['currencies', () => injectCurrenciesQuery(params), ['currencies', { status: 1 }]],
		['order status', () => injectOrderStatusQuery(params), ['order-status', { status: 1 }]],
		['orders', () => injectOrdersQuery(params), ['orders', { status: 1 }]],
		['FAQs', () => injectFaqsQuery(), ['faqs']],
		['payment details', () => injectPaymentDetailsQuery(), ['payment-details']],
		['points', () => injectPointTransactionsQuery(params), ['point-transactions', { status: 1 }]],
		['refunds', () => injectRefundsQuery(params), ['refunds', { status: 1 }]],
		['states', () => injectStatesQuery(), ['states']],
		['tags', () => injectTagsQuery(params), ['tags', { status: 1 }]],
		['wallet', () => injectWalletTransactionsQuery(params), ['wallet-transactions', { status: 1 }]],
	])('%s has its key and fetches', async (_name, build, key) => {
		const query = options(build);
		expect(query.queryKey).toEqual(key);
		await expect(query.queryFn()).resolves.toEqual({ ok: true });
		expect(answer).toHaveBeenCalledOnce();
	});
});

describe('selecting queries', () => {
	it('recent posts select the rows', async () => {
		const query = options(() => injectRecentBlogsQuery(params));
		await query.queryFn();
		expect(query.select?.({ data: [1] } as never)).toEqual([1]);
	});

	it('a post is found by slug, and only asked for with one', async () => {
		const query = options(() => injectBlogBySlugQuery(() => 'care'));
		await query.queryFn();
		expect(query.enabled).toBe(true);
		expect(query.select?.({ data: [{ slug: 'care' }, { slug: 'x' }] } as never)).toEqual({ slug: 'care' });
		expect(options(() => injectBlogBySlugQuery(() => undefined)).enabled).toBe(false);
	});

	it('an order is found by number, and only asked for with one', async () => {
		const query = options(() => injectOrderByNumberQuery(() => '7'));
		await query.queryFn();
		expect(query.select?.({ data: [{ order_number: 7 }] } as never)).toEqual({ order_number: 7 });
		expect(options(() => injectOrderByNumberQuery(() => undefined)).enabled).toBe(false);
	});

	it('notifications select the rows, with and without parameters', async () => {
		const query = options(() => injectNotificationsQuery());
		await query.queryFn();
		expect(query.queryKey).toEqual(['notifications', undefined]);
		expect(query.select?.({ data: [1] } as never)).toEqual([1]);
		expect(options(() => injectNotificationsQuery(params)).queryKey).toEqual(['notifications', { status: 1 }]);
	});
});

describe('keyed queries', () => {
	it('a static page waits for its slug', async () => {
		const query = options(() => injectStaticPageQuery(() => 'about'));
		await query.queryFn();
		expect(query.queryKey).toEqual(['static-page', 'about']);
		expect(options(() => injectStaticPageQuery(() => undefined)).enabled).toBe(false);
	});

	it('questions and reviews wait for their product', async () => {
		const questions = options(() => injectQuestionAnswersQuery(() => 'silk-saree'));
		await questions.queryFn();
		expect(questions.enabled).toBe(true);
		expect(questions.queryKey).toEqual(['qna', 'silk-saree']);
		expect(options(() => injectQuestionAnswersQuery(() => undefined)).enabled).toBe(false);
		const reviews = options(() => injectReviewQuery(() => 7));
		await reviews.queryFn();
		expect(reviews.enabled).toBe(true);
		expect(options(() => injectReviewQuery(() => undefined)).enabled).toBe(false);
	});
});

describe('catalogue queries', () => {
	it('cleans the filter and applies the page size', async () => {
		const query = options(() => injectCatalogQuery(() => ({ paginate: 10, path: 'sarees', junk: 'x' })));
		expect(query.queryKey).toEqual(['catalog', expect.objectContaining({ limit: 10, path: 'sarees' })]);
		await query.queryFn();
		expect(answer).toHaveBeenCalledOnce();
	});

	it('defaults with no filter', () => {
		const query = options(() => injectCatalogQuery(() => undefined));
		expect(query.queryKey[1]).toMatchObject({ limit: 25, path: '' });
	});

	it('keeps another variant of the same product on screen, but never a different product', async () => {
		const query = options(() =>
			injectProductBySlugQuery(
				() => 'red',
				() => 'SKU-1',
			),
		);
		await query.queryFn();
		expect(query.queryKey).toEqual(['catalog', 'product', 'red', 'SKU-1']);
		expect(query.placeholderData?.('held', { queryKey: ['catalog', 'product', 'red', ''] })).toBe('held');
		expect(query.placeholderData?.('held', { queryKey: ['catalog', 'product', 'blue', ''] })).toBeUndefined();
		expect(query.placeholderData?.('held')).toBeUndefined();
	});

	it('defaults to no variant, and waits for a slug', () => {
		expect(options(() => injectProductBySlugQuery(() => 'red')).queryKey[3]).toBe('');
		expect(options(() => injectProductBySlugQuery(() => undefined)).enabled).toBe(false);
	});

	it('refreshes recent purchases on a timer, when enabled', async () => {
		const query = options(() => injectRecentPurchasesQuery(() => true));
		await query.queryFn();
		expect(query.enabled).toBe(true);
		expect(query.refetchInterval).toBe(300_000);
	});

	it('reads relations for a slug', async () => {
		const query = options(() => injectProductRelationsQuery(() => 'red'));
		await query.queryFn();
		expect(query.enabled).toBe(true);
		expect(options(() => injectProductRelationsQuery(() => undefined)).enabled).toBe(false);
	});

	it('only ever reads the shared related slot', async () => {
		const query = options(() => injectRelatedProductsData());
		expect(query.queryKey).toEqual(RELATED_PRODUCTS_KEY);
		expect(query.enabled).toBe(false);
		await expect(query.queryFn()).resolves.toEqual([]);
	});
});

describe('banner queries', () => {
	it('asks for the active language, with the page as default owner', async () => {
		http.get.mockReturnValue(of({ heroLayout: 'hero_main_side', banners: [] }));
		const query = options(() => injectBannersQuery());
		expect(query.queryKey).toEqual(['banners', 'home', 'fr']);
		await expect(query.queryFn()).resolves.toMatchObject({ heroLayout: 'hero_main_side' });
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { ownerType: 'home', locale: 'fr' } });
	});

	it('answers no banners when the API is unreachable', async () => {
		http.get.mockReturnValue(throwError(() => new Error('down')));
		const query = options(() => injectBannersQuery(() => 'global'));
		await expect(query.queryFn()).resolves.toEqual({ heroLayout: 'hero_full', banners: [] });
	});

	it('builds the image attributes', () => {
		const image = {
			roles: {
				banner: [
					{ url: 'a', width: 1 },
					{ url: 'b', width: 2 },
				],
			},
		} as never;
		expect(bannerSrcset(image)).toBe('a 1w, b 2w');
		expect(bannerSrc(image)).toBe('b');
		expect(bannerSrc({ roles: {} } as never)).toBe('');
	});
});
