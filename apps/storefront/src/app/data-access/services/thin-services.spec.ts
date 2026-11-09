import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from '@core/config/runtime-config';
import { BACKGROUND_REQUEST } from '@core/interceptors/background-request';

import { AccountAddressService } from './account-address.service';
import { AccountService } from './account.service';
import { AttributeService } from './attribute.service';
import { BlogService } from './blog.service';
import { CartService } from './cart.service';
import { CategoryService } from './category.service';
import { ContactChangeService } from './contact-change.service';
import { CountryService } from './country.service';
import { CouponService } from './coupon.service';
import { CurrencyService } from './currency.service';
import { ErrorService } from './error.service';
import { LoggingService } from './logging.service';
import { OrderStatusService } from './order-status.service';
import { OrderService } from './order.service';
import { PageService } from './page.service';
import { PaymentDetailsService } from './payment-details.service';
import { PointService } from './point.service';
import { QuestionsAnswersService } from './questions-answers.service';
import { RefundService } from './refund.service';
import { ReviewService } from './review.service';
import { SettingService } from './setting.service';
import { SiteConfigService } from './site-config.service';
import { StateService } from './state.service';
import { ContactMessageService } from './contact-message.service';
import { StoreLocationService } from './store-location.service';
import { StoreService } from './store.service';
import { TagService } from './tag.service';
import { WalletService } from './wallet.service';
import { WishlistService } from './wishlist.service';

const http = {
	get: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
	delete: vi.fn(),
};
const customer = { id: 'cus_1', email: 'a@b.co', phone: null, status: 'active', addresses: [] };

beforeEach(() => {
	for (const call of Object.values(http)) call.mockReset().mockReturnValue(of({}));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
});

const reads: [string, () => unknown, string, unknown][] = [
	['attributes', () => TestBed.inject(AttributeService).getAttributes({ a: 1 }), '/attribute.json', { a: 1 }],
	['coupons', () => TestBed.inject(CouponService).getCoupons({ a: 1 }), '/coupon.json', { a: 1 }],
	['currencies', () => TestBed.inject(CurrencyService).getCurrencies({ a: 1 }), '/currency.json', { a: 1 }],
	['order status', () => TestBed.inject(OrderStatusService).getOrderStatus({ a: 1 }), '/order-status.json', { a: 1 }],
	['orders', () => TestBed.inject(OrderService).getOrders({ a: 1 }), '/order.json', { a: 1 }],
	['points', () => TestBed.inject(PointService).getUserTransaction({ a: 1 }), '/point.json', { a: 1 }],
	['refunds', () => TestBed.inject(RefundService).getRefunds({ a: 1 }), '/refund.json', { a: 1 }],
	['stores', () => TestBed.inject(StoreService).getStores({ a: 1 }), '/store.json', { a: 1 }],
	['tags', () => TestBed.inject(TagService).getTags({ a: 1 }), '/tag.json', { a: 1 }],
	['wallet', () => TestBed.inject(WalletService).getUserTransaction({ a: 1 }), '/wallet.json', { a: 1 }],
];

const plainReads: [string, () => unknown, string][] = [
	['countries', () => TestBed.inject(CountryService).getCountries(), '/country.json'],
	['payment account', () => TestBed.inject(PaymentDetailsService).getPaymentAccount(), '/payment-account.json'],
	['settings', () => TestBed.inject(SettingService).getSettingOption(), '/setting.json'],
	['site config', () => TestBed.inject(SiteConfigService).getSiteConfig(), '/site-config.json'],
	['states', () => TestBed.inject(StateService).getStates(), '/state.json'],
	['a static page', () => TestBed.inject(PageService).getPage('about'), '/pages/about.json'],
];

describe('contact message service', () => {
	it('sends a Contact Us message to the API', async () => {
		http.post.mockReturnValue(of({ accepted: true }));
		await firstValueFrom(TestBed.inject(ContactMessageService).send({ name: 'R' } as never));
		expect(String(http.post.mock.lastCall?.[0])).toContain('/storefront/contact-messages');
	});
});

