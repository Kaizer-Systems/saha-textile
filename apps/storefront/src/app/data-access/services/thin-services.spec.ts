import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountAddressService } from './account-address.service';
import { AccountService } from './account.service';
import { AttributeService } from './attribute.service';
import { BlogService } from './blog.service';
import { CartService } from './cart.service';
import { CategoryService } from './category.service';
import { CompareService } from './compare.service';
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
	['blogs', () => TestBed.inject(BlogService).getBlogs({ a: 1 }), '/blog.json', { a: 1 }],
	['categories', () => TestBed.inject(CategoryService).getCategories({ a: 1 }), '/category.json', { a: 1 }],
	['coupons', () => TestBed.inject(CouponService).getCoupons({ a: 1 }), '/coupon.json', { a: 1 }],
	['currencies', () => TestBed.inject(CurrencyService).getCurrencies({ a: 1 }), '/currency.json', { a: 1 }],
	['order status', () => TestBed.inject(OrderStatusService).getOrderStatus({ a: 1 }), '/order-status.json', { a: 1 }],
	['orders', () => TestBed.inject(OrderService).getOrders({ a: 1 }), '/order.json', { a: 1 }],
	['points', () => TestBed.inject(PointService).getUserTransaction({ a: 1 }), '/point.json', { a: 1 }],
	['refunds', () => TestBed.inject(RefundService).getRefunds({ a: 1 }), '/refund.json', { a: 1 }],
	['reviews', () => TestBed.inject(ReviewService).getReview({ a: 1 }), '/review.json', { a: 1 }],
	['stores', () => TestBed.inject(StoreService).getStores({ a: 1 }), '/store.json', { a: 1 }],
	['tags', () => TestBed.inject(TagService).getTags({ a: 1 }), '/tag.json', { a: 1 }],
	['wallet', () => TestBed.inject(WalletService).getUserTransaction({ a: 1 }), '/wallet.json', { a: 1 }],
];

const plainReads: [string, () => unknown, string][] = [
	['cart', () => TestBed.inject(CartService).getCartItems(), '/cart.json'],
	['compare', () => TestBed.inject(CompareService).getCompareItems(), '/compare.json'],
	['countries', () => TestBed.inject(CountryService).getCountries(), '/country.json'],
	['payment account', () => TestBed.inject(PaymentDetailsService).getPaymentAccount(), '/payment-account.json'],
	['settings', () => TestBed.inject(SettingService).getSettingOption(), '/setting.json'],
	['site config', () => TestBed.inject(SiteConfigService).getSiteConfig(), '/site-config.json'],
	['states', () => TestBed.inject(StateService).getStates(), '/state.json'],
	['wishlist', () => TestBed.inject(WishlistService).getWishlistItems(), '/wishlist.json'],
	['a static page', () => TestBed.inject(PageService).getPage('about'), '/pages/about.json'],
];

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
				{ id: 'q1', question: 'Silk?', askerName: 'Asha', answer: 'Yes' },
				{ id: 'q2', question: 'Cotton?', askerName: null, answer: null },
			]),
		);
		const page = await firstValueFrom(service().getQuestionAnswers({ slug: 'red' }));
		expect(page.total).toBe(2);
		expect(page.data[0]).toMatchObject({ id: 1, answer: 'Yes', store: { store_name: 'Asha' } });
		expect(page.data[1]).toMatchObject({ id: 2, answer: '', store: { store_name: '' } });
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