describe('store location service', () => {
	it('reads the active stores from the catalogue', async () => {
		http.get.mockReturnValue(of([]));
		await firstValueFrom(TestBed.inject(StoreLocationService).getStores());
		expect(String(http.get.mock.lastCall?.[0])).toContain('/catalog/store-locations');
	});
});

describe('blog service', () => {
	const card = {
		id: 'blg_1',
		slug: 'real-banarasi',
		title: 'Real Banarasi',
		excerpt: 'Seven checks',
		author: 'Saha Textile',
		publishedAt: '2026-11-08T00:00:00.000Z',
		featured: false,
		sticky: true,
		readingMinutes: 6,
		cover: {
			assetId: 'm',
			width: 1774,
			height: 887,
			alt: 'A red Banarasi',
			roles: {
				blog: [
					{ url: 'https://cdn/480.webp', width: 480, height: 240 },
					{ url: 'https://cdn/1600.webp', width: 1600, height: 800 },
				],
			},
		},
		categories: [{ slug: 'saree-guides', name: 'Saree guides' }],
		tags: [],
	};

	it('reads a page of posts from the API as cards', async () => {
		http.get.mockReturnValue(of({ items: [card], total: 1, page: 1, pageSize: 10 }));
		const page = await firstValueFrom(
			TestBed.inject(BlogService).getBlogs({ page: 2, paginate: 99, tag: 'silk', category: '' }),
		);
		expect(String(http.get.mock.lastCall?.[0])).toContain('/catalog/blog/posts');
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { page: '2', pageSize: '50', tag: 'silk' } });
		expect(page.total).toBe(1);
		expect(page.data[0]).toMatchObject({
			id: 'blg_1',
			description: 'Seven checks',
			published_at: '2026-11-08T00:00:00.000Z',
			is_sticky: 1,
			blog_thumbnail: {
				original_url: 'https://cdn/1600.webp',
				srcset: 'https://cdn/480.webp 480w, https://cdn/1600.webp 1600w',
				alt: 'A red Banarasi',
			},
			content: '',
		});
		await firstValueFrom(TestBed.inject(BlogService).getBlogs());
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { page: '1', pageSize: '10' } });
	});

	it('reads one post with its article and search text, and the sidebar terms', async () => {
		const post = {
			...card,
			sticky: false,
			cover: null,
			content: '<p>Checks</p>',
			seoTitle: 'Real Banarasi | Saha Textile',
			seoDescription: 'Seven checks',
			shareImage: null,
			updatedAt: '2026-11-09T00:00:00.000Z',
		};
		http.get.mockReturnValue(of(post));
		const blog = await firstValueFrom(TestBed.inject(BlogService).getBlog('real banarasi'));
		expect(String(http.get.mock.lastCall?.[0])).toContain('/catalog/blog/posts/real%20banarasi');
		expect(blog).toMatchObject({
			content: '<p>Checks</p>',
			is_sticky: 0,
			blog_thumbnail: null,
			updated_at: post.updatedAt,
		});
		TestBed.inject(BlogService).getTerms('tags');
		expect(String(http.get.mock.lastCall?.[0])).toContain('/catalog/blog/tags');
	});
});

describe('read services', () => {
	it.each(reads)('%s passes its parameters', (_name, call, path, params) => {
		call();
		expect(String(http.get.mock.lastCall?.[0])).toContain(path);
		expect(http.get.mock.lastCall?.[1]).toEqual({ params });
	});

	it.each(plainReads)('%s reads its file', (_name, call, path) => {
		call();
		expect(String(http.get.mock.lastCall?.[0])).toContain(path);
	});
});

describe('CategoryService', () => {
	it('maps the menu into the shape the screens read', async () => {
		const row = {
			id: 'cat_1',
			name: 'Saris',
			slug: 'sarees',
			description: '',
			parentId: null,
			level: 1,
			path: 'sarees',
			imageUrl: 'https://cdn.test/i.webp',
			iconUrl: null,
		};
		http.get.mockReturnValue(of([row, { ...row, id: 'cat_2', parentId: 'cat_1', level: 2 }]));
		const model = await firstValueFrom(TestBed.inject(CategoryService).getCategories());
		expect(http.get.mock.lastCall?.[0]).toMatch(/\/catalog\/categories\/menu$/);
		expect(model.total).toBe(2);
		expect(model.data[0]).toMatchObject({
			id: 'cat_1',
			name: 'Saris',
			type: 'product',
			level: 1,
			canonical_path: 'sarees',
			category_image: { original_url: 'https://cdn.test/i.webp' },
		});
		expect(model.data[0]?.parent_id).toBeUndefined();
		expect(model.data[0]?.category_icon).toBeUndefined();
		expect(model.data[1]?.parent_id).toBe('cat_1');
	});
});

describe('CartService', () => {
	// The first cart read waits for the runtime config, as it does when the app starts.
	beforeAll(() => loadRuntimeConfig());

	it('reads and changes the shopper cart, sending cookies and no toast', async () => {
		const service = TestBed.inject(CartService);
		for (const method of ['get', 'post', 'patch', 'delete'] as const) http[method].mockReturnValue(of({}));
		await firstValueFrom(service.current());
		service.add({ productId: 'p', quantity: 1, variationId: null, addons: [] });
		service.update('a b', { quantity: 2 });
		service.remove('a b');
		expect(http.get.mock.lastCall?.[0]).toMatch(/\/cart\/current$/);
		expect(http.post.mock.lastCall?.[0]).toMatch(/\/cart\/current\/lines$/);
		expect(http.patch.mock.lastCall?.[0]).toMatch(/\/lines\/a%20b$/);
		expect(http.delete.mock.lastCall?.[0]).toMatch(/\/lines\/a%20b$/);
		const options = http.delete.mock.lastCall?.[1];
		expect(options.withCredentials).toBe(true);
		expect(options.context.get(BACKGROUND_REQUEST)).toBe(true);
	});
});

describe('AccountService', () => {
	it('maps the signed-in customer', async () => {
		http.get.mockReturnValue(of({ user: customer }));
		const user = await firstValueFrom(TestBed.inject(AccountService).GetUserDetails());
		expect(user.email).toBe('a@b.co');
	});

	it('refuses a guest answer', async () => {
		http.get.mockReturnValue(of({ user: null }));
		await expect(firstValueFrom(TestBed.inject(AccountService).GetUserDetails())).rejects.toThrow('anonymous');
	});
});

describe('AccountAddressService', () => {
	const service = () => TestBed.inject(AccountAddressService);

	beforeEach(() => {
		http.post.mockReturnValue(of(customer));
		http.patch.mockReturnValue(of(customer));
		http.delete.mockReturnValue(of(customer));
	});

	it('creates, updates and removes on the customer own routes', async () => {
		await firstValueFrom(service().create({ line1: 'x' } as never));
		expect(String(http.post.mock.lastCall?.[0])).toMatch(/\/storefront\/account\/addresses$/);
		await firstValueFrom(service().update('a1', { line1: 'y' }));
		expect(String(http.patch.mock.lastCall?.[0])).toMatch(/\/addresses\/a1$/);
		await firstValueFrom(service().remove('a1'));
		expect(String(http.delete.mock.lastCall?.[0])).toMatch(/\/addresses\/a1$/);
	});

	it('updates the display name', async () => {
		const user = await firstValueFrom(service().updateProfile('Asha'));
		expect(http.patch.mock.lastCall?.[1]).toEqual({ displayName: 'Asha' });
		expect(user.email).toBe('a@b.co');
	});
});

describe('ContactChangeService', () => {
	const service = () => TestBed.inject(ContactChangeService);

	it('reads what the server is holding', async () => {
		http.get.mockReturnValue(of({ pending: { field: 'email' } }));
		await expect(firstValueFrom(service().pending())).resolves.toEqual({ field: 'email' });
	});

	it('starts each change with its proof', () => {
		service().startEmailChange('a@b.co', { password: 'p' });
		expect(http.post.mock.lastCall?.[1]).toEqual({ newEmail: 'a@b.co', password: 'p' });
		service().startPhoneChange('+91900', { otpCode: '1' });
		expect(http.post.mock.lastCall?.[1]).toEqual({ newPhone: '+91900', otpCode: '1' });
	});

	it('resends, confirms and cancels', async () => {
		service().resend();
		expect(String(http.post.mock.lastCall?.[0])).toMatch(/\/resend$/);
		http.post.mockReturnValue(of(customer));
		const user = await firstValueFrom(service().confirm('123456'));
		expect(http.post.mock.lastCall?.[1]).toEqual({ code: '123456' });
		expect(user.email).toBe('a@b.co');
		service().cancel();
		expect(http.delete).toHaveBeenCalledOnce();
	});
});

describe('PageService', () => {
	it('maps the FAQ rows', async () => {
		http.get.mockReturnValue(of([{ id: 'f1', question: { en: 'Q' }, answer: { en: 'A' } }]));
		const page = await firstValueFrom(TestBed.inject(PageService).getFaqs());
		expect(page.total).toBe(1);
		expect(page.data[0]).toMatchObject({ id: 1, title: 'Q', description: 'A' });
		http.get.mockReturnValue(of([{ id: 'f1', question: { en: 'Q', bn: 'প্রশ্ন' }, answer: { en: 'A' } }]));
		const bengali = await firstValueFrom(TestBed.inject(PageService).getFaqs('bn'));
		expect(bengali.data[0]).toMatchObject({ title: 'প্রশ্ন', description: 'A' });
		http.get.mockReturnValue(of([{ id: 'f2', question: {}, answer: {} }]));
		expect((await firstValueFrom(TestBed.inject(PageService).getFaqs('bn'))).data[0]).toMatchObject({
			title: '',
			description: '',
		});
	});
});

describe('QuestionsAnswersService', () => {
	const service = () => TestBed.inject(QuestionsAnswersService);

	it('asks by slug, or by product slug, or sends empty', () => {
		service().getQuestionAnswers({ slug: 'red' });
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { productSlug: 'red' } });
		service().getQuestionAnswers({ productSlug: 'blue' });
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { productSlug: 'blue' } });
		service().getQuestionAnswers({});
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { productSlug: '' } });
	});

	it('maps the rows, filling what is missing', async () => {
		http.get.mockReturnValue(
			of([
				{ id: 'q1', question: 'Silk?', askerName: 'Asha', answer: 'Yes', answeredAt: '2026-11-08T10:00:00Z' },
				{ id: 'q2', question: 'Cotton?', askerName: null, answer: null, answeredAt: null },
			]),
		);
		const page = await firstValueFrom(service().getQuestionAnswers({ slug: 'red' }));
		expect(page.total).toBe(2);
		expect(page.data[0]).toEqual({
			id: 'q1',
			question: 'Silk?',
			answer: 'Yes',
			askerName: 'Asha',
			answeredAt: '2026-11-08T10:00:00Z',
		});
		expect(page.data[1]).toMatchObject({ id: 'q2', answer: '', askerName: null });
	});

	it('posts a question with credentials', () => {
		const body = { productSlug: 'r', question: 'q', askerName: 'a', askerEmail: 'e', isAnonymous: false };
		service().ask(body);
		expect(http.post.mock.lastCall?.[1]).toEqual(body);
		expect(http.post.mock.lastCall?.[2]).toEqual({ withCredentials: true });
	});
});

describe('small services', () => {
	it('logs an error', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		TestBed.inject(LoggingService).logError('boom');
		expect(logged).toHaveBeenCalledWith('LoggingService: boom');
		logged.mockRestore();
	});

	it('resolves the reCAPTCHA hook', async () => {
		await expect(TestBed.inject(SettingService).getReCaptchaConfig()).resolves.toBeUndefined();
	});

	it('says when the browser is offline', () => {
		vi.stubGlobal('navigator', { onLine: false });
		expect(TestBed.inject(ErrorService).getClientErrorMessage(new Error('x'))).toBe('No internet connection.');
		vi.unstubAllGlobals();
	});

	it('reads a server error, or its own message', () => {
		const service = TestBed.inject(ErrorService);
		expect(service.getServerErrorMessage({ message: 'raw' } as never)).toBe('raw');
		expect(
			service.getServerErrorMessage({ error: { code: 'x', message: 'Readable' }, message: 'raw' } as never),
		).toBe('Readable');
	});

	it('leaves a failed observable to the caller', async () => {
		http.get.mockReturnValue(throwError(() => new Error('down')));
		await expect(firstValueFrom(TestBed.inject(AccountService).GetUserDetails())).rejects.toThrow('down');
	});
});

describe('ReviewService', () => {
	it('reads the public reviews and the customer’s own, and edits with the session', () => {
		const reviews = TestBed.inject(ReviewService);
		reviews.getReviews('silk-saree').subscribe();
		expect(http.get).toHaveBeenLastCalledWith(expect.stringMatching(/\/catalog\/reviews$/), {
			params: { productSlug: 'silk-saree', page: 1, pageSize: 10 },
		});
		reviews.mine('p1').subscribe();
		expect(http.get).toHaveBeenLastCalledWith(expect.stringMatching(/\/storefront\/reviews\/mine$/), {
			params: { productId: 'p1' },
			withCredentials: true,
		});
		const edit = { rating: 4, title: null, body: 'Fine', imageAssetIds: [] };
		reviews.update('r 1', edit).subscribe();
		expect(http.patch).toHaveBeenLastCalledWith(expect.stringMatching(/\/storefront\/reviews\/r%201$/), edit, {
			withCredentials: true,
		});
	});
});

describe('WishlistService', () => {
	it('reads and changes the account list with the session, and guest cards by id', async () => {
		const wishlist = TestBed.inject(WishlistService);
		http.get.mockReturnValueOnce(of({ productIds: ['p1'], items: [] }));
		expect(await firstValueFrom(wishlist.account())).toEqual({ productIds: ['p1'], items: [] });
		expect(http.get).toHaveBeenLastCalledWith(expect.stringMatching(/\/storefront\/wishlist$/), {
			withCredentials: true,
		});
		wishlist.add('p1').subscribe();
		expect(http.post).toHaveBeenLastCalledWith(
			expect.stringMatching(/\/storefront\/wishlist$/),
			{ productId: 'p1' },
			{ withCredentials: true },
		);
		wishlist.merge(['p1', 'p2']).subscribe();
		expect(http.post).toHaveBeenLastCalledWith(
			expect.stringMatching(/\/storefront\/wishlist\/merge$/),
			{ productIds: ['p1', 'p2'] },
			{ withCredentials: true },
		);
		wishlist.remove('p 1').subscribe();
		expect(http.delete).toHaveBeenLastCalledWith(expect.stringMatching(/\/storefront\/wishlist\/p%201$/), {
			withCredentials: true,
		});
		expect(await firstValueFrom(wishlist.cards([]))).toEqual([]);
		http.get.mockReturnValueOnce(of([]));
		expect(await firstValueFrom(wishlist.cards(['p1']))).toEqual([]);
		expect(http.get).toHaveBeenLastCalledWith(expect.stringMatching(/\/catalog\/cards$/), {
			params: { id: ['p1'] },
		});
	});

	it('reads the API address from the runtime config when it reads, not when it is made', async () => {
		const service = TestBed.inject(CartService);
		http.get.mockReturnValue(of({}));
		const before = runtimeConfig.apiUrl;
		runtimeConfig.apiUrl = 'https://api.example.test';
		try {
			await firstValueFrom(service.current());
			expect(http.get.mock.lastCall?.[0]).toBe('https://api.example.test/cart/current');
		} finally {
			runtimeConfig.apiUrl = before;
		}
	});
});
